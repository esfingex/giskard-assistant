/**
 * Giskard Assistant VSCode Extension — Célula: Comandos del Agent Manager + Checkpoints
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída del patrón de células de comandos. Comandos: addAgentRunTree,
 * cancelAgentRunTree, removeAgentRunTree, openAgentRunOutput, createCheckpoint.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { ConnectionStore } from '../core/connectionStore';
import { fetchLlmModelsGrouped } from '../core/api';
import { AGENT_ROLES, addRun, removeRun, updateRun, type AgentRunRole } from '../core/agentRegistry';
import {
    AgentRunner,
    AgentRunTreeItem,
    GiskardAgentManagerTreeProvider,
    makeAgentRunState
} from './agentManager';

export interface AgentCommandsContext {
    context: vscode.ExtensionContext;
    store: ConnectionStore;
    runner: AgentRunner;
    tree: GiskardAgentManagerTreeProvider;
}

function runIdFromArg(arg: unknown): string | null {
    const raw = typeof arg === 'string' ? arg : (arg as AgentRunTreeItem)?.run?.id;
    return raw || null;
}

export function registerAgentCommands(ctx: AgentCommandsContext): vscode.Disposable[] {
    const { context, store, runner, tree } = ctx;

    return [
        vscode.commands.registerCommand('giskard-assistant.addAgentRunTree', async () => {
            const task = await vscode.window.showInputBox({
                prompt: '🛰️ Tarea para el agente (puede ser tan grande como quieras)',
                placeHolder: 'ej. Revisa los tests de providers y arregla el que falla por timeout'
            });
            if (!task || !task.trim()) return;

            // Rol del ciclo de revisión: revisor / planificador / ejecutor
            const rolePick = await vscode.window.showQuickPick(
                (Object.keys(AGENT_ROLES) as AgentRunRole[]).map((r) => ({
                    label: `${AGENT_ROLES[r].emoji} ${r}`,
                    description: AGENT_ROLES[r].label,
                    role: r
                })),
                { placeHolder: 'Rol del agente en el ciclo (revisar → planear → implementar)' }
            );
            if (!rolePick) return;
            const role = rolePick.role;

            // QuickPick: SOLO modelos habilitados que pertenecen a conexiones
            // ACTIVAS (fuera los de Ollama deshabilitado y similares — los
            // 'pegados' del store no se ofrecen). Detalle: proveedor · conexión.
            const enabled = store.getEnabledModels();
            const groups = await fetchLlmModelsGrouped().catch(() => []);
            const providerOf = new Map<string, string>();
            groups.forEach((g) => {
                (g.models || []).forEach((m) => {
                    if (m && !providerOf.has(m)) {
                        providerOf.set(m, `${(g.connectionTag || 'AI').toUpperCase()} · ${g.connectionName}`);
                    }
                });
            });
            const availableEnabled = enabled.filter((m) => providerOf.has(m));

            interface ModelPick extends vscode.QuickPickItem {
                model?: string;
                custom?: boolean;
            }
            const items: ModelPick[] = availableEnabled.map((m) => ({
                label: m,
                description: providerOf.get(m) || 'proveedor desconocido',
                model: m
            }));
            if (items.length > 0) {
                items.push({ label: '$(edit) Otro modelo (escribir manualmente)…', custom: true });
            }

            let model: string | undefined;
            if (items.length > 0) {
                const pick = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Modelo para este agente — remoto = corre en paralelo',
                    matchOnDescription: true
                });
                if (!pick) return;
                model = pick.custom
                    ? await vscode.window.showInputBox({
                          prompt: 'Modelo (id exacto como aparece en el picker del chat)',
                          value: availableEnabled[0] || ''
                      })
                    : pick.model;
            } else {
                model = await vscode.window.showInputBox({
                    prompt: 'No hay modelos habilitados — escribe el id del modelo (ej. de una conexión activa)',
                    placeHolder: 'ej. deepseek/deepseek-chat o llama-3.3-70b-instruct'
                });
            }
            if (!model || !model.trim()) return;

            const defaultName = task.trim().slice(0, 40) + (task.trim().length > 40 ? '…' : '');
            const name =
                (await vscode.window.showInputBox({
                    prompt: 'Nombre del run',
                    value: defaultName
                })) || defaultName;

            const run = addRun(makeAgentRunState(context), {
                name,
                task: task.trim(),
                model: model.trim(),
                role
            });
            tree.refresh();
            vscode.window.showInformationMessage(`🛰️ Agente "${name}" lanzado (${model.trim()}).`);
            // Fire-and-forget: el run corre en background con su propio OutputChannel
            void runner.start(run);
        }),
        vscode.commands.registerCommand('giskard-assistant.cancelAgentRunTree', async (arg: unknown) => {
            const id = runIdFromArg(arg);
            if (!id) return;
            const run = tree.getRunById(id);
            if (!run) return;
            if (runner.isRunning(id)) {
                runner.cancel(id);
                vscode.window.showInformationMessage(`⛔ Cancelando "${run.name}"…`);
            } else {
                updateRun(makeAgentRunState(context), id, { status: 'cancelled' });
                tree.refresh();
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.chainAgentRun', async (arg: unknown) => {
            const id = runIdFromArg(arg);
            if (!id) return;
            const prev = tree.getRunById(id);
            if (!prev) return;
            if (!prev.output) {
                vscode.window.showWarningMessage('Este run no tiene salida guardada (termina un run completo primero).');
                return;
            }

            // Siguiente eslabón del ciclo: la salida del run anterior es el
            // contexto del nuevo run, con el rol que elijas.
            const step = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(search) 🔍 Re-revisar tras los cambios',
                        description: 'Un revisor evalúa el resultado del run anterior',
                        role: 'revisor' as AgentRunRole,
                        instr: 'Revisa el resultado del trabajo anterior: qué está bien, qué falta y qué riesgos introdujo.'
                    },
                    {
                        label: '$(tools) 🛠️ Implementar los hallazgos',
                        description: 'Un ejecutor aplica lo propuesto',
                        role: 'ejecutor' as AgentRunRole,
                        instr: 'Implementa los cambios propuestos en el siguiente informe, resolviendo cada hallazgo.'
                    },
                    {
                        label: '$(list-ordered) 🧭 Planificar los siguientes pasos',
                        description: 'Un planificador ordena el trabajo pendiente',
                        role: 'planificador' as AgentRunRole,
                        instr: 'A partir del siguiente informe, elabora el plan de trabajo pendiente ordenado por prioridad.'
                    }
                ],
                { placeHolder: `Siguiente eslabón del ciclo a partir de "${prev.name}"` }
            );
            if (!step) return;

            const extra = await vscode.window.showInputBox({
                prompt: 'Instrucción adicional para el nuevo run (opcional)',
                placeHolder: 'ej. enfócate solo en los hallazgos críticos'
            });

            const task =
                `Contexto — salida del run anterior "${prev.name}" (${prev.model}):
\n${prev.output}\n\nInstrucción: ${step.instr}` +
                (extra && extra.trim() ? `\nExtras: ${extra.trim()}` : '');

            const shortName = `${AGENT_ROLES[step.role].emoji} ${prev.name} → ${step.role}`;
            const run = addRun(makeAgentRunState(context), {
                name: shortName,
                task,
                model: prev.model,
                role: step.role
            });
            tree.refresh();
            vscode.window.showInformationMessage(`🛰️ Ciclo continúa: "${shortName}" lanzado (${prev.model}).`);
            void runner.start(run);
        }),
        vscode.commands.registerCommand('giskard-assistant.removeAgentRunTree', async (arg: unknown) => {
            const id = runIdFromArg(arg);
            if (!id) return;
            if (runner.isRunning(id)) {
                vscode.window.showWarningMessage('El run está ejecutándose — cancélalo antes de eliminarlo.');
                return;
            }
            removeRun(makeAgentRunState(context), id);
            tree.refresh();
            vscode.window.showInformationMessage('✓ Run eliminado.');
        }),
        vscode.commands.registerCommand('giskard-assistant.openAgentRunOutput', async (arg: unknown) => {
            const id = runIdFromArg(arg);
            if (!id) return;
            const run = tree.getRunById(id);
            if (!run) return;
            const channel = vscode.window.createOutputChannel(`Giskard Agent · ${run.name}`);
            channel.show(true);
        }),
        vscode.commands.registerCommand('giskard-assistant.createCheckpoint', async () => {
            const ws = vscode.workspace.workspaceFolders?.[0];
            if (!ws) {
                vscode.window.showWarningMessage('Abre un workspace para crear un checkpoint.');
                return;
            }
            const run = (cmd: string, args: string[]) =>
                new Promise<{ ok: boolean; out: string }>((resolve) => {
                    execFile(cmd, args, { cwd: ws.uri.fsPath }, (err, stdout, stderr) =>
                        resolve({ ok: !err, out: (stdout || stderr || err?.message || '').trim() })
                    );
                });

            const inside = await run('git', ['rev-parse', '--is-inside-work-tree']);
            if (!inside.ok || inside.out !== 'true') {
                vscode.window.showWarningMessage('Este workspace no es un repositorio git.');
                return;
            }
            await run('git', ['add', '-A']);
            const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const commit = await run('git', [
                'commit',
                '--no-verify',
                '--no-gpg-sign',
                '-m',
                `checkpoint(giskard): ${stamp}`
            ]);
            if (commit.ok) {
                const hash = (await run('git', ['rev-parse', '--short', 'HEAD'])).out;
                vscode.window.showInformationMessage(`📍 Checkpoint creado (${hash}) — puedes volver con git.`);
            } else if (commit.out.includes('nothing to commit')) {
                vscode.window.showInformationMessage('📍 Sin cambios que checkpointear — el workspace ya está limpio.');
            } else {
                vscode.window.showErrorMessage(`Checkpoint falló: ${commit.out}`);
            }
        })
    ];
}
