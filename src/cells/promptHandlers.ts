/**
 * Giskard Assistant VSCode Extension — Prompt Handlers
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatWebview.ts (v4.3.0 wave 9): el orquestador _handlePrompt.
 * Recibe el host vía PromptHost (structurally satisfied por la célula del chat).
 */

import * as vscode from 'vscode';
import { ConnectionModelsGroup } from '../core/api';
import { ConnectionStore } from '../core/connectionStore';
import { getModelMaxContextWindow } from '../core/contextWindow';
import { AgentState, AgentLoopContext, loadProjectRules, agentLoopOllama } from './agentLoop';
import { DiffContext, maybeAutoTriggerDiff } from './diffHandlers';
import { handleOpenFile } from './toolHandlers';
import { clearAgentActivity } from './statusBar';
import { getActiveMcpPromptContext } from './mcpHandlers';
import { getClientId, getClientToken, getConnectorUrl } from '../core/api';
import {
    buildSystemHeader,
    extractOpenFileTarget,
    extractSseContentToken,
    includeActiveFileContext,
    injectWorkspacePrefix,
    maybeApplyLastResponse,
    PROVIDER_DISPLAY_NAMES,
    resolvePromptTarget
} from './promptBuilder';

/** Dependencias del orquestador de prompts (implementado por GiskardChatWebviewProvider). */
export interface PromptHost {
    getView(): vscode.WebviewView | undefined;
    store: ConnectionStore;
    agentState: AgentState;
    modelConnectionMap: Map<string, ConnectionModelsGroup>;
    isLocalStreaming(): boolean;
    setLocalStreaming(v: boolean): void;
    getAbort(): AbortController | null;
    setAbort(controller: AbortController | null): void;
    agentCtx(): AgentLoopContext;
    diffCtx(): DiffContext;
    streamRemote(
        baseUrl: string,
        apiKey: string,
        model: string,
        fullPrompt: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        tabId?: string
    ): Promise<void>;
    streamOllamaFallback(
        fullPrompt: string,
        targetModel: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        customOllamaUrl?: string,
        tabId?: string
    ): Promise<void>;
    resolveGiskardSysOllama(connectorUrl: string): Promise<string | null>;
}

