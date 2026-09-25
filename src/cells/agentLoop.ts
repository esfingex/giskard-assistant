/**
 * Giskard Assistant VSCode Extension — Agent Loop
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 3).
 * Host-side agent loop for local Ollama models: model → read-only tools → model,
 * with history + token budget, plus project rules/memory loading, auto-verify,
 * BCF memory compression and plan approval re-prompt.
 *
 * Functions are pure of `this` — they receive the context explicitly.
 */

import * as vscode from 'vscode';
import { fetchWithTimeout, getClientId, getConnectorUrl } from '../core/api';
import { buildChatMessages, trimHistory, getModelMaxContextWindow, ChatMessage } from '../core/contextWindow';
import { executeReadOnlyTool, extractToolCalls } from './toolHandlers';
import { setAgentActivity, clearAgentActivity } from './statusBar';

/** Mutable model/context state shared between the chat cell and the loop. */
export interface AgentState {
    lastModel: string;
    lastOllamaUrl: string;
    lastTabId?: string;
    lastBotResponse: string;
}

/** Explicit dependency bag passed by the chat cell. */
export interface AgentLoopContext {
    view?: vscode.WebviewView;
    agentState: AgentState;
    tabHistory: Map<string, ChatMessage[]>;
    streamChat(messages: ChatMessage[], model: string, ollamaUrl: string, tabId?: string): Promise<string>;
    maybeAutoTriggerDiff(
        userPrompt: string,
        reply: string,
        extractedPath?: string,
        includeActiveFile?: boolean
    ): Promise<void>;
    handlePrompt(
        prompt: string,
        model?: string,
        includeFile?: boolean,
        mode?: string,
        tabId?: string
    ): Promise<void>;
    clearAbort(): void;
    firstEnabledModel(): string;
}

/** Presupuesto de pasos máximo del bucle agéntico */
const MAX_AGENT_STEPS = 6;

// ── Límite de auto-correcciones (Req 3, wave 012) ─────────────────────────────
let _verifyIterations = 0;

export function resetVerifyIterations(): void {
    _verifyIterations = 0;
}

// ── Caché de memoria de proyecto (60s) ────────────────────────────────────────
let _projectMemoryCache: { at: number; text: string | null } | null = null;

/**
 * Lee las reglas del proyecto abierto (AGENTS.md, CLAUDE.md, .cursorrules,
 * README.md) y las devuelve como bloque de texto acotado para inyectar
 * en el system header. Sin archivos de reglas devuelve ''.
 */
export async function loadProjectRules(): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return '';
    const root = folders[0].uri;
    const names = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'README.md'];
    const parts: string[] = [];
    for (const n of names) {
        try {
            const uri = vscode.Uri.joinPath(root, n);
            const data = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(data);
            const capped = text.slice(0, 2500);
            if (capped.trim()) parts.push(`-- ${n} --\n${capped}`);
        } catch {
            /* el archivo no existe */
        }
    }
    return parts.join('\n\n');
}

/**
 * Req 5 (wave 012): lee la memoria nativa del proyecto (memorias y
 * decisiones recientes) desde giskard-sys para continuidad de sesion.
 * Cacheada 60s.
 */
export async function fetchProjectMemory(): Promise<string | null> {
    const now = Date.now();
    if (_projectMemoryCache && now - _projectMemoryCache.at < 60000) {
        return _projectMemoryCache.text;
    }
    const wsName = vscode.workspace.workspaceFolders?.[0]?.name || '';
    if (!wsName) {
        return null;
    }
    try {
        const url = `${getConnectorUrl()}/memory/graph?filter=project:${encodeURIComponent(wsName)}&limit=3`;
        const res = await fetchWithTimeout(url, { headers: { 'X-Client-Id': getClientId() } }, 8000).catch(
            () => null
        );
        if (!res || !res.ok) {
            _projectMemoryCache = { at: now, text: null };
            return null;
        }
        const data: any = await res.json().catch(() => null);
        const nodes = data && data.data && data.data.nodes;
        if (!Array.isArray(nodes) || nodes.length === 0) {
            _projectMemoryCache = { at: now, text: null };
            return null;
        }
        const lines = nodes
            .map((n: any) => `- [${n.kind}] ${n.title ? n.title + ': ' : ''}${n.content}`)
            .join('\n');
        _projectMemoryCache = { at: now, text: lines };
        return lines;
    } catch {
        _projectMemoryCache = { at: now, text: null };
        return null;
    }
}

