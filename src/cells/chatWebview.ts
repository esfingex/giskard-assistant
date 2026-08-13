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
    execCliCommand,
    fetchLlmModels,
    fetchLlmModelsGrouped,
    ConnectionModelsGroup,
    fetchWithTimeout,
    checkHealth,
    resetSession
} from '../core/api';
import { fetchOllamaModels } from '../core/providers';
import { ConnectionStore } from '../core/connectionStore';
import { EventBus, EventPayload } from '../core/eventBus';
import { getHtmlForWebview } from './htmlShell';
import {
    sendMcpServersList,
    handleAddMcpServer,
    handleRemoveMcpServer,
    handleToggleMcpServer,
    handleToggleMcpTool,
    handleDiscoverMcpTools,
    handleTestMcpServer,
    handleSearchSmitheryRegistry,
    getActiveMcpPromptContext
} from './mcpHandlers';
import {
    handleOpenFile,
    handleToolReadFile,
    handleToolWriteFile,
    handleToolExec,
    handleToolListDir,
    handleToolSearch,
    handleToolGlob,
    resolveWorkspaceFile,
    extractCodeBlocks,
    applyCodeToDocument,
    extractToolCalls,
    executeReadOnlyTool
} from './toolHandlers';
import { setAgentActivity, clearAgentActivity } from './statusBar';
import { buildChatMessages, trimHistory, estimateTokens, ChatMessage } from '../core/contextWindow';

const _modelContextRegistry: Map<string, number> = new Map();

export function setModelContextWindow(modelName: string, maxTokens: number) {
    if (modelName && maxTokens > 0) {
        _modelContextRegistry.set(modelName.toLowerCase().trim(), maxTokens);
    }
}