export async function handlePrompt(
    host: PromptHost,
    prompt: string,
    model: string,
    includeActiveFile: boolean,
    contextType: string,
    tabId?: string
): Promise<void> {
    const view = host.getView();
    if (!view) return;

    // Auto-open file if prompt explicitly requests opening a file
    const targetPathMatch = extractOpenFileTarget(prompt);
    if (targetPathMatch) {
        await handleOpenFile(targetPathMatch);
    }

    // Conversational apply flow ("aplícala", "hazlo", "sí"...) — promptBuilder
    if (await maybeApplyLastResponse(host, prompt, model, tabId, targetPathMatch)) return;

    let fullPrompt = prompt;

    host.agentState.lastTabId = tabId;

    // Reglas de proyecto automáticas: AGENTS.md / CLAUDE.md / .cursorrules / README.md
    const projectRules = await loadProjectRules();

    // 1. Check if Giskard-Sys active connection is present
    const giskardConn = host.store.getActiveLocal();
    const isGiskardActive =
        giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500'));

    // 2. Check active MCP context
    const mcpContext = getActiveMcpPromptContext(host.store);

    // System header: reglas + capacidades + memoria + MCP/seguridad (promptBuilder)
    const systemHeader = await buildSystemHeader({
        projectRules,
        isGiskardActive: Boolean(isGiskardActive),
        giskardUrl: giskardConn?.url || '',
        mcpContext
    });
    fullPrompt = systemHeader + fullPrompt;

    // Passive workspace context injection
    fullPrompt = injectWorkspacePrefix(fullPrompt);

    const activeConn = host.store.getActive();
    const targetModel = model || host.store.getEnabledModels()[0] || '';
    if (!targetModel) {
        view.webview.postMessage({
            type: 'streamError',
            tabId,
            error: '⚠️ Sin conexión ni modelos disponibles. Por favor verifica tus conexiones activas o añade una nueva en Settings ⚙️.'
        });
        return;
    }
    const maxContext = getModelMaxContextWindow(targetModel);

    // Intelligent Connection-Aware Provider Resolution
    const connGroup = host.modelConnectionMap.get(targetModel);

    // Intelligent Connection-Aware Provider Resolution (promptBuilder)
    const target = await resolvePromptTarget(host.store, targetModel, connGroup);
    const isRemoteConnection = target.isRemoteConnection;
    const resolvedRemoteUrl = target.resolvedRemoteUrl;
    const apiKey = target.apiKey;
    const targetTag = target.targetTag;

    if (includeActiveFile) {
        fullPrompt = includeActiveFileContext(fullPrompt, maxContext, targetModel);
    }

    // ── Local Model Concurrency Lock ──────────────────────────────────────
    if (!isRemoteConnection) {
        if (host.isLocalStreaming()) {
            view.webview.postMessage({
                type: 'streamError',
                model: targetModel,
                tabId,
                error: `⚠️ Modelo local ocupado.\n\nYa hay un modelo local en ejecución en otro sub-chat. Los modelos locales requieren recursos exclusivos de cómputo.\n\n💡 Espera a que el chat anterior termine antes de iniciar otro modelo local.`
            });
            return;
        }
        host.setLocalStreaming(true);
    }

    // ── Resolve Provider Display Name ─────────────────────────────────────
    let _providerDisplay: string;
    if (isRemoteConnection) {
        const _tagUp = (targetTag || 'remote').toUpperCase();
        _providerDisplay = PROVIDER_DISPLAY_NAMES[_tagUp] || `${_tagUp} API`;
    } else {
        _providerDisplay = targetTag === 'ollama' ? 'Ollama (local)' : 'Giskard-Sys Backend (local)';
    }

    view.webview.postMessage({
        type: 'streamStatus',
        phase: 'connecting',
        provider: _providerDisplay,
        isLocal: !isRemoteConnection,
        model: targetModel,
        tabId
    });

    try {
        // ── Outer try for local model lock cleanup ────────────────────────

        // 1. Explicit Local Ollama Model (starts with "local:")
        if (targetModel.startsWith('local:')) {
            const localModelName = targetModel.replace(/^local:/, '');
            const ollamaUrl =
                targetTag === 'ollama' && resolvedRemoteUrl ? resolvedRemoteUrl : 'http://127.0.0.1:11434';
            // Fase 2: host-side agent loop with real message history
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(
                host.agentCtx(),
                systemMsg,
                userMsg,
                localModelName,
                ollamaUrl,
                prompt,
                targetPathMatch,
                includeActiveFile,
                tabId
            );
            return;
        }

        // 2. REMOTE AI MODELS (Direct communication with remote AI provider endpoints)
        if (isRemoteConnection) {
            if (!apiKey || !apiKey.trim()) {
                const vendorTag =
                    targetTag ||
                    (targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote');
                // Try to find if the connection exists but just has no key stored
                const existingConn = host.store.getConnectionByTag(vendorTag);
                const hasConn = !!existingConn;
                const connName = existingConn?.name || vendorTag.toUpperCase();
                const errDetail = hasConn
                    ? `La conexión **${connName}** existe pero su API Key no está guardada (o se perdió al reinstalar).\n\n💡 Ve a Settings ⚙️ → Saved AI Connections → encuentra **${connName}** → pega tu API Key y haz clic en **Guardar** o **Activate**.`
                    : `No existe ninguna conexión con Tag '${vendorTag}'.\n\n💡 Ve a Settings ⚙️ → Saved AI Connections → crea una nueva conexión con Tag '${vendorTag}' y pega tu API Key.`;
                view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `⚠️ API Key no encontrada para **${_providerDisplay}** (${targetModel}).\n\n${errDetail}`
                });
                return;
            }
            const remoteUrl = resolvedRemoteUrl || activeConn?.url;
            if (!remoteUrl) {
                const vendorTag =
                    targetTag ||
                    (targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote');
                view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `⚠️ No Base URL configured for remote connection tag '${vendorTag}'. Please check Settings ⚙️.`
                });
                return;
            }
            await host.streamRemote(
                remoteUrl,
                apiKey,
                targetModel,
                fullPrompt,
                prompt,
                targetPathMatch,
                includeActiveFile,
                tabId
            );
            return;
        }

        // 3. Active Connection is OLLAMA DIRECT
        if (targetTag === 'ollama') {
            const ollamaUrl = resolvedRemoteUrl || activeConn?.url || 'http://127.0.0.1:11434';
            // Fase 2: host-side agent loop with real message history
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(
                host.agentCtx(),
                systemMsg,
                userMsg,
                targetModel,
                ollamaUrl,
                prompt,
                targetPathMatch,
                includeActiveFile,
                tabId
            );
            return;
        }

        // 4. DEFAULT: Route through Giskard-Sys Backend Giskard-Sys
        const connectorUrl = resolvedRemoteUrl || activeConn?.url || getConnectorUrl();

        // 4.1 MEJORA: si el backend giskard-sys sirve modelos locales de Ollama
        // (active_provider == "ollama"), usar el bucle agente host-side con
        // lectura real de archivos y multi-paso, en vez del streaming ciego de
        // un solo paso. Las herramientas de escritura y /exec siguen pasando
        // por giskard-sys (sandbox + auditoría), por lo que la seguridad se mantiene.
        const giskardSysOllama = await host.resolveGiskardSysOllama(connectorUrl);
        if (giskardSysOllama) {
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(
                host.agentCtx(),
                systemMsg,
                userMsg,
                targetModel,
                giskardSysOllama,
                prompt,
                targetPathMatch,
                includeActiveFile,
                tabId
            );
            return;
        }

        host.setAbort(new AbortController());
        const signal = host.getAbort()!.signal;

        try {
            const streamUrl = `${connectorUrl}/llm/stream`;
            // Historial compartido con el dashboard: session_id = nombre del workspace
            const sessionName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const payload = {
                prompt: fullPrompt,
                model: targetModel || undefined,
                session_id: sessionName,
                project: sessionName
            };
            const response = await fetch(streamUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'X-Client-Id': getClientId(),
                    // Auth simétrica con giskard-sys: en modo strict el stream
                    // también exige el token (mismo criterio que el resto del API).
                    'X-Client-Token': getClientToken()
                },
                body: JSON.stringify(payload),
                signal
            });

            if (!response.ok || !response.body) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`Servidor respondió HTTP ${response.status}: ${errText}`);
            }

            view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let accumulated = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line || line.startsWith(':')) continue;

                    if (line.startsWith('data:')) {
                        const rawData = line.substring(line.indexOf(':') + 1);
                        if (rawData.trim() === '[DONE]') continue;

                        const tokenStr = rawData.startsWith(' ') ? rawData.substring(1) : rawData;
                        if (!tokenStr) continue;

                        try {
                            const json = JSON.parse(tokenStr.trim());
                            const contentToken = extractSseContentToken(json);

                            if (contentToken) {
                                accumulated += contentToken;
                                view.webview.postMessage({
                                    type: 'streamToken',
                                    token: contentToken,
                                    model: targetModel,
                                    tabId
                                });
                            } else if (tokenStr) {
                                // Token JSON válido sin forma conocida (p. ej. un
                                // tool-call inline `{"tool": ...}`): NO descartarlo.
                                accumulated += tokenStr;
                                view.webview.postMessage({
                                    type: 'streamToken',
                                    token: tokenStr,
                                    model: targetModel,
                                    tabId
                                });
                            }
                        } catch {
                            if (tokenStr) {
                                accumulated += tokenStr;
                                view.webview.postMessage({
                                    type: 'streamToken',
                                    token: tokenStr,
                                    model: targetModel,
                                    tabId
                                });
                            }
                        }
                    }
                }
            }

            host.agentState.lastBotResponse = accumulated;
            clearAgentActivity();
            if (!accumulated.trim()) {
                // Red de seguridad: stream vacío sin error HTTP → dar un mensaje
                // útil en vez de dejar la pantalla en blanco.
                view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: '⚠️ El backend no devolvió ninguna respuesta. Verifica que el modelo exista en Ollama y que el motor esté corriendo (http://localhost:11434).'
                });
                return;
            }
            view.webview.postMessage({ type: 'streamComplete', model: targetModel, tabId });
            await maybeAutoTriggerDiff(
                host.diffCtx(),
                prompt,
                accumulated,
                targetPathMatch,
                includeActiveFile
            );
        } catch (err: any) {
            if (err.name === 'AbortError') return;

            try {
                view.webview.postMessage({ type: 'offlineMode', active: true });
                view.webview.postMessage({
                    type: 'streamStatus',
                    phase: 'connecting',
                    provider: 'Ollama (local · fallback)',
                    isLocal: true,
                    model: targetModel,
                    tabId
                });
                await host.streamOllamaFallback(
                    fullPrompt,
                    targetModel,
                    prompt,
                    targetPathMatch,
                    includeActiveFile,
                    undefined,
                    tabId
                );
            } catch (fallbackErr: any) {
                if (fallbackErr.name !== 'AbortError') {
                    view.webview.postMessage({
                        type: 'streamError',
                        model: targetModel,
                        tabId,
                        error: `Conexión fallida y Ollama offline: ${err.message}`
                    });
                }
            }
        } finally {
            host.setAbort(null);
        }
    } finally {
        // ── Outer finally: clear local model lock ─────────────────────
        if (!isRemoteConnection) {
            host.setLocalStreaming(false);
        }
    }
}