/** Fase 2: host-side agent loop for local Ollama models — model → read-only tools → model, with history + budget */
export async function agentLoopOllama(
    ctx: AgentLoopContext,
    system: string,
    userContent: string,
    model: string,
    ollamaUrl: string,
    userPrompt: string,
    extractedPath?: string,
    includeActiveFile?: boolean,
    tabId?: string
): Promise<void> {
    const view = ctx.view;
    if (!view) return;
    ctx.agentState.lastModel = model;
    ctx.agentState.lastOllamaUrl = ollamaUrl;
    const key = tabId || '_main';
    let history = ctx.tabHistory.get(key) || [];
    // Presupuesto dinámico: prompt debe caber en num_ctx - num_predict - margen
    const numCtx = Math.min(getModelMaxContextWindow(model), 32768);
    const predictBudget = 8192;
    const margin = 2000;
    const loopBudget = Math.max(4000, numCtx - predictBudget - margin);
    let messages = buildChatMessages(history, system, userContent, loopBudget);
    let finalReply = '';

    try {
        for (let step = 0; step < MAX_AGENT_STEPS; step++) {
            if (step > 0) {
                view.webview.postMessage({
                    type: 'streamToken',
                    token: `\n\n--- 🔧 Paso ${step + 1} del agente ---\n`,
                    model,
                    tabId
                });
            }
            const reply = await ctx.streamChat(messages, model, ollamaUrl, tabId);
            messages = trimHistory([...messages, { role: 'assistant', content: reply }], loopBudget);

            const calls = extractToolCalls(reply);
            if (calls.length === 0) {
                finalReply = reply;
                break;
            }

            const readOnly = calls.filter((c) =>
                ['read_file', 'list_dir', 'search', 'glob'].includes((c.action || '').toLowerCase())
            );
            const blocking = calls.filter(
                (c) => !['read_file', 'list_dir', 'search', 'glob'].includes((c.action || '').toLowerCase())
            );

            // Blocking tools (write/exec) end the loop: the user applies via the existing UI
            if (blocking.length > 0) {
                finalReply = reply;
                view.webview.postMessage({
                    type: 'streamToken',
                    token: `\n\n[ℹ️] El modelo pidió ${blocking.map((b) => b.action).join(', ')} — aplícalo con el botón 📝 Apply Change.\n`,
                    model,
                    tabId
                });
                break;
            }

            for (const call of readOnly) {
                setAgentActivity(`${call.action} ${call.path || call.query || call.pattern || ''}…`);
                const res = await executeReadOnlyTool(call);
                messages = trimHistory([...messages, { role: 'tool', content: res.output }], loopBudget);
                view.webview.postMessage({
                    type: 'streamToken',
                    token: `\n\n[🔧 ${res.ok ? 'OK' : 'ERROR'} ${call.action} ${call.path || call.query || call.pattern || ''}]\n`,
                    model,
                    tabId
                });
            }
            setAgentActivity('razonando…');
        }

        if (!finalReply && messages.length > 0) {
            finalReply = messages[messages.length - 1].content || '';
        }

        // Persist history (user turn + final assistant reply), keep the window fresh
        history = trimHistory(
            [...history, { role: 'user', content: userContent }, { role: 'assistant', content: finalReply }],
            loopBudget
        );
        if (history.length > 40) history = history.slice(-40);
        ctx.tabHistory.set(key, history);

        ctx.agentState.lastBotResponse = finalReply;
        clearAgentActivity();
        view.webview.postMessage({ type: 'streamComplete', model, tabId });
        await ctx.maybeAutoTriggerDiff(userPrompt, finalReply, extractedPath, includeActiveFile);
    } catch (err: any) {
        if (err.name === 'AbortError') return;
        clearAgentActivity();
        if (view) {
            view.webview.postMessage({
                type: 'streamError',
                model,
                tabId,
                error: `❌ Error en el bucle agente (${model}): ${err?.message || err}`
            });
        }
    } finally {
        ctx.clearAbort();
    }
}

/**
 * Corre la suite del proyecto (cargo test / npm test) vía giskard-sys /exec
 * después de aplicar cambios. Si falla, pide UNA corrección al modelo local
 * y muestra el diff propuesto (no se aplica automáticamente).
 */
