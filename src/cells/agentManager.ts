/**
 * Giskard Assistant VSCode Extension — Célula: Agent Manager (TreeView + Runner)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Orquestación multi-agente estilo Antigravity: cada run es un agente con su
 * propia tarea, modelo y salida (OutputChannel). Los runs remotos corren en
 * paralelo en background; los locales son single-thread (límite de wave 1).
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { AGENT_RUNS_KEY } from '../core/constants';
import {
    AGENT_OUTPUT_CAP,
    AGENT_ROLES,
    AgentRun,
    AgentRunState,
    getRun,
    listRuns,
    updateRun
} from '../core/agentRegistry';
import { resolvePromptTarget } from './promptBuilder';

/** Bolsa de estado persistente de runs sobre globalState */
export function makeAgentRunState(context: vscode.ExtensionContext): AgentRunState {
    return {
        get: () => context.globalState.get<AgentRun[]>(AGENT_RUNS_KEY, []),
        set: (runs) => context.globalState.update(AGENT_RUNS_KEY, runs)
    };
}

const STATUS_ICON: Record<AgentRun['status'], string> = {
    queued: 'clock',
    running: 'sync~spin',
    done: 'check',
    error: 'error',
    cancelled: 'circle-slash'
};

const STATUS_LABEL: Record<AgentRun['status'], string> = {
    queued: '⏳ en cola',
    running: '🔄 ejecutando',
    done: '✅ completado',
    error: '❌ error',
    cancelled: '⛔ cancelado'
};

export class AgentRunTreeItem extends vscode.TreeItem {
    constructor(readonly run: AgentRun) {
        super(run.name, vscode.TreeItemCollapsibleState.None);
        const roleEmoji = AGENT_ROLES[run.role]?.emoji || '🛠️';
        this.description = `${roleEmoji} ${run.model} · ${STATUS_LABEL[run.status]}`;
        this.tooltip = new vscode.MarkdownString(
            `**${run.name}**\n\n- Estado: ${STATUS_LABEL[run.status]}\n- Modelo: ${run.model}\n- Tarea: ${run.task}` +
                (run.error ? `\n\n⚠️ ${run.error}` : '')
        );
        this.iconPath = new vscode.ThemeIcon(STATUS_ICON[run.status]);
        this.contextValue = run.status === 'done' ? 'agentRunDone' : 'agentRun';
        this.command = { command: 'giskard-assistant.openAgentRunOutput', title: 'Ver salida', arguments: [this] };
    }
}

export class GiskardAgentManagerTreeProvider implements vscode.TreeDataProvider<AgentRunTreeItem> {
    private _emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._emitter.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this._emitter.fire();
    }

    getTreeItem(item: AgentRunTreeItem): vscode.TreeItem {
        return item;
    }

    getChildren(): AgentRunTreeItem[] {
        const state = makeAgentRunState(this.context);
        return listRuns(state).map((r) => new AgentRunTreeItem(r));
    }

    getRunById(id: string): AgentRun | null {
        return getRun(makeAgentRunState(this.context), id);
    }
}

/** Ejecutor de runs: streaming SSE remoto en background hacia un OutputChannel. */
export class AgentRunner {
    private _aborts = new Map<string, AbortController>();

    constructor(
        private readonly store: ConnectionStore,
        private readonly context: vscode.ExtensionContext,
        private readonly refresh: () => void
    ) {}

    isRunning(id: string): boolean {
        return this._aborts.has(id);
    }

    cancel(id: string): void {
        this._aborts.get(id)?.abort();
    }

