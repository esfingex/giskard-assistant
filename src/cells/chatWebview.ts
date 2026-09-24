/**
 * Giskard Assistant VSCode Extension — Cell: Chat Webview Sidebar
 * Copyright (C) 2025-2026 Giskard Project
 *
 * All HTML layout CSS lives in src/cells/htmlShell.ts.
 * MCP operations live in src/cells/mcpHandlers.ts.
 * Tool call bridge ops live in src/cells/toolHandlers.ts.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import {
    getConnectorUrl,
    getClientId,
    getClientToken,
    execCliCommand,
    fetchLlmModels,
    fetchLlmModelsGrouped,
    ConnectionModelsGroup,
    checkHealth,
    resetSession
} from '../core/api';
import { ConnectionStore } from '../core/connectionStore';
import { EventBus, EventPayload } from '../core/eventBus';
import { getHtmlForWebview } from './htmlShell';
import { sendMcpServersList, getActiveMcpPromptContext } from './mcpHandlers';
import { handleOpenFile, extractCodeBlocks } from './toolHandlers';
import { clearAgentActivity } from './statusBar';
import { ChatMessage, getModelMaxContextWindow } from '../core/contextWindow';
import {
    AgentState,
    AgentLoopContext,
    loadProjectRules,
    fetchProjectMemory,
    agentLoopOllama,
    autoVerifyAndFix
} from './agentLoop';
import {
    StreamContext,
    streamFromGiskardSys,
    streamFromOllamaLegacy,
    streamOllamaChat,
    streamFromRemoteApi,
    resolveGiskardSysOllama
} from './streamManager';
import { HostToWebviewMessage } from '../core/webviewContract';
import { DiffContext, maybeAutoTriggerDiff, openDiff, revertLastAiEdit } from './diffHandlers';
import { KnowledgeContext } from './knowledgeHandlers';
import { ChatStateContext, sendModelsList } from './chatStateHandlers';
import { ChatRouterDeps, setWebviewMessageListener } from './messageRouter';
import { ConnectionsContext, sendConnectionsList } from './connectionsHandlers';

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'giskard-assistant.chatView';

    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;
    private _localModelStreaming: boolean = false;
    private _modelConnectionMap: Map<string, ConnectionModelsGroup> = new Map();

    /** Últimos modelo/URL/tab usados — para el bucle auto-corrector con tests */
    private _agentState: AgentState = { lastModel: '', lastOllamaUrl: '', lastBotResponse: '' };

    /** Fase 2: per-tab chat history (messages[]) for the host-side agent loop */
    private _tabHistory: Map<string, ChatMessage[]> = new Map();
    private readonly _agentLoopBudget = 28000; // safe margin under the 32K local window

    /** Snapshots of AI edits (original content) for one-click revert */

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _store: ConnectionStore,
        private readonly _context?: vscode.ExtensionContext
    ) {
        EventBus.instance.onDidChange(async (e: EventPayload) => {
            if (e.event === 'modelsUpdated' || e.event === 'modelToggled' || e.event === 'connectionChanged') {
                await this.refreshState();
            }
        });
    }

    /** Revert the most recent AI edit (Fase 3: snapshot + revert) */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = await getHtmlForWebview(this._extensionUri, webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);

        await this.refreshState();
    }

    private _panel?: vscode.WebviewPanel;

    public async attachPanel(panel: vscode.WebviewPanel) {
        this._panel = panel;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        panel.webview.html = await getHtmlForWebview(this._extensionUri, panel.webview);
        this._setWebviewMessageListener(panel.webview);

        panel.onDidDispose(() => {
            if (this._activeAbortController) {
                this._activeAbortController.abort();
            }
            this._panel = undefined;
        });

        await this.refreshState();
    }

    public get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    public async refreshState() {
        const enabledModels = this._store.getEnabledModels();
        const patterns = this._store.getExclusionPatterns();

        if (this._view) {
            this._view.webview.postMessage({ type: 'setEnabledModels', enabledModels });
            this._view.webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
        }
        if (this._panel) {
            this._panel.webview.postMessage({ type: 'setEnabledModels', enabledModels });
            this._panel.webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
        }

        await sendConnectionsList(this._cellCtx());
        await sendModelsList(this._stateCtx());
        if (this._view) await sendMcpServersList(this._view, this._store);
    }

    public postMessage(message: HostToWebviewMessage) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
        if (this._panel) {
            this._panel.webview.postMessage(message);
        }
    }

    public injectCodeContext(contextBlock: { relativePath: string; startLine: number; endLine: number; code: string; lang: string }) {
        this.postMessage({
            type: 'injectCodeSnippet',
            contextBlock
        });
    }

    /** Dependencias del router de mensajes (decomposition wave 6b) */
    private _routerDeps(): ChatRouterDeps {
        return {
            getView: () => this._view,
            abortActive: () => {
                if (this._activeAbortController) {
                    this._activeAbortController.abort();
                    this._activeAbortController = null;
                }
            },
            tabHistory: this._tabHistory,
            resetSession: () => resetSession(),
            refreshState: () => this.refreshState(),
            handlePrompt: (prompt, model, includeActiveFile, contextType, tabId) =>
                this._handlePrompt(prompt, model || '', Boolean(includeActiveFile), contextType || 'none', tabId),
            store: this._store,
            cellCtx: () => this._cellCtx(),
            stateCtx: () => this._stateCtx(),
            diffCtx: () => this._diffCtx(),
            agentCtx: () => this._agentCtx(),
            knowledgeCtx: () => this._knowledgeCtx()
        };
    }

    /** Contexto para la célula de estado (decomposition wave 6) */
    private _stateCtx(): ChatStateContext {
        return {
            view: this._view,
            panel: this._panel,
            store: this._store,
            modelConnectionMap: this._modelConnectionMap,
            postMessage: (m) => this.postMessage(m),
            extensionContext: this._context
        };
    }

    /** Contexto para la célula de conocimiento (decomposition wave 5) */
    private _knowledgeCtx(): KnowledgeContext {
        return { view: this._view, store: this._store };
    }

    /** Contexto para la célula de diffs (decomposition wave 4) */
    private _diffCtx(): DiffContext {
        return {
            onEditApplied: () => autoVerifyAndFix(this._agentCtx()).catch(() => { /* best-effort */ })
        };
    }

    /** Contexto para la célula del bucle agéntico (decomposition wave 3) */
    private _agentCtx(): AgentLoopContext {
        return {
            view: this._view,
            agentState: this._agentState,
            tabHistory: this._tabHistory,
            streamChat: (messages, model, ollamaUrl, tabId) => this._streamOllamaChat(messages, model, ollamaUrl, tabId),
            maybeAutoTriggerDiff: (u, r, pf, f) => maybeAutoTriggerDiff(this._diffCtx(), u, r, pf, f),
            handlePrompt: (prompt, model, includeFile, mode, tabId) => this._handlePrompt(prompt, model || '', Boolean(includeFile), mode || 'none', tabId),
            clearAbort: () => { this._activeAbortController = null; },
            firstEnabledModel: () => this._store.getEnabledModels()[0] || ''
        };
    }

    /** Contexto compartido para las células extraídas (decomposition wave 2+) */
    private _cellCtx(): ConnectionsContext {
        return {
            view: this._view,
            panel: this._panel,
            store: this._store,
            postMessage: (m) => this.postMessage(m),
            refreshState: () => this.refreshState()
        };
    }

    private async _handlePrompt(
        prompt: string,
        model: string,
        includeActiveFile: boolean,
        contextType: string,
        tabId?: string
    ) {
        if (!this._view) return;

        // Auto-open file if prompt explicitly requests opening a file
        const fileMatch = prompt.match(/(?:abre|open|edita|modifica)\s+(?:el\s+archivo\s+|file\s+)?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i);
        const targetPathMatch: string | undefined = (fileMatch && fileMatch[1]) ? fileMatch[1] : undefined;
        if (targetPathMatch) {
            await handleOpenFile(targetPathMatch);
        }

        // Conversational apply flow
        const APPLY_LAST_REGEX = /^\s*(?:hazla|hazlo|ap[lí]ca(?:la|lo|r)?|s[ií]|yes|do it|ejecuta(?:lo|la)?|a[pú]ntalo|aplica|perfecto!?|ok!?|dale!?|listo!?|excelente!?|procede|proceed|apply(?:\s+it)?|use(?:\s+it)?|use\s+that|implement(?:\s+it)?)\s*$/i;
        if (APPLY_LAST_REGEX.test(prompt.trim()) && this._agentState.lastBotResponse.trim()) {
            const blocks = extractCodeBlocks(this._agentState.lastBotResponse);
            if (blocks.length > 0) {
                if (this._view) {
                    this._view.webview.postMessage({ type: 'streamToken', token: '📦 Aplicando código propuesto en el editor...', model, tabId });
                    this._view.webview.postMessage({ type: 'streamComplete', model, tabId });
                }
                let best = blocks[0];
                for (const b of blocks) {
                    if (b.filePath) { best = b; break; }
                    if (b.code.length > best.code.length) best = b;
                }
                await openDiff(this._diffCtx(), best.code, best.filePath || targetPathMatch);
                return;
            }
        }

        let fullPrompt = prompt;

        this._agentState.lastTabId = tabId;

        // Reglas de proyecto automáticas: AGENTS.md / CLAUDE.md / .cursorrules / README.md
        const projectRules = await loadProjectRules();

        // 1. Check if Giskard-Sys active connection is present
        const giskardConn = this._store.getActiveLocal();
        const isGiskardActive = giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500'));

        // 2. Check active MCP context
        const mcpContext = getActiveMcpPromptContext(this._store);

        // Build System Capability Context Header
        let systemHeader = `${projectRules ? `[PROJECT RULES — sigue estas reglas del proyecto]
${projectRules}

` : ''}[VS CODE AGENT CAPABILITIES]: You are an integrated coding agent in VS Code.
• REASONING & THINKING: Put step-by-step internal reasoning inside <thinking>...</thinking> tags before providing your answer.
• TOOL EXECUTION: Emit tool calls as <tool_call>{"action": "read_file", "path": "src/extension.ts"}</tool_call> or [TOOL_CALL] {"tool": "read_file", "args": {"path": "src/extension.ts"}} [/END_TOOL].
• TO WRITE OR EDIT A FILE: Place a comment with the relative file path on line 1 of your code block (e.g. // src/extension.ts).
• TO LIST A DIRECTORY: Emit [TOOL_CALL] {"tool": "list_dir", "args": {"path": "src"}} [/END_TOOL].
• TO SEARCH FILE CONTENTS: Emit [TOOL_CALL] {"tool": "search", "args": {"query": "functionName"}} [/END_TOOL].
• TO GLOB FILES: Emit [TOOL_CALL] {"tool": "glob", "args": {"pattern": "src/**/*.ts"}} [/END_TOOL].
• TO PROPOSE A PLAN BEFORE EDITING: Wrap your plan in [PLAN] ... [/END_PLAN] and WAIT for the user to approve it before emitting tool calls or code blocks.
• RICH OUTPUT FORMATTING: Use structured GitHub Markdown, fenced code blocks with language tags, diff code blocks for changes, tables, and callouts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING]).
• IGNORED DIRECTORIES: Do NOT attempt to read non-source files or build output directories like node_modules, out/, dist/, target/, build/, or .git/. Focus exclusively on source code files (src/, package.json, README.md, etc.).\n\n`;

        // Req 5 (wave 012): handoff comun — inyecta la memoria del proyecto
        // (memorias y decisiones recientes) desde giskard-sys cuando esta activo.
        if (isGiskardActive) {
            const projectMemory = await fetchProjectMemory();
            if (projectMemory) {
                systemHeader += `[PROJECT MEMORY (giskard-sys) — decisiones y recuerdos recientes del proyecto, respetalos]\n${projectMemory}\n`;
            }
        }

        if (isGiskardActive) {
            systemHeader += `[Capa de Seguridad Giskard-Sys (${giskardConn.url}): ACTIVA | Sandbox Jail + Grafo LTM + Auditoría RTK]\n`;
        }
        if (mcpContext) {
            systemHeader += `${mcpContext}\n`;
        } else if (!isGiskardActive) {
            systemHeader += `[Modo Chat Estándar: Sin herramientas MCP ni servidor Giskard-Sys activos]\n`;
        }

        fullPrompt = systemHeader + fullPrompt;

        // Passive workspace context injection
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const activeFolder = folders[0];
            fullPrompt = `[Proyecto Activo VSCode: ${activeFolder.name} (${activeFolder.uri.fsPath})]\n${fullPrompt}`;
        }

        let activeConn = this._store.getActive();
        const targetModel = model || (this._store.getEnabledModels()[0] || '');
        if (!targetModel) {
            this._view.webview.postMessage({
                type: 'streamError',
                tabId,
                error: '⚠️ Sin conexión ni modelos disponibles. Por favor verifica tus conexiones activas o añade una nueva en Settings ⚙️.'
            });
            return;
        }
        let activeTag = (activeConn?.tag || 'ollama').toLowerCase();
        const maxContext = getModelMaxContextWindow(targetModel);

        // Intelligent Connection-Aware Provider Resolution
        const connGroup = this._modelConnectionMap.get(targetModel);

        let isRemoteConnection = false;
        let resolvedRemoteUrl = '';
        let apiKey = '';
        let targetConnId: number | undefined = undefined;
        let targetTag = '';

        const isExplicitLocal = targetModel.startsWith('local:') || targetModel.startsWith('hf.co/') || targetModel.endsWith('.gguf');

        if (targetModel.startsWith('local:')) {
            isRemoteConnection = false;
            targetTag = 'ollama';
        } else if (targetModel.startsWith('remote:')) {
            isRemoteConnection = true;
            targetTag = 'remote';
        } else if (connGroup) {
            const targetConn = this._store.getAll().find(c => c.id === connGroup.connectionId);
            const isLocalGroup = connGroup.connectionTag === 'giskard-sys' || connGroup.connectionTag === 'ollama' || targetConn?.type === 'local';
            isRemoteConnection = !isLocalGroup;
            targetTag = connGroup.connectionTag;
            targetConnId = connGroup.connectionId;
            resolvedRemoteUrl = connGroup.connectionUrl;
        } else if (!isExplicitLocal) {
            const vendorTag = targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote';
            const tagMatchConn = this._store.getConnectionByTag(vendorTag);
            const anyRemoteConn = tagMatchConn || this._store.getActiveRemote() || this._store.getAll().find(c => c.type === 'remote');

            if (anyRemoteConn) {
                isRemoteConnection = true;
                targetTag = anyRemoteConn.tag;
                targetConnId = anyRemoteConn.id;
                resolvedRemoteUrl = anyRemoteConn.url;
            } else {
                isRemoteConnection = false;
                targetTag = 'giskard-sys';
            }
        } else {
            isRemoteConnection = false;
            targetTag = targetModel.startsWith('local:') ? 'ollama' : 'giskard-sys';
        }

        if (isRemoteConnection) {
            if (targetConnId) {
                apiKey = (await this._store.getApiKey(targetConnId)) || '';
            }
            if (!apiKey) {
                const resolved = await this._store.getAnyRemoteApiKey(targetTag);
                if (resolved) {
                    apiKey = resolved.apiKey;
                    if (resolved.url) resolvedRemoteUrl = resolved.url;
                }
            }
        } else if (targetConnId) {
            apiKey = (await this._store.getApiKey(targetConnId)) || '';
        }

        if (includeActiveFile) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                let docText = editor.document.getText();
                const fileName = editor.document.fileName;
                const relPath = vscode.workspace.asRelativePath(editor.document.uri);

                const maxFileChars = Math.max(4000, (maxContext - 3000) * 3.5);
                if (docText.length > maxFileChars) {
                    docText = docText.substring(0, maxFileChars) + `\n\n... [Contenido truncado para no exceder la ventana de contexto de ${maxContext.toLocaleString()} tokens del modelo ${targetModel}]`;
                }

                fullPrompt = `[Archivo Activo: ${fileName}]\n\`\`\`\n${docText}\n\`\`\`\n\n${fullPrompt}`;
                fullPrompt += `\n\n[INSTRUCCION PARA LA IA]: Cuando propongas cambios de codigo, incluye SIEMPRE en la primera linea del bloque de codigo un comentario con la ruta relativa del archivo, por ejemplo: // ${relPath}`;
            }
        }

        // ── Local Model Concurrency Lock ──────────────────────────────────────
        if (!isRemoteConnection) {
            if (this._localModelStreaming) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `⚠️ Modelo local ocupado.\n\nYa hay un modelo local en ejecución en otro sub-chat. Los modelos locales requieren recursos exclusivos de cómputo.\n\n💡 Espera a que el chat anterior termine antes de iniciar otro modelo local.`
                });
                return;
            }
            this._localModelStreaming = true;
        }

        // ── Resolve Provider Display Name ─────────────────────────────────────
        let _providerDisplay: string;
        if (isRemoteConnection) {
            const _tagUp = (targetTag || 'remote').toUpperCase();
            const _knownNames: Record<string, string> = {
                'NVIDIA': 'NVIDIA NIM API', 'OPENAI': 'OpenAI API',
                'DEEPSEEK': 'DeepSeek API', 'KIMI': 'Kimi API',
                'ANTHROPIC': 'Anthropic API', 'GROQ': 'Groq API',
                'MISTRAL': 'Mistral API', 'COHERE': 'Cohere API',
                'HF': 'Hugging Face API'
            };
            _providerDisplay = _knownNames[_tagUp] || `${_tagUp} API`;
        } else {
            _providerDisplay = targetTag === 'ollama' ? 'Ollama (local)' : 'Giskard-Sys Backend (local)';
        }

        this._view.webview.postMessage({
            type: 'streamStatus',
            phase: 'connecting',
            provider: _providerDisplay,
            isLocal: !isRemoteConnection,
            model: targetModel,
            tabId
        });

        try { // ── Outer try for local model lock cleanup ────────────────────────

        // 1. Explicit Local Ollama Model (starts with "local:")
        if (targetModel.startsWith('local:')) {
            const localModelName = targetModel.replace(/^local:/, '');
            const ollamaUrl = (targetTag === 'ollama' && resolvedRemoteUrl) ? resolvedRemoteUrl : 'http://127.0.0.1:11434';
            // Fase 2: host-side agent loop with real message history
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(this._agentCtx(), systemMsg, userMsg, localModelName, ollamaUrl, prompt, targetPathMatch, includeActiveFile, tabId);
            return;
        }

        // 2. REMOTE AI MODELS (Direct communication with remote AI provider endpoints)
        if (isRemoteConnection) {
            if (!apiKey || !apiKey.trim()) {
                const vendorTag = targetTag || (targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote');
                // Try to find if the connection exists but just has no key stored
                const existingConn = this._store.getConnectionByTag(vendorTag);
                const hasConn = !!existingConn;
                const connName = existingConn?.name || vendorTag.toUpperCase();
                const errDetail = hasConn
                    ? `La conexión **${connName}** existe pero su API Key no está guardada (o se perdió al reinstalar).\n\n💡 Ve a Settings ⚙️ → Saved AI Connections → encuentra **${connName}** → pega tu API Key y haz clic en **Guardar** o **Activate**.`
                    : `No existe ninguna conexión con Tag '${vendorTag}'.\n\n💡 Ve a Settings ⚙️ → Saved AI Connections → crea una nueva conexión con Tag '${vendorTag}' y pega tu API Key.`;
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `⚠️ API Key no encontrada para **${_providerDisplay}** (${targetModel}).\n\n${errDetail}`
                });
                return;
            }
            const remoteUrl = resolvedRemoteUrl || activeConn?.url;
            if (!remoteUrl) {
                const vendorTag = targetTag || (targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote');
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `⚠️ No Base URL configured for remote connection tag '${vendorTag}'. Please check Settings ⚙️.`
                });
                return;
            }
            await this._streamFromRemoteApi(remoteUrl, apiKey, targetModel, fullPrompt, prompt, targetPathMatch, includeActiveFile, tabId);
            return;
        }

        // 3. Active Connection is OLLAMA DIRECT
        if (targetTag === 'ollama') {
            const ollamaUrl = resolvedRemoteUrl || activeConn?.url || 'http://127.0.0.1:11434';
            // Fase 2: host-side agent loop with real message history
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(this._agentCtx(), systemMsg, userMsg, targetModel, ollamaUrl, prompt, targetPathMatch, includeActiveFile, tabId);
            return;
        }

        // 4. DEFAULT: Route through Giskard-Sys Backend Giskard-Sys
        const connectorUrl = resolvedRemoteUrl || activeConn?.url || getConnectorUrl();

        // 4.1 MEJORA: si el backend giskard-sys sirve modelos locales de Ollama
        // (active_provider == "ollama"), usar el bucle agente host-side con
        // lectura real de archivos y multi-paso, en vez del streaming ciego de
        // un solo paso. Las herramientas de escritura y /exec siguen pasando
        // por giskard-sys (sandbox + auditoría), por lo que la seguridad se mantiene.
        const giskardSysOllama = await this._resolveGiskardSysOllama(connectorUrl);
        if (giskardSysOllama) {
            const systemMsg = systemHeader.trim();
            const userMsg = fullPrompt.replace(systemHeader, '').trim();
            await agentLoopOllama(this._agentCtx(), 
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

        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

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
                    'Accept': 'text/event-stream',
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

            this._view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });
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
                            let contentToken = '';
                            const choice = json.choices && json.choices[0];
                            const delta = choice?.delta;
                            const msg = choice?.message;

                            if (delta?.content) {
                                contentToken = delta.content;
                            } else if (delta?.reasoning_content) {
                                contentToken = delta.reasoning_content;
                            } else if (delta?.thinking) {
                                contentToken = delta.thinking;
                            } else if (msg?.content) {
                                contentToken = msg.content;
                            } else if (msg?.reasoning_content) {
                                contentToken = msg.reasoning_content;
                            } else if (json.content) {
                                contentToken = json.content;
                            } else if (json.response) {
                                contentToken = json.response;
                            } else if (json.thinking) {
                                contentToken = json.thinking;
                            } else if (typeof json === 'string') {
                                contentToken = json;
                            }

                            if (contentToken) {
                                accumulated += contentToken;
                                this._view.webview.postMessage({ type: 'streamToken', token: contentToken, model: targetModel, tabId });
                            } else if (tokenStr) {
                                // Token JSON válido sin forma conocida (p. ej. un
                                // tool-call inline `{"tool": ...}`): NO descartarlo.
                                accumulated += tokenStr;
                                this._view.webview.postMessage({ type: 'streamToken', token: tokenStr, model: targetModel, tabId });
                            }
                        } catch {
                            if (tokenStr) {
                                accumulated += tokenStr;
                                this._view.webview.postMessage({ type: 'streamToken', token: tokenStr, model: targetModel, tabId });
                            }
                        }
                    }
                }
            }

            this._agentState.lastBotResponse = accumulated;
            clearAgentActivity();
            if (!accumulated.trim()) {
                // Red de seguridad: stream vacío sin error HTTP → dar un mensaje
                // útil en vez de dejar la pantalla en blanco.
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: '⚠️ El backend no devolvió ninguna respuesta. Verifica que el modelo exista en Ollama y que el motor esté corriendo (http://localhost:11434).'
                });
                return;
            }
            this._view.webview.postMessage({ type: 'streamComplete', model: targetModel, tabId });
            await maybeAutoTriggerDiff(this._diffCtx(), prompt, accumulated, targetPathMatch, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') return;

            try {
                this._view.webview.postMessage({ type: 'offlineMode', active: true });
                this._view.webview.postMessage({ type: 'streamStatus', phase: 'connecting', provider: 'Ollama (local · fallback)', isLocal: true, model: targetModel, tabId });
                await this._streamFromOllamaFallback(fullPrompt, targetModel, prompt, targetPathMatch, includeActiveFile, undefined, tabId);
            } catch (fallbackErr: any) {
                if (fallbackErr.name !== 'AbortError') {
                    this._view.webview.postMessage({
                        type: 'streamError',
                        model: targetModel,
                        tabId,
                        error: `Conexión fallida y Ollama offline: ${err.message}`
                    });
                }
            }
        } finally {
            this._activeAbortController = null;
        }

        } finally { // ── Outer finally: clear local model lock ─────────────────────
            if (!isRemoteConnection) {
                this._localModelStreaming = false;
            }
        }
    }

    /** Streams directly from Remote OpenAI-compatible APIs (NVIDIA NIM, DeepSeek, Kimi, Qwen, etc) */
    private async _streamFromRemoteApi(
        baseUrl: string,
        apiKey: string,
        model: string,
        fullPrompt: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        tabId?: string
    ) {
        if (!this._view) return;
        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

        let cleanUrl = baseUrl.trim().replace(/\/$/, '');
        if (!cleanUrl.endsWith('/chat/completions')) {
            if (cleanUrl.endsWith('/v1')) cleanUrl = `${cleanUrl}/chat/completions`;
            else cleanUrl = `${cleanUrl}/v1/chat/completions`;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }
        let safePrompt = fullPrompt;
        if (safePrompt.length > 100000) {
            safePrompt = safePrompt.substring(0, 100000) + '\n\n... [Prompt contextual truncado para no exceder los límites del servidor remoto]';
        }
        const maxResponseTokens = 4096;

        // Larger models (550B+) need more time to queue and start streaming on free tier
        const modelLower = model.toLowerCase();
        const isLargeModel = modelLower.includes('550b') || modelLower.includes('405b') ||
                             modelLower.includes('671b') || modelLower.includes('ultra') ||
                             modelLower.includes('235b') || modelLower.includes('200b');
        const timeoutMs = isLargeModel ? 180000 : 90000;

        const timeoutId = setTimeout(() => {
            if (this._activeAbortController) {
                this._activeAbortController.abort();
            }
        }, timeoutMs);


        try {
            const response = await fetch(cleanUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: safePrompt }],
                    stream: true,
                    temperature: 0.7,
                    max_tokens: maxResponseTokens
                }),
                signal
            });

            clearTimeout(timeoutId);

            if (!response.ok || !response.body) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`API Remota (${cleanUrl}) respondió HTTP ${response.status}: ${errText}`);
            }

            this._view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: false, tabId });
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let accumulated = '';
            let buffer = '';
            let cachedExtractor: ((j: any) => string) | null = null;

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
                            let contentToken = '';

                            if (cachedExtractor) {
                                contentToken = cachedExtractor(json);
                            }

                            if (!contentToken) {
                                const choice = json.choices && json.choices[0];
                                const delta = choice?.delta;
                                const msg = choice?.message;

                                if (delta?.content) {
                                    cachedExtractor = (j) => j.choices?.[0]?.delta?.content || '';
                                    contentToken = delta.content;
                                } else if (delta?.text) {
                                    cachedExtractor = (j) => j.choices?.[0]?.delta?.text || '';
                                    contentToken = delta.text;
                                } else if (delta?.reasoning_content) {
                                    cachedExtractor = (j) => j.choices?.[0]?.delta?.reasoning_content || '';
                                    contentToken = delta.reasoning_content;
                                } else if (delta?.reasoning) {
                                    cachedExtractor = (j) => j.choices?.[0]?.delta?.reasoning || '';
                                    contentToken = delta.reasoning;
                                } else if (choice?.text) {
                                    cachedExtractor = (j) => j.choices?.[0]?.text || '';
                                    contentToken = choice.text;
                                } else if (msg?.content) {
                                    cachedExtractor = (j) => j.choices?.[0]?.message?.content || '';
                                    contentToken = msg.content;
                                } else if (msg?.reasoning_content) {
                                    cachedExtractor = (j) => j.choices?.[0]?.message?.reasoning_content || '';
                                    contentToken = msg.reasoning_content;
                                } else if (json.content) {
                                    cachedExtractor = (j) => j.content || '';
                                    contentToken = json.content;
                                } else if (json.text) {
                                    cachedExtractor = (j) => j.text || '';
                                    contentToken = json.text;
                                }
                            }

                            if (contentToken) {
                                accumulated += contentToken;
                                this._view.webview.postMessage({ type: 'streamToken', token: contentToken, model, tabId });
                            }
                        } catch { }
                    }
                }
            }

            this._agentState.lastBotResponse = accumulated;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model, tabId });
            await maybeAutoTriggerDiff(this._diffCtx(), userPrompt || fullPrompt, accumulated, extractedPath, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') {
                this._view.webview.postMessage({
                    type: 'streamError',
                    model,
                    tabId,
                    error: `⚠️ Timeout de conexión (60s) para '${model}'.\n\n💡 Verifica tu conexión de red o tu API Key en Settings ⚙️.`
                });
                return;
            }
            this._view.webview.postMessage({
                type: 'streamError',
                model,
                tabId,
                error: `Error de API Remota (${model}): ${err.message}`
            });
        } finally {
            this._activeAbortController = null;
        }
    }

    private async _streamFromOllamaFallback(
        fullPrompt: string,
        model: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        customOllamaUrl?: string,
        tabId?: string
    ) {
        if (!this._view) return;

        this._activeAbortController = new AbortController();

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const defaultModel = config.get<string>('defaultModel') || 'qwen3-coder:30b';
        const ollamaBaseUrl = customOllamaUrl || config.get<string>('ollamaBaseUrl') || 'http://127.0.0.1:11434';
        const targetModel = (model && !model.startsWith('cli:')) ? model : defaultModel;

        const ctx: StreamContext = {
            view: this._view,
            abortController: this._activeAbortController,
            lastBotResponse: { text: '' }
        };

        try {
            await streamFromOllamaLegacy(ctx, ollamaBaseUrl, fullPrompt, targetModel, tabId);
            this._agentState.lastBotResponse = ctx.lastBotResponse.text;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model: targetModel, tabId });
            await maybeAutoTriggerDiff(this._diffCtx(), userPrompt || fullPrompt, this._agentState.lastBotResponse, extractedPath, includeActiveFile);
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `❌ Error con el modelo local ${targetModel}: ${err?.message || err}`
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    /** Fase 2: stream a chat completion from Ollama's /api/chat with a structured message history */
    private async _streamOllamaChat(
        messages: ChatMessage[],
        model: string,
        ollamaUrl: string,
        tabId?: string
    ): Promise<string> {
        if (!this._view) return '';
        this._activeAbortController = new AbortController();

        const ctx: StreamContext = {
            view: this._view,
            abortController: this._activeAbortController,
            lastBotResponse: { text: '' }
        };
        return await streamOllamaChat(ctx, messages, model, ollamaUrl, tabId);
    }

    /** Fase 2: host-side agent loop for local Ollama models — model → read-only tools → model, with history + budget */
    /**
     * Resuelve la URL de Ollama que sirve el backend giskard-sys consultando
     * GET /policy. Solo devuelve valor cuando el proveedor activo es "ollama".
     * Cacheada 60s para no golpear el conector en cada mensaje.
     * Delegada a streamManager.ts.
     */
    private async _resolveGiskardSysOllama(connectorUrl: string): Promise<string | null> {
        return await resolveGiskardSysOllama(connectorUrl);
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        setWebviewMessageListener(webview, this._routerDeps());
    }

}

let _chatTabCounter = 1;

export function createNewChatPanelTab(context: vscode.ExtensionContext, store: ConnectionStore, title?: string) {
    _chatTabCounter++;
    const panelTitle = title || `GISKARD #${_chatTabCounter}`;
    const panel = vscode.window.createWebviewPanel(
        'giskard-chat-tab',
        panelTitle,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        }
    );

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'giskard.svg');

    const provider = new GiskardChatWebviewProvider(context.extensionUri, store);
    provider.attachPanel(panel);
}