export async function autoVerifyAndFix(ctx: AgentLoopContext): Promise<void> {
    const view = ctx.view;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    // Req 3 (wave 012): limite de auto-correcciones consecutivas (3).
    _verifyIterations += 1;
    if (_verifyIterations > 3) {
        view?.webview.postMessage({
            type: 'streamToken',
            token: `\n🛑 Limite de auto-correcciones (3) alcanzado. Revisa los tests manualmente.\n`,
            model: ctx.agentState.lastModel,
            tabId: ctx.agentState.lastTabId
        });
        return;
    }
    const root = folders[0].uri;
    let cmd: string | null = null;
    try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'Cargo.toml'));
        cmd = 'cargo';
    } catch {
        /* no rust */
    }
    if (!cmd) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'package.json'));
            cmd = 'npm';
        } catch {
            /* no node */
        }
    }
    if (!cmd || !view) return;

    const model = ctx.agentState.lastModel || '';
    const tabId = ctx.agentState.lastTabId;
    view.webview.postMessage({
        type: 'streamToken',
        token: `\n\n🧪 Ejecutando ${cmd} test...\n`,
        model,
        tabId
    });

    try {
        const res = await fetchWithTimeout(
            `${getConnectorUrl()}/exec`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command: cmd, args: ['test'] })
            },
            180000
        );
        const data: any = await res.json();
        if (!data || !data.success) {
            view.webview.postMessage({
                type: 'streamToken',
                token: `⚠️ No se pudieron correr tests: ${(data && data.error) || 'error'}\n`,
                model,
                tabId
            });
            return;
        }
        const out: string = data.data || '';
        if (out.includes('EXIT CODE: 0')) {
            _verifyIterations = 0;
            view.webview.postMessage({ type: 'streamToken', token: `✅ Tests pasaron.\n`, model, tabId });
            return;
        }
        const tail = out.split('\n').filter(Boolean).slice(-8).join('\n');
        view.webview.postMessage({
            type: 'streamToken',
            token: `❌ Tests fallaron:\n${tail.substring(0, 900)}\n`,
            model,
            tabId
        });

        if (ctx.agentState.lastModel && ctx.agentState.lastOllamaUrl) {
            view.webview.postMessage({
                type: 'streamToken',
                token: `\n🔧 Pidiendo una corrección al modelo local...\n`,
                model,
                tabId
            });
            const systemMsg =
                'You are an integrated coding agent in VS Code. Fix the failing tests by editing the relevant source file. Output ONLY the corrected code block with the file path as the first comment line.';
            const fixPrompt = `The project tests are failing after the last edit. Test output:\n${tail.substring(0, 1500)}\n\nAnalyze the failure and fix the code.`;
            await agentLoopOllama(
                ctx,
                systemMsg,
                fixPrompt,
                ctx.agentState.lastModel,
                ctx.agentState.lastOllamaUrl,
                fixPrompt,
                undefined,
                false,
                tabId
            );
        }
    } catch {
        /* verificación best-effort */
    }
}

export async function compressMemory(
    view: vscode.WebviewView | undefined,
    historyText: string
): Promise<void> {
    if (!view) return;
    try {
        const wsName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        // Guardar via giskard-sys /memory/add (memoria nativa por proyecto, wave 009)
        const res = await fetchWithTimeout(
            `${getConnectorUrl()}/memory/add`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({
                    project: wsName,
                    category: 'flow',
                    content: historyText,
                    tags: 'compressed,chat'
                })
            },
            15000
        );
        const data: any = await res.json().catch(() => null);
        const msg =
            data && data.success
                ? '✓ Memoria BCF guardada exitosamente en giskard-sys (memoria nativa).'
                : `Error guardando memoria: ${(data && data.error) || 'error de conexión'}`;

        // Req 5 (wave 012): handoff comun — nodo de continuidad para otros agentes
        const handoffContent = historyText.length > 8000 ? historyText.slice(0, 8000) : historyText;
        await fetchWithTimeout(
            `${getConnectorUrl()}/memory/graph/add_node`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({
                    type: 'handoff',
                    project: wsName,
                    title: `Handoff ${new Date().toISOString().slice(0, 10)}`,
                    description: handoffContent,
                    status: 'active'
                })
            },
            15000
        ).catch(() => null);
        view.webview.postMessage({ type: 'streamToken', token: `\n\n[Sistema]: ${msg}` });
        view.webview.postMessage({ type: 'streamComplete' });
    } catch (err: any) {
        view.webview.postMessage({ type: 'streamError', error: err.message });
    }
}

/** Fase 3b: user approved a [PLAN] — re-prompt the model to execute it step by step */
export async function approvePlan(
    ctx: AgentLoopContext,
    plan: string,
    model?: string,
    tabId?: string
): Promise<void> {
    if (!plan || !plan.trim()) return;
    const targetModel = model || ctx.firstEnabledModel();
    const executionPrompt = `El usuario ha APROBADO el siguiente plan. Ejecútalo ahora paso a paso: lee los archivos que necesites, haz los cambios propuestos y verifica. NO vuelvas a pedir aprobación.\n\n[PLAN APROBADO]:\n${plan}\n\nEjecuta el plan completo.`;
    await ctx.handlePrompt(executionPrompt, targetModel, false, 'none', tabId);
}