    async start(run: AgentRun): Promise<void> {
        const state = makeAgentRunState(this.context);
        const finish = (patch: Partial<AgentRun>) => {
            updateRun(state, run.id, { endedAt: new Date().toISOString(), ...patch });
            this.refresh();
        };

        const target = await resolvePromptTarget(this.store, run.model, undefined);
        if (!target.isRemoteConnection || !target.resolvedRemoteUrl) {
            finish({
                status: 'error',
                error:
                    'Wave 1 del Agent Manager solo corre modelos REMOTOS en paralelo (los locales son single-thread). Activa una conexión remota y elige uno de sus modelos.'
            });
            return;
        }

        const channel = vscode.window.createOutputChannel(`Giskard Agent · ${run.name}`);
        channel.show(true);
        channel.appendLine(`▶️ ${run.name} — modelo: ${run.model}`);
        channel.appendLine(`📌 Tarea: ${run.task}`);
        channel.appendLine('─'.repeat(60));
        finish({ status: 'running', endedAt: undefined });

        const ac = new AbortController();
        this._aborts.set(run.id, ac);
        const base = target.resolvedRemoteUrl.replace(/\/$/, '');
        const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

        // NIM encola los modelos grandes (550b puede tardar minutos en dar el
        // primer token). Latido de espera + timeout de cola con error claro.
        const isLargeModel = /550b|405b|671b|235b|200b|ultra/i.test(run.model);
        const queueTimeoutMs = isLargeModel ? 600_000 : 180_000;
        const startedAt = Date.now();
        let firstTokenAt: number | null = null;
        let timedOut = false;
        const queueTimer = setTimeout(() => {
            if (!firstTokenAt) {
                timedOut = true;
                ac.abort();
            }
        }, queueTimeoutMs);
        const heartbeat = setInterval(() => {
            if (!firstTokenAt) {
                const s = Math.round((Date.now() - startedAt) / 1000);
                channel.appendLine(
                    `⏱ ${s}s sin primer token — el modelo puede estar en cola (NIM encola los grandes)`
                );
            }
        }, 30_000);

        try {
            channel.appendLine(`🔄 Conectando a ${base}…`);
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${target.apiKey}`
                },
                body: JSON.stringify({
                    model: run.model,
                    stream: true,
                    messages: [
                        { role: 'system', content: AGENT_ROLES[run.role]?.prompt || AGENT_ROLES.ejecutor.prompt },
                        { role: 'user', content: run.task }
                    ]
                }),
                signal: ac.signal
            });
            if (!res.ok || !res.body) {
                const errText = await res.text().catch(() => res.statusText);
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let acc = '';
            let reasoningAcc = '';
            let inReasoning = false;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (!data || data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        const choice = json.choices && json.choices[0];
                        const delta = choice?.delta || choice?.message || {};
                        // Razonamiento (nemotron-3, deepseek-r1, o1...): se muestra
                        // en el canal — sin esto el run parece colgado mientras
                        // el modelo piensa minutos antes del primer contenido.
                        const reasonTok = delta.reasoning_content || delta.reasoning || '';
                        if (reasonTok) {
                            if (!firstTokenAt) {
                                firstTokenAt = Date.now();
                                channel.appendLine(
                                    `🧠 Primer token en ${Math.round((firstTokenAt - startedAt) / 1000)}s — razonando…`
                                );
                            }
                            if (!inReasoning) {
                                inReasoning = true;
                                channel.appendLine('🧠 ── Razonamiento ──');
                            }
                            reasoningAcc += reasonTok;
                            channel.append(reasonTok);
                            continue;
                        }
                        const tok = delta.content || json.response || '';
                        if (tok) {
                            if (!firstTokenAt) {
                                firstTokenAt = Date.now();
                                channel.appendLine(
                                    `🧠 Primer token en ${Math.round((firstTokenAt - startedAt) / 1000)}s`
                                );
                            }
                            if (inReasoning) {
                                inReasoning = false;
                                channel.appendLine(`\n── fin razonamiento (${reasoningAcc.length} chars) ──\n💬 Respuesta:`);
                            }
                            acc += tok;
                            channel.append(tok);
                        }
                    } catch {
                        // chunk SSE no-JSON: best-effort, se ignora
                    }
                }
            }
            clearInterval(heartbeat);
            clearTimeout(queueTimer);

            if (!acc.trim() && !reasoningAcc.trim()) {
                throw new Error('El modelo no devolvió ninguna respuesta (stream vacío)');
            }
            const totalS = Math.round((Date.now() - startedAt) / 1000);
            channel.appendLine(
                `\n${'─'.repeat(60)}\n✅ Completado en ${totalS}s — respuesta ${acc.length} chars, razonamiento ${reasoningAcc.length} chars`
            );
            // Salida guardada (recortada) para encadenar el siguiente paso del ciclo
            finish({ status: 'done', output: (acc || reasoningAcc).slice(0, AGENT_OUTPUT_CAP) });
        } catch (err: any) {
            clearInterval(heartbeat);
            clearTimeout(queueTimer);
            if (timedOut) {
                const waitMin = Math.round(queueTimeoutMs / 60000);
                channel.appendLine(`\n⏱ Sin primer token tras ${waitMin} min — probablemente en cola de NIM`);
                finish({
                    status: 'error',
                    error: `Sin primer token tras ${waitMin} min (cola de NIM para modelos grandes). Reintenta o usa un modelo más chico.`
                });
            } else if (ac.signal.aborted) {
                channel.appendLine(`\n⛔ Cancelado por el usuario`);
                finish({ status: 'cancelled' });
            } else {
                channel.appendLine(`\n❌ ${err.message}`);
                finish({ status: 'error', error: err.message });
            }
        } finally {
            clearInterval(heartbeat);
            clearTimeout(queueTimer);
            this._aborts.delete(run.id);
        }
    }
}
