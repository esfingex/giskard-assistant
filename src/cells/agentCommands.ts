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
import { addRun, removeRun, updateRun } from '../core/agentRegistry';
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

            const enabled = store.getEnabledModels();
            const model = await vscode.window.showInputBox({
                prompt: 'Modelo para este agente (remoto = corre en paralelo)',
                value: enabled[0] || '',
                placeHolder: 'ej. deepseek/deepseek-chat (OpenRouter) o llama-3.3-70b (NIM)'
            });
            if (!model || !model.trim()) return;

            const defaultName = task.trim().slice(0, 40) + (task.trim().length > 40 ? '…' : '');
            const name =
                (await vscode.window.showInputBox({
                    prompt: 'Nombre del run',
                    value: defaultName
                })) || defaultName;

            const run = addRun(makeAgentRunState(context), { name, task: task.trim(), model: model.trim() });
            tree.refresh();
            vscode.window.showInformationMessage(`🛰️ Agente "${name}" lanzado (${model}).`);
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