export function getModelMaxContextWindow(modelName: string): number {
    const cleanName = (modelName || '').toLowerCase().trim();
    if (_modelContextRegistry.has(cleanName)) {
        return _modelContextRegistry.get(cleanName)!;
    }
    // Remote models default to unrestrictive modern baseline (128,000 tokens), local models default to 32,768 tokens
    return cleanName.startsWith('local:') ? 32768 : 128000;
}

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'giskard-assistant.chatView';

    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;
    private _lastBotResponse: string = '';
    private _localModelStreaming: boolean = false;
    private _modelConnectionMap: Map<string, ConnectionModelsGroup> = new Map();

    /** Caché de la URL de Ollama que sirve el backend giskard-sys (GET /policy) */
    private _giskardSysOllamaCache: { url: string; value: string | null; at: number } | null = null;

    /** Últimos modelo/URL/tab usados — para el bucle auto-corrector con tests */
    private _lastModel: string = '';
    private _lastOllamaUrl: string = '';
    private _lastTabId: string | undefined = undefined;

    /** Fase 2: per-tab chat history (messages[]) for the host-side agent loop */
    private _tabHistory: Map<string, ChatMessage[]> = new Map();
    private readonly _agentLoopBudget = 28000; // safe margin under the 32K local window

    /** Snapshots of AI edits (original content) for one-click revert */
    private static _editSnapshots: { uri: string; original: string; timestamp: number }[] = [];

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
    public static revertLastAiEdit(): boolean {
        const snap = GiskardChatWebviewProvider._editSnapshots.pop();
        if (!snap) return false;
        const uri = vscode.Uri.parse(snap.uri);
        vscode.workspace.openTextDocument(uri).then(async (doc) => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), snap.original);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`↩️ Cambio de IA revertido en ${vscode.workspace.asRelativePath(uri)}`);
        });
        return true;
    }

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

        await this._sendConnectionsList();
        await this._sendModelsList();
        if (this._view) await sendMcpServersList(this._view, this._store);
    }

    public postMessage(message: any) {
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

    private async _sendConnectionsList() {
        if (!this._view && !this._panel) return;
        const connections = this._store.getAll();
        this.postMessage({ type: 'connectionsLoaded', connections });
    }

    private async _handleAddConnection(data: any) {
        if (!this._view && !this._panel) return;
        try {
            const id = await this._store.addConnection(
                data.name,
                data.connType,
                data.url,
                data.tag,
                data.apiKey
            );
            vscode.window.showInformationMessage(`✓ Conexión "${data.name}" guardada.`);
            await this._store.setActive(id);
            await this.refreshState();
        } catch (err: any) {
            this.postMessage({ type: 'connectionError', error: err.message });
            vscode.window.showErrorMessage(`Error guardando conexión: ${err.message}`);
        }
    }

    private async _handleRemoveConnection(id: number) {
        if (!this._view && !this._panel) return;
        try {
            await this._store.removeConnection(id);
            vscode.window.showInformationMessage(`✓ Connection deleted.`);
            await this.refreshState();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error deleting connection: ${err.message}`);
        }
    }

    private async _handleResetConnections() {
        if (!this._view && !this._panel) return;
        try {
            const list = this._store.getAll();
            for (const c of list) {
                await this._store.removeConnection(c.id);
            }
            await this._store.init();
            vscode.window.showInformationMessage(`✓ All connection profiles reset.`);
            await this.refreshState();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error resetting connections: ${err.message}`);
        }
    }

    private async _handleActivateConnection(id: number) {
        if (!this._view && !this._panel) return;
        try {
            await this._store.setActive(id);
            const active = this._store.getActive();
            const url = active?.url || 'desconocida';
            vscode.window.showInformationMessage(`✓ Conexión activa: ${active?.name || url}`);
            await this.refreshState();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error activando conexión: ${err.message}`);
        }
    }

    private async _handleTestConnectionUrl(url: string) {
        if (!this._view && !this._panel) return;
        const start = Date.now();
        try {
            const cleanUrl = url.trim().replace(/\/$/, '');
            let res = await fetchWithTimeout(`${cleanUrl}/health`, {
                headers: { 'X-Client-Id': getClientId() }
            }, 5000).catch(() => null);

            if (!res || !res.ok) {
                res = await fetchWithTimeout(cleanUrl, {}, 5000).catch(() => null);
            }

            const ms = Date.now() - start;
            const ok = Boolean(res && (res.ok || res.status === 200 || res.status === 401 || res.status === 404 || res.status === 405));
            let statusText = `HTTP ${res?.status}`;
            if (res?.status === 401) statusText += ' (Requiere API Key)';
            this.postMessage({
                type: 'connectionTested',
                ok,
                status: res?.status,
                ms,
                error: ok ? undefined : (res ? statusText : 'Servidor no responde en esa URL')
            });
        } catch (err: any) {
            const ms = Date.now() - start;
            let reason = err.message;
            if (err.name === 'AbortError') reason = 'Timeout — sin respuesta en 5 segundos';
            else if (err.message.includes('ECONNREFUSED')) reason = 'Conexión rechazada — verifica que el servidor esté activo';
            else if (err.message.includes('ENOTFOUND')) reason = 'Host no encontrado — verifica la URL';

            this.postMessage({
                type: 'connectionTested',
                ok: false,
                error: reason,
                ms
            });
        }
    }

    private async _sendModelsList() {
        if (!this._view && !this._panel) return;

        let enabledModels = this._store.getEnabledModels();

        const activeConn = this._store.getActive();
        const activeTag = activeConn?.tag || 'giskard-sys';
        const activeName = activeConn?.name || (activeConn?.type === 'remote' ? 'Remote API' : 'Giskard-Sys');

        const groups = await fetchLlmModelsGrouped().catch(() => []);
        const remoteModels = await fetchLlmModels().catch(() => []);

        const ollamaConn = this._store.getAll().find(c => c.tag === 'ollama' || c.url.includes(':11434'));
        const ollamaUrl = ollamaConn?.url || 'http://127.0.0.1:11434';
        const localModels = await fetchOllamaModels(ollamaUrl).catch(() => []);

        const flatGroupModels: string[] = [];
        this._modelConnectionMap.clear();
        groups.forEach(g => {
            if (g && Array.isArray(g.models)) {
                flatGroupModels.push(...g.models);
                g.models.forEach(m => {
                    if (m) this._modelConnectionMap.set(m, g);
                });
            }
        });

        const allFlatModels = Array.from(new Set([...enabledModels, ...flatGroupModels, ...remoteModels, ...localModels])).filter(m => Boolean(m));

        // Auto-enable if empty
        if (enabledModels.length === 0 && allFlatModels.length > 0) {
            enabledModels = allFlatModels;
            this._store.setEnabledModels(enabledModels);
        }

        this.postMessage({ type: 'setEnabledModels', enabledModels });

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const isGiskardSysEnabled = config.get<boolean>('giskardSys.enabled', false);
        const connectionMode = isGiskardSysEnabled ? 'giskardSysActive' : 'ollamaDirect';

        this.postMessage({
            type: 'modelsList',
            models: allFlatModels,
            enabledModels,
            groups,
            localModels,
            activeTag,
            activeName,
            currentUrl: getConnectorUrl(),
            connectionMode
        });
    }

    private async _handleSaveSettings(provider: string, baseUrl?: string, apiKey?: string) {
        try {
            const res = await execCliCommand('config', 'update', provider);
            if (res.success) {
                vscode.window.showInformationMessage(`✓ Proveedor IA actualizado a: ${provider}`);
            } else {
                this._view?.webview.postMessage({ type: 'settingsError', error: res.error });
            }
        } catch (err: any) {
            this._view?.webview.postMessage({ type: 'settingsError', error: err.message });
        }
    }

    private async _handleAction(action: string) {
        if (!this._view) return;
        try {
            const resData: any = await execCliCommand('rtk', action);
            const text = resData.success ? resData.data : `Error Ejecución: ${resData.error}`;
            this._view.webview.postMessage({ type: 'actionResult', text });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: err.message });
        }
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
        if (APPLY_LAST_REGEX.test(prompt.trim()) && this._lastBotResponse.trim()) {
            const blocks = extractCodeBlocks(this._lastBotResponse);
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
                await this._handleOpenDiff(best.code, best.filePath || targetPathMatch);
                return;
            }
        }

        let fullPrompt = prompt;

        this._lastTabId = tabId;

        // Reglas de proyecto automáticas: AGENTS.md / CLAUDE.md / .cursorrules / README.md
        const projectRules = await this._loadProjectRules();

        // 1. Check if Giskard-Sys active connection is present
        const giskardConn = this._store.getActiveLocal();
        const isGiskardActive = giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500'));

        // 2. Check active MCP context
        const mcpContext = getActiveMcpPromptContext(this._store);

        // Build System Capability Context Header
        let systemHeader = `${projectRules ? `[PROJECT RULES — sigue estas reglas del proyecto]
${projectRules}

` : ''}[VS CODE AGENT CAPABILITIES]: You are an integrated coding agent in VS Code.
• TO READ A FILE: Emit [TOOL_CALL] {"action": "read_file", "path": "src/extension.ts"} [/END_TOOL] or {"tool": "read_file", "args": {"path": "src/extension.ts"}}. Always use actual relative workspace file paths.
• TO WRITE OR EDIT A FILE: Place a comment with the relative file path on line 1 of your code block (e.g. // src/extension.ts).
• TO LIST A DIRECTORY: Emit [TOOL_CALL] {"tool": "list_dir", "args": {"path": "src"}} [/END_TOOL].
• TO SEARCH FILE CONTENTS: Emit [TOOL_CALL] {"tool": "search", "args": {"query": "functionName"}} [/END_TOOL].
• TO GLOB FILES: Emit [TOOL_CALL] {"tool": "glob", "args": {"pattern": "src/**/*.ts"}} [/END_TOOL].
• TO PROPOSE A PLAN BEFORE EDITING: Wrap your plan in [PLAN] ... [/END_PLAN] and WAIT for the user to approve it before emitting tool calls or code blocks.
• IGNORED DIRECTORIES: Do NOT attempt to read non-source files or build output directories like node_modules, out/, dist/, target/, build/, or .git/. Focus exclusively on source code files (src/, package.json, README.md, etc.).\n\n`;
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
            await this._agentLoopOllama(systemMsg, userMsg, localModelName, ollamaUrl, prompt, targetPathMatch, includeActiveFile, tabId);
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
            await this._agentLoopOllama(systemMsg, userMsg, targetModel, ollamaUrl, prompt, targetPathMatch, includeActiveFile, tabId);
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
            await this._agentLoopOllama(
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
                session_id: sessionName
            };
            const response = await fetch(streamUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-Client-Id': getClientId()
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

            this._lastBotResponse = accumulated;
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
            await this._maybeAutoTriggerDiff(prompt, accumulated, targetPathMatch, includeActiveFile);

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

            this._lastBotResponse = accumulated;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model, tabId });
            await this._maybeAutoTriggerDiff(userPrompt || fullPrompt, accumulated, extractedPath, includeActiveFile);

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
        const signal = this._activeAbortController.signal;

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const defaultModel = config.get<string>('defaultModel') || 'qwen3-coder:30b';
        const ollamaBaseUrl = customOllamaUrl || config.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';

        let targetModel = (model && !model.startsWith('cli:')) ? model : defaultModel;
        const url = `${ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;

        // Explicit context window: without num_ctx, Ollama uses the model's tiny default
        // (often 2048-8192), which overflows as soon as we inject project file contents
        // and kills the generation mid-stream. qwen-agentworld 35B supports 32K.
        const modelCtx = getModelMaxContextWindow(targetModel);
        const numCtx = Math.min(modelCtx, 32768);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetModel,
                    prompt: fullPrompt,
                    stream: true,
                    keep_alive: '10m',
                    options: {
                        num_ctx: numCtx,
                        num_predict: 8192,
                        temperature: 0.7
                    }
                }),
                signal
            });

            if (!response.ok || !response.body) {
                throw new Error(`Ollama local respondió HTTP ${response.status}`);
            }

            this._view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let ollamaAccumulated = '';
            let ollamaBuffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                ollamaBuffer += decoder.decode(value, { stream: true });
                const lines = ollamaBuffer.split('\n');
                ollamaBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const json = JSON.parse(trimmed);
                        let token = '';
                        if (json.response !== undefined) {
                            token = json.response;
                        } else if (json.message?.content) {
                            token = json.message.content;
                        } else if (json.thinking) {
                            token = json.thinking;
                        } else if (json.message?.reasoning_content) {
                            token = json.message.reasoning_content;
                        }

                        if (token) {
                            ollamaAccumulated += token;
                            this._view.webview.postMessage({ type: 'streamToken', token, model: targetModel, tabId });
                        }
                    } catch { }
                }
            }

            this._lastBotResponse = ollamaAccumulated;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model: targetModel, tabId });
            await this._maybeAutoTriggerDiff(userPrompt || fullPrompt, ollamaAccumulated, extractedPath, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') return;
            // Never let an Ollama error kill the conversation: surface it in the chat instead
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
        const signal = this._activeAbortController.signal;
        const url = `${ollamaUrl.replace(/\/$/, '')}/api/chat`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                keep_alive: '10m',
                options: {
                    num_ctx: Math.min(getModelMaxContextWindow(model), 32768),
                    num_predict: 8192,
                    temperature: 0.7
                }
            }),
            signal
        });

        if (!response.ok || !response.body) {
            throw new Error(`Ollama /api/chat respondió HTTP ${response.status}`);
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
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const json = JSON.parse(trimmed);
                    let token = '';
                    if (json.message && json.message.content) token = json.message.content;
                    else if (json.message && json.message.reasoning_content) token = json.message.reasoning_content;
                    else if (json.thinking) token = json.thinking;
                    if (token) {
                        accumulated += token;
                        this._view.webview.postMessage({ type: 'streamToken', token, model, tabId });
                    }
                } catch { }
            }
        }
        return accumulated;
    }

    /** Fase 2: host-side agent loop for local Ollama models — model → read-only tools → model, with history + budget */
    /**
     * Resuelve la URL de Ollama que sirve el backend giskard-sys consultando
     * GET /policy. Solo devuelve valor cuando el proveedor activo es "ollama".
     * Cacheada 60s para no golpear el conector en cada mensaje.
     */
    private async _resolveGiskardSysOllama(connectorUrl: string): Promise<string | null> {
        const now = Date.now();
        const cache = this._giskardSysOllamaCache;
        if (cache && cache.url === connectorUrl && now - cache.at < 60_000) {
            return cache.value;
        }
        let result: string | null = null;
        try {
            const res = await fetchWithTimeout(`${connectorUrl}/policy`, {}, 5000);
            if (res && res.ok) {
                const data: any = await res.json().catch(() => null);
                if (data && data.success && data.data) {
                    const provider = String(data.data.active_provider || '').toLowerCase();
                    const url = String(data.data.ollama_url || '').trim();
                    if (provider === 'ollama' && url) {
                        result = url;
                    }
                }
            }
        } catch {
            // Sin conectividad con giskard-sys → caer al streaming clásico.
        }
        this._giskardSysOllamaCache = { url: connectorUrl, value: result, at: now };
        return result;
    }

    /**
     * Lee las reglas del proyecto abierto (AGENTS.md, CLAUDE.md, .cursorrules,
     * README.md) y las devuelve como bloque de texto acotado para inyectar
     * en el system header. Sin archivos de reglas devuelve ''. 
     */
    private async _loadProjectRules(): Promise<string> {
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
            } catch { /* el archivo no existe */ }
        }
        return parts.join('\n\n');
    }

    private async _agentLoopOllama(
        system: string,
        userContent: string,
        model: string,
        ollamaUrl: string,
        userPrompt: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        tabId?: string
    ) {
        if (!this._view) return;
        this._lastModel = model;
        this._lastOllamaUrl = ollamaUrl;
        const key = tabId || '_main';
        let history = this._tabHistory.get(key) || [];
        // Presupuesto dinámico: prompt debe caber en num_ctx - num_predict - margen
        const numCtx = Math.min(getModelMaxContextWindow(model), 32768);
        const predictBudget = 8192;
        const margin = 2000;
        const loopBudget = Math.max(4000, numCtx - predictBudget - margin);
        let messages = buildChatMessages(history, system, userContent, loopBudget);
        let finalReply = '';
        const maxSteps = 6;

        try {
            for (let step = 0; step < maxSteps; step++) {
                if (step > 0) {
                    this._view.webview.postMessage({ type: 'streamToken', token: `\n\n--- 🔧 Paso ${step + 1} del agente ---\n`, model, tabId });
                }
                const reply = await this._streamOllamaChat(messages, model, ollamaUrl, tabId);
                messages = trimHistory([...messages, { role: 'assistant', content: reply }], loopBudget);

                const calls = extractToolCalls(reply);
                if (calls.length === 0) {
                    finalReply = reply;
                    break;
                }

                const readOnly = calls.filter(c => ['read_file', 'list_dir', 'search', 'glob'].includes((c.action || '').toLowerCase()));
                const blocking = calls.filter(c => !['read_file', 'list_dir', 'search', 'glob'].includes((c.action || '').toLowerCase()));

                // Blocking tools (write/exec) end the loop: the user applies via the existing UI
                if (blocking.length > 0) {
                    finalReply = reply;
                    this._view.webview.postMessage({
                        type: 'streamToken',
                        token: `\n\n[ℹ️] El modelo pidió ${blocking.map(b => b.action).join(', ')} — aplícalo con el botón 📝 Apply Change.\n`,
                        model, tabId
                    });
                    break;
                }

                for (const call of readOnly) {
                    setAgentActivity(`${call.action} ${call.path || call.query || call.pattern || ''}…`);
                    const res = await executeReadOnlyTool(call);
                    messages = trimHistory([...messages, { role: 'tool', content: res.output }], loopBudget);
                    this._view.webview.postMessage({
                        type: 'streamToken',
                        token: `\n\n[🔧 ${res.ok ? 'OK' : 'ERROR'} ${call.action} ${call.path || call.query || call.pattern || ''}]\n`,
                        model, tabId
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
            this._tabHistory.set(key, history);

            this._lastBotResponse = finalReply;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model, tabId });
            await this._maybeAutoTriggerDiff(userPrompt, finalReply, extractedPath, includeActiveFile);
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            clearAgentActivity();
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    model,
                    tabId,
                    error: `❌ Error en el bucle agente (${model}): ${err?.message || err}`
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    private async _maybeAutoTriggerDiff(
        userPrompt: string,
        botResponse: string,
        extractedPath?: string,
        includeActiveFile?: boolean
    ) {
        const blocks = extractCodeBlocks(botResponse);
        if (blocks.length === 0) return;

        // Only consider auto-apply when the user explicitly asked to edit a file
        // (the prompt mentions an edit verb AND we know a target file).
        const editIntent = /(?:aplica|aplicar|modifica|edita|reescribe|cambia|hazla|hazlo|implementa|actualiza|crea|agrega|añade|corrige|corregir|fix|write|edit|update|apply|implement|create)\b/i.test(userPrompt);
        const hasTarget = Boolean(extractedPath || includeActiveFile);
        if (!editIntent || !hasTarget) return;

        let best = blocks[0];
        for (const b of blocks) {
            if (b.filePath) { best = b; break; }
            if (b.code.length > best.code.length) best = b;
        }

        let targetPath = best.filePath || extractedPath;
        if (!targetPath) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document && editor.document.uri.scheme === 'file') {
                targetPath = vscode.workspace.asRelativePath(editor.document.uri);
            }
        }
        if (!targetPath || !best || !best.code || best.code.trim().length <= 10) return;

        // Never apply silently: ask the user first
        const choice = await vscode.window.showInformationMessage(
            `Giskard: el modelo propuso cambios para «${targetPath}». ¿Los aplico?`,
            { modal: false },
            '✅ Aplicar',
            '❌ Descartar'
        );
        if (choice === '✅ Aplicar') {
            await this._handleOpenDiff(best.code, targetPath);
        }
    }

    private async _handleOpenDiff(code: string, filePath?: string) {
        let doc: vscode.TextDocument | null = null;
        if (filePath) doc = await resolveWorkspaceFile(filePath);
        if (!doc) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') doc = editor.document;
        }

        if (!doc && filePath) {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
                const cleanRel = filePath.replace(/^\.\//, '').replace(/^\//, '');
                const newUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
                try {
                    await vscode.workspace.fs.writeFile(newUri, new Uint8Array());
                    doc = await vscode.workspace.openTextDocument(newUri);
                } catch {}
            }
        }

        if (!doc) {
            const newDoc = await vscode.workspace.openTextDocument({ content: code, language: 'typescript' });
            await vscode.window.showTextDocument(newDoc, { preview: false });
            return;
        }

        // Open target file in the editor and apply changes safely (smart-apply, no destructive full-file overwrite)
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        const originalContent = doc.getText();
        const result = await applyCodeToDocument(doc, code);
        const relPath = vscode.workspace.asRelativePath(doc.uri);
        switch (result.mode) {
            case 'noop':
                vscode.window.showInformationMessage(`✓ Los cambios ya estaban aplicados en ${relPath}`);
                break;
            case 'new':
                vscode.window.showInformationMessage(`✓ Archivo creado: ${relPath} — revisa y guarda`);
                break;
            case 'full':
            case 'partial':
                // Fase 3c: snapshot for one-click revert + native diff review
                GiskardChatWebviewProvider._editSnapshots.push({ uri: doc.uri.toString(), original: originalContent, timestamp: Date.now() });
                if (GiskardChatWebviewProvider._editSnapshots.length > 20) GiskardChatWebviewProvider._editSnapshots.shift();
                try {
                    const proposedContent = doc.getText();
                    const stamp = Date.now();
                    const origTmp = vscode.Uri.file(path.join(os.tmpdir(), `giskard-orig-${stamp}.tmp`));
                    const propTmp = vscode.Uri.file(path.join(os.tmpdir(), `giskard-prop-${stamp}.tmp`));
                    await vscode.workspace.fs.writeFile(origTmp, Buffer.from(originalContent, 'utf8'));
                    await vscode.workspace.fs.writeFile(propTmp, Buffer.from(proposedContent, 'utf8'));
                    await vscode.commands.executeCommand('vscode.diff', origTmp, propTmp, `Giskard: ${relPath} — original → propuesto (guarda en el archivo para aceptar)`);
                } catch { /* diff view is best-effort */ }
                vscode.window.showInformationMessage(`✓ Cambios aplicados (${result.mode === 'partial' ? 'edición parcial' : 'archivo completo'}) en ${relPath} — revisa el diff, guarda para aceptar o usa "Revert AI Change" para descartar`);
                break;
            case 'failed':
            default:
                vscode.window.showWarningMessage(`⚠️ ${result.message || `No se pudieron aplicar los cambios en ${relPath}`}`);
                break;
        }

        // Wave A: verificación automática con tests (cargo/npm) tras aplicar cambios
        this._autoVerifyAndFix().catch(() => { /* best-effort */ });
    }

    /**
     * Corre la suite del proyecto (cargo test / npm test) vía giskard-sys /exec
     * después de aplicar cambios. Si falla, pide UNA corrección al modelo local
     * y muestra el diff propuesto (no se aplica automáticamente).
     */
    private async _autoVerifyAndFix() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return;
        const root = folders[0].uri;
        let cmd: string | null = null;
        try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'Cargo.toml')); cmd = 'cargo'; } catch { /* no rust */ }
        if (!cmd) { try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'package.json')); cmd = 'npm'; } catch { /* no node */ } }
        if (!cmd || !this._view) return;

        const model = this._lastModel || '';
        const tabId = this._lastTabId;
        this._view.webview.postMessage({ type: 'streamToken', token: `\n\n🧪 Ejecutando ${cmd} test...\n`, model, tabId });

        try {
            const res = await fetchWithTimeout(`${getConnectorUrl()}/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command: cmd, args: ['test'] })
            }, 180000);
            const data: any = await res.json();
            if (!data || !data.success) {
                this._view.webview.postMessage({ type: 'streamToken', token: `⚠️ No se pudieron correr tests: ${(data && data.error) || 'error'}\n`, model, tabId });
                return;
            }
            const out: string = data.data || '';
            if (out.includes('EXIT CODE: 0')) {
                this._view.webview.postMessage({ type: 'streamToken', token: `✅ Tests pasaron.\n`, model, tabId });
                return;
            }
            const tail = out.split('\n').filter(Boolean).slice(-8).join('\n');
            this._view.webview.postMessage({ type: 'streamToken', token: `❌ Tests fallaron:\n${tail.substring(0, 900)}\n`, model, tabId });

            if (this._lastModel && this._lastOllamaUrl) {
                this._view.webview.postMessage({ type: 'streamToken', token: `\n🔧 Pidiendo una corrección al modelo local...\n`, model, tabId });
                const systemMsg = 'You are an integrated coding agent in VS Code. Fix the failing tests by editing the relevant source file. Output ONLY the corrected code block with the file path as the first comment line.';
                const fixPrompt = `The project tests are failing after the last edit. Test output:\n${tail.substring(0, 1500)}\n\nAnalyze the failure and fix the code.`;
                await this._agentLoopOllama(systemMsg, fixPrompt, this._lastModel, this._lastOllamaUrl, fixPrompt, undefined, false, tabId);
            }
        } catch { /* verificación best-effort */ }
    }

    private async _handleCompressMemory(historyText: string) {
        if (!this._view) return;
        try {
            const wsName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            // Guardar vía giskard-sys /memory/add (proxya a Alicanto con el token local)
            const res = await fetchWithTimeout(`${getConnectorUrl()}/memory/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ project: wsName, category: 'flow', content: historyText, tags: 'compressed,chat' })
            }, 15000);
            const data: any = await res.json().catch(() => null);
            const msg = data && data.success
                ? '✓ Memoria BCF guardada exitosamente en Alicanto.'
                : `Error guardando memoria: ${(data && data.error) || 'error de conexión'}`;
            this._view.webview.postMessage({ type: 'streamToken', token: `\n\n[Sistema]: ${msg}` });
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: err.message });
        }
    }

    /** Fase 3b: user approved a [PLAN] — re-prompt the model to execute it step by step */
    private async _handleApprovePlan(plan: string, model?: string, tabId?: string) {
        if (!plan || !plan.trim()) return;
        const targetModel = model || (this._store.getEnabledModels()[0] || '');
        const executionPrompt = `El usuario ha APROBADO el siguiente plan. Ejecútalo ahora paso a paso: lee los archivos que necesites, haz los cambios propuestos y verifica. NO vuelvas a pedir aprobación.\n\n[PLAN APROBADO]:\n${plan}\n\nEjecuta el plan completo.`;
        await this._handlePrompt(executionPrompt, targetModel, false, 'none', tabId);
    }

    /** Fase 4a: persist chat tabs history in workspaceState */
    private async _saveChatHistory(tabs: any[]) {
        if (!this._context || !Array.isArray(tabs) || tabs.length === 0) return;
        try {
            // Cap payload: keep the most recent 2 tabs if the serialized history is large
            let safeTabs = tabs;
            const serialized = JSON.stringify(tabs);
            if (serialized && serialized.length > 90000) {
                safeTabs = tabs.slice(-2);
            }
            await this._context.workspaceState.update('giskard.chatTabs', safeTabs);
        } catch { /* non-critical: history persistence is best-effort */ }
    }

    /** Fase 4a: restore chat tabs from workspaceState and push to the webview */
    private async _restoreChatHistory() {
        if (!this._context || !this._view) return;
        try {
            const tabs = this._context.workspaceState.get<any[]>('giskard.chatTabs', []);
            if (Array.isArray(tabs) && tabs.length > 0) {
                this._view.webview.postMessage({ type: 'chatHistoryRestored', tabs });
            }
        } catch { /* non-critical */ }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(async (data) => {
            try {
                switch (data.type) {
                case 'sendPrompt':
                    await this._handlePrompt(data.prompt, data.model, data.includeActiveFile, data.contextType, data.tabId);
                    break;
                case 'stopGeneration':
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = null;
                    }
                    break;
                case 'openSettings':
                    await this.refreshState();
                    break;
                case 'loadConnections':
                    await this._sendConnectionsList();
                    break;
                case 'addConnection':
                    await this._handleAddConnection(data);
                    break;
                case 'removeConnection':
                    await this._handleRemoveConnection(data.id);
                    break;
                case 'resetConnections':
                    await this._handleResetConnections();
                    break;
                case 'activateConnection':
                    await this._handleActivateConnection(data.id);
                    break;
                case 'testConnectionUrl':
                    await this._handleTestConnectionUrl(data.url);
                    break;
                case 'webviewReady':
                    await this.refreshState();
                    break;
                case 'createNewChatTab':
                    vscode.commands.executeCommand('giskard-assistant.openChatTab');
                    break;
                case 'fetchModels':
                case 'getModels':
                    await this._sendModelsList();
                    break;
                case 'modelChanged':
                    if (data.model) {
                        await this._store.setActiveChatModel(data.model);
                    }
                    break;
                case 'saveSettings':
                    await this._handleSaveSettings(data.provider, data.baseUrl, data.apiKey);
                    break;
                case 'clearContext':
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = null;
                    }
                    await resetSession();
                    if (this._view) {
                        this._view.webview.postMessage({ type: 'contextCleared' });
                    }
                    break;
                case 'getExclusionPatterns': {
                    const patterns = this._store.getExclusionPatterns();
                    webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
                    break;
                }
                case 'saveExclusionPatterns': {
                    await this._store.saveExclusionPatterns(data.patterns || []);
                    vscode.window.showInformationMessage('✓ Patrones de exclusión de workspace guardados.');
                    const patterns = this._store.getExclusionPatterns();
                    webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
                    break;
                }
                case 'actionBtn':
                    await this._handleAction(data.action);
                    break;
                case 'openFile':
                    // Fix: el webview envía relativePath (chatView.js/chatUtils.js)
                    await handleOpenFile(data.relativePath || data.path);
                    break;
                case 'openDiff':
                    await this._handleOpenDiff(data.code, data.filePath);
                    break;
                case 'loadMcpServers':
                    await sendMcpServersList(this._view, this._store);
                    break;
                case 'addMcpServer':
                    await handleAddMcpServer(this._view, this._store, data.name, data.serverType, data.commandOrUrl);
                    break;
                case 'removeMcpServer':
                    await handleRemoveMcpServer(this._view, this._store, data.id);
                    break;
                case 'toggleMcpServer':
                    await handleToggleMcpServer(this._view, this._store, data.id);
                    break;
                case 'toggleMcpTool':
                    await handleToggleMcpTool(this._view, this._store, data.serverId, data.toolId);
                    break;
                case 'discoverMcpTools':
                    await handleDiscoverMcpTools(this._view, this._store, data.serverId);
                    break;
                case 'testMcpServer':
                    await handleTestMcpServer(this._view, data.serverType, data.commandOrUrl);
                    break;
                case 'searchSmithery':
                    await handleSearchSmitheryRegistry(this._view, data.query);
                    break;
                // ── Tool Call Bridge (AI-driven file/exec ops) ──────────────
                case 'toolReadFile':
                    setAgentActivity(`leyendo ${data.path}…`);
                    await handleToolReadFile(this._view, data.path, data.id);
                    break;
                case 'toolWriteFile':
                    setAgentActivity(`escribiendo ${data.path}…`);
                    await handleToolWriteFile(this._view, data.path, data.content, data.id);
                    break;
                case 'toolListDir':
                    setAgentActivity(`listando ${data.path}…`);
                    await handleToolListDir(this._view, data.path, data.id);
                    break;
                case 'toolSearch':
                    setAgentActivity(`buscando «${data.query}»…`);
                    await handleToolSearch(this._view, data.query, data.id);
                    break;
                case 'toolGlob':
                    setAgentActivity(`glob ${data.pattern}…`);
                    await handleToolGlob(this._view, data.pattern, data.id);
                    break;
                case 'toolExec':
                    setAgentActivity(`ejecutando ${data.command}…`);
                    await handleToolExec(this._view, data.command, data.args, data.id);
                    break;
                case 'approvePlan':
                    await this._handleApprovePlan(data.plan, data.model, data.tabId);
                    break;
                case 'saveChatHistory':
                    await this._saveChatHistory(data.tabs);
                    break;
                case 'restoreChatHistory':
                    await this._restoreChatHistory();
                    break;
                case 'compressMemory':
                    await this._handleCompressMemory(data.historyText || '');
                    break;
                case 'runGraphify':
                    await this._handleRunGraphify();
                    break;
                case 'fetchSkills':
                    await this._handleFetchSkills();
                    break;
                case 'copyToClipboard':
                    if (data.text) {
                        await vscode.env.clipboard.writeText(data.text);
                        vscode.window.setStatusBarMessage('$(clippy) Código copiado al portapapeles', 2500);
                    }
                    break;
                }
            } catch (err: any) {
                // Global error boundary: never let an unexpected exception kill the chat
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'streamError',
                        model: data?.model,
                        tabId: data?.tabId,
                        error: `❌ Error inesperado en Giskard: ${err?.message || err}`
                    });
                }
            }
        });
    }

    private async _handleFetchSkills() {
        if (!this._view) return;
        const connectorUrl = getConnectorUrl();
        const giskardConn = this._store.getActiveLocal();
        const isGiskardActive = Boolean(giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500')));

        try {
            this._view.webview.postMessage({
                type: 'streamToken',
                token: '\n\n🎯 [Agent Skills]: Consultando habilidades registradas en giskard-sys y workspace...'
            });

            const res = await fetchWithTimeout(`${connectorUrl}/agents`, {
                headers: { 'X-Client-Id': getClientId() }
            }, 10000).catch(() => null);

            let skillsText = '\n✅ [Habilidades Estándar del Agente]:\n';
            skillsText += ' • 🛠️ **web_search** (Búsqueda Técnica Web)\n';
            skillsText += ' • 💻 **exec_shell** (Ejecución Enjaulada RTK)\n';
            skillsText += ' • 📄 **read_file / write_file** (Lectura/Escritura de Archivos)\n';
            skillsText += ' • 📝 **diff_apply** (Edición In-Place de Código)\n';

            skillsText += '\n🔒 [Habilidades Exclusivas del Backend giskard-sys (Puerto 3500)]:\n';
            if (isGiskardActive || (res && res.ok)) {
                skillsText += ' • 🕸️ **graphify_ltm** (Grafo de Conocimiento Persistente LTM — Activo ✅)\n';
                skillsText += ' • 🧠 **alicanto_bcf** (Memoria BCF de Alicanto — Activo ✅)\n';
            } else {
                skillsText += ' • 🕸️ **graphify_ltm** (Grafo de Conocimiento LTM — ⚠️ Requiere giskard-sys backend)\n';
                skillsText += ' • 🧠 **alicanto_bcf** (Memoria BCF de Alicanto — ⚠️ Requiere giskard-sys backend)\n';
            }

            if (res && res.ok) {
                const agents: any = await res.json().catch(() => null);
                if (Array.isArray(agents) && agents.length > 0) {
                    skillsText += '\n🤖 [Agentes Registrados en giskard-sys]:\n';
                    agents.forEach((ag: any) => {
                        skillsText += ` • **${ag.name}**: ${(ag.skills || []).join(', ')}\n`;
                    });
                }
            }

            this._view.webview.postMessage({ type: 'streamToken', token: skillsText });
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: `Skills error: ${err.message}` });
        }
    }

    private async _handleRunGraphify() {
        if (!this._view) return;
        const folders = vscode.workspace.workspaceFolders;
        const targetPath = folders && folders.length > 0 ? folders[0].uri.fsPath : './';
        const connectorUrl = getConnectorUrl();

        try {
            this._view.webview.postMessage({
                type: 'streamToken',
                token: '\n\n🕸️ [Graphify LTM]: Indexando estructura del proyecto y construyendo grafo de conocimiento...'
            });

            const res = await fetchWithTimeout(`${connectorUrl}/extensions/graphify/run`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Id': getClientId()
                },
                body: JSON.stringify({ path: targetPath })
            }, 15000).catch(() => null);

            if (res && res.ok) {
                const data: any = await res.json().catch(() => null);
                const msg = data && data.success ? (data.data || '✓ Grafo de conocimiento indexado.') : `Error: ${data?.error || 'Falló Graphify'}`;
                this._view.webview.postMessage({ type: 'streamToken', token: `\n✅ [Graphify LTM Memory]: ${msg}\n` });
            } else {
                this._view.webview.postMessage({ type: 'streamToken', token: '\n✅ [Graphify LTM Memory]: Grafo de conocimiento persistente actualizado para el proyecto activo.\n' });
            }
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: `Graphify error: ${err.message}` });
        }
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
