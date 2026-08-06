/**
 * Giskard Assistant VSCode Extension — Cell: Chat Webview Sidebar
 * Copyright (C) 2025-2026 Giskard Project
 *
 * All HTML layout CSS lives in src/cells/htmlShell.ts.
 * MCP operations live in src/cells/mcpHandlers.ts.
 * Tool call bridge ops live in src/cells/toolHandlers.ts.
 */

import * as vscode from 'vscode';
import {
    getConnectorUrl,
    getClientId,
    execCliCommand,
    fetchLlmModels,
    fetchWithTimeout,
    checkHealth,
    resetSession
} from '../core/api';
import { ConnectionStore } from '../core/connectionStore';
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
    resolveWorkspaceFile,
    extractCodeBlocks
} from './toolHandlers';

export interface CodeContextBlock {
    relativePath: string;
    startLine: number;
    endLine: number;
    code: string;
    lang: string;
}

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;
    /** Stores the full text of the last AI response for conversational apply flow */
    private _lastBotResponse: string = '';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _store: ConnectionStore
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = getHtmlForWebview(this._extensionUri, webviewView.webview);

        // Message router — clean dispatch, delegating to specialized modules
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'webviewReady':
                    await this.refreshState();
                    await sendMcpServersList(this._view, this._store);
                    break;
                case 'sendPrompt':
                    await this._handlePrompt(data.prompt, data.model, data.includeActiveFile, data.contextType);
                    break;
                case 'fetchModels':
                    await this._sendModelsList();
                    break;
                case 'executeAction':
                    await this._handleAction(data.action);
                    break;
                case 'saveSettings':
                    await this._handleSaveSettings(data.provider, data.baseUrl, data.apiKey);
                    break;
                case 'saveConnectorUrl':
                    const config = vscode.workspace.getConfiguration('giskard-assistant');
                    await config.update('connectorUrl', data.url, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`✓ Conector configurado en: ${data.url}`);
                    await this.refreshState();
                    break;
                case 'compressMemory':
                    await this._handleCompressMemory(data.history);
                    break;
                case 'openDiff':
                    await this._handleOpenDiff(data.code, data.filePath);
                    break;
                case 'executeShellCommand':
                    await this._handleExecuteShellCommand(data.command);
                    break;
                case 'stopGeneration':
                    this._handleStopGeneration();
                    break;
                case 'clearContext':
                    await this._handleClearContext();
                    break;
                case 'openFile':
                    await handleOpenFile(data.relativePath);
                    break;
                // ── Connection Manager ──────────────────────────────────
                case 'addConnection':
                    await this._handleAddConnection(data);
                    break;
                case 'removeConnection':
                    await this._handleRemoveConnection(data.id);
                    break;
                case 'activateConnection':
                    await this._handleActivateConnection(data.id);
                    break;
                case 'loadConnections':
                    await this._sendConnectionsList();
                    break;
                case 'testConnectionUrl':
                    await this._handleTestConnectionUrl(data.url);
                    break;
                // ── MCP Server Manager ──────────────────────────────────
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
                    await handleToolReadFile(this._view, data.path, data.id);
                    break;
                case 'toolWriteFile':
                    await handleToolWriteFile(this._view, data.path, data.content, data.id);
                    break;
                case 'toolExec':
                    await handleToolExec(this._view, data.command, data.args || [], data.id);
                    break;
            }
        });
    }

    /** Called from extension.ts Ctrl+L handler */
    public injectCodeContext(block: CodeContextBlock) {
        if (!this._view) return;
        this._view.show?.(true);
        this._view.webview.postMessage({
            type: 'attachedContext',
            relativePath: block.relativePath,
            startLine: block.startLine,
            endLine: block.endLine,
            code: block.code,
            lang: block.lang,
            prefillPrompt: 'Explica qué hace este código y sugiere mejoras.'
        });
    }

    public async refreshState() {
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'stateRefreshed', url: getConnectorUrl() });
        await this._sendModelsList();
        await this._sendConnectionsList();
    }

    // ── Private Handlers ──────────────────────────────────────────────────────

    private async _handleClearContext() {
        if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
        }
        await resetSession();
        if (this._view) {
            this._view.webview.postMessage({ type: 'contextCleared' });
        }
    }

    private async _sendConnectionsList() {
        if (!this._view) return;
        const connections = this._store.getAll();
        this._view.webview.postMessage({ type: 'connectionsLoaded', connections });
    }

    private async _handleAddConnection(data: any) {
        if (!this._view) return;
        try {
            await this._store.addConnection(
                data.name,
                data.connType,
                data.url,
                data.tag,
                data.apiKey
            );
            vscode.window.showInformationMessage(`✓ Conexión "${data.name}" guardada.`);
            await this._sendConnectionsList();
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'connectionError', error: err.message });
            vscode.window.showErrorMessage(`Error guardando conexión: ${err.message}`);
        }
    }

    private async _handleRemoveConnection(id: number) {
        if (!this._view) return;
        try {
            await this._store.removeConnection(id);
            vscode.window.showInformationMessage(`✓ Conexión eliminada.`);
            await this._sendConnectionsList();
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error eliminando conexión: ${err.message}`);
        }
    }

    private async _handleActivateConnection(id: number) {
        if (!this._view) return;
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
        if (!this._view) return;
        const start = Date.now();
        try {
            const res = await fetchWithTimeout(`${url.replace(/\/$/, '')}/health`, {
                headers: { 'X-Client-Id': getClientId() }
            }, 8000);
            const ms = Date.now() - start;
            this._view.webview.postMessage({
                type: 'connectionTested',
                ok: res.ok,
                status: res.status,
                ms,
                error: res.ok ? undefined : `HTTP ${res.status}`
            });
        } catch (err: any) {
            const ms = Date.now() - start;
            let reason = err.message;
            if (err.name === 'AbortError') reason = 'Timeout — sin respuesta en 8 segundos';
            else if (err.message.includes('ECONNREFUSED')) reason = 'Conexión rechazada — el servidor no está activo en esa URL';
            else if (err.message.includes('ENOTFOUND')) reason = 'Host no encontrado — verifica la URL';

            this._view.webview.postMessage({
                type: 'connectionTested',
                ok: false,
                error: reason,
                ms
            });
        }
    }

    private async _sendModelsList() {
        if (!this._view) return;
        const models = await fetchLlmModels();
        this._view.webview.postMessage({ type: 'modelsList', models, currentUrl: getConnectorUrl() });
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
        contextType: string
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
                    this._view.webview.postMessage({ type: 'streamToken', token: '📦 Abriendo diff propuesto...', model });
                    this._view.webview.postMessage({ type: 'streamComplete' });
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

        // Inject active MCP servers context
        const mcpContext = getActiveMcpPromptContext(this._store);
        if (mcpContext) {
            fullPrompt = mcpContext + fullPrompt;
        }

        // Passive workspace context injection
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const activeFolder = folders[0];
            fullPrompt = `[Proyecto Activo VSCode: ${activeFolder.name} (${activeFolder.uri.fsPath})]\n${fullPrompt}`;
        }

        if (includeActiveFile) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                const docText = editor.document.getText();
                const fileName = editor.document.fileName;
                const relPath = vscode.workspace.asRelativePath(editor.document.uri);
                fullPrompt = `[Archivo Activo: ${fileName}]\n\`\`\`\n${docText}\n\`\`\`\n\n${fullPrompt}`;
                fullPrompt += `\n\n[INSTRUCCION PARA LA IA]: Cuando propongas cambios de codigo, incluye SIEMPRE en la primera linea del bloque de codigo un comentario con la ruta relativa del archivo, por ejemplo: // ${relPath}`;
            }
        }

        const connectorUrl = getConnectorUrl();
        const isOnline = await checkHealth(connectorUrl);

        if (!isOnline) {
            this._view.webview.postMessage({ type: 'offlineMode', active: true });
            await this._streamFromOllamaFallback(fullPrompt, model, prompt, targetPathMatch, includeActiveFile);
            return;
        }

        this._view.webview.postMessage({ type: 'offlineMode', active: false });

        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

        try {
            const streamUrl = `${connectorUrl}/llm/stream`;
            const payload = {
                prompt: fullPrompt,
                model: model || undefined,
                inject_sandbox_context: true
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
                    if (!trimmed || trimmed.startsWith(':')) continue;

                    if (trimmed.startsWith('data: ')) {
                        const rawData = trimmed.substring(6).trim();
                        if (rawData === '[DONE]') continue;

                        try {
                            const json = JSON.parse(rawData);
                            let contentToken = '';
                            if (json.choices && json.choices[0]?.delta?.content) {
                                contentToken = json.choices[0].delta.content;
                            } else if (json.content) {
                                contentToken = json.content;
                            } else if (typeof json === 'string') {
                                contentToken = json;
                            }

                            if (contentToken) {
                                accumulated += contentToken;
                                this._view.webview.postMessage({ type: 'streamToken', token: contentToken, model });
                            }
                        } catch {
                            if (rawData) {
                                accumulated += rawData;
                                this._view.webview.postMessage({ type: 'streamToken', token: rawData, model });
                            }
                        }
                    }
                }
            }

            this._lastBotResponse = accumulated;
            this._view.webview.postMessage({ type: 'streamComplete' });
            await this._maybeAutoTriggerDiff(prompt, accumulated, targetPathMatch, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') return;

            // Backend failed during stream → Fallback to direct Ollama
            try {
                this._view.webview.postMessage({ type: 'offlineMode', active: true });
                await this._streamFromOllamaFallback(fullPrompt, model, prompt, targetPathMatch, includeActiveFile);
            } catch (fallbackErr: any) {
                if (fallbackErr.name !== 'AbortError') {
                    this._view.webview.postMessage({
                        type: 'streamError',
                        error: `Conexión fallida y Ollama offline: ${err.message}`
                    });
                }
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    private async _streamFromOllamaFallback(
        fullPrompt: string,
        model: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean
    ) {
        if (!this._view) return;

        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const defaultModel = config.get<string>('defaultModel') || 'ollama';
        const ollamaBaseUrl = config.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';

        const targetModel = (model && !model.startsWith('cli:')) ? model : defaultModel;
        const url = `${ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: targetModel, prompt: fullPrompt, stream: true }),
                signal
            });

            if (!response.ok || !response.body) {
                throw new Error(`Ollama local respondió HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let ollamaAccumulated = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                try {
                    const json = JSON.parse(chunk);
                    if (json.response) {
                        ollamaAccumulated += json.response;
                        this._view.webview.postMessage({ type: 'streamToken', token: json.response, model });
                    }
                    if (json.done) {
                        this._lastBotResponse = ollamaAccumulated;
                        this._view.webview.postMessage({ type: 'streamComplete' });
                        if (userPrompt !== undefined) {
                            await this._maybeAutoTriggerDiff(userPrompt, ollamaAccumulated, extractedPath, includeActiveFile);
                        }
                        return;
                    }
                } catch { /* Partial chunk */ }
            }
            this._lastBotResponse = ollamaAccumulated;
            this._view.webview.postMessage({ type: 'streamComplete' });
            if (userPrompt !== undefined) {
                await this._maybeAutoTriggerDiff(userPrompt, ollamaAccumulated, extractedPath, includeActiveFile);
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `Backend y Ollama fallback inaccesibles: ${err.message}`
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    private _handleStopGeneration() {
        if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
        }
        if (this._view) {
            this._view.webview.postMessage({ type: 'streamComplete' });
        }
    }

    private async _maybeAutoTriggerDiff(
        userPrompt: string,
        botResponse: string,
        extractedPath?: string,
        includeActiveFile?: boolean
    ) {
        const explicitTrigger = /(?:genera|crea|modifica|cambia|actualiza|agrega|elimina|refactoriza)\s+(?:el\s+archivo|el\s+c[oó]digo|en\s+|el\s+script)/i.test(userPrompt);
        if (!explicitTrigger) return;

        const blocks = extractCodeBlocks(botResponse);
        if (blocks.length === 0) return;

        let best = blocks[0];
        for (const b of blocks) {
            if (b.filePath) { best = b; break; }
            if (b.code.length > best.code.length) best = b;
        }

        const targetPath = best.filePath || extractedPath;
        await this._handleOpenDiff(best.code, targetPath);
    }

    private async _handleOpenDiff(code: string, filePath?: string) {
        let doc: vscode.TextDocument | null = null;
        if (filePath) doc = await resolveWorkspaceFile(filePath);
        if (!doc) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') doc = editor.document;
        }

        if (!doc) {
            vscode.window.showInformationMessage('Giskard: No hay archivo abierto u especificado. Creando borrador...');
            const newDoc = await vscode.workspace.openTextDocument({ content: code, language: 'typescript' });
            await vscode.window.showTextDocument(newDoc, { preview: false });
            return;
        }

        // Open the active target document in the editor tab and apply edit directly in-place
        await vscode.window.showTextDocument(doc, { preview: false });
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(doc.uri, fullRange, code);
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(`✓ Cambios aplicados directamente en el archivo ${vscode.workspace.asRelativePath(doc.uri)}.`);
    }

    private async _handleCompressMemory(historyText: string) {
        if (!this._view) return;
        try {
            const res = await execCliCommand('cavemem', 'save', 'history', historyText);
            const msg = res.success
                ? '✓ Memoria soberana BCF guardada exitosamente en Alicanto CaveMem.'
                : `⚠️ No se pudo guardar memoria: ${res.error}`;
            vscode.window.showInformationMessage(msg);
            this._view.webview.postMessage({ type: 'streamToken', token: `\n\n> 🧠 **Resultado BCF:** ${msg}` });
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al guardar memoria: ${err.message}`);
            this._view.webview.postMessage({ type: 'streamComplete' });
        }
    }

    private async _handleExecuteShellCommand(command: string) {
        if (!this._view) return;
        try {
            const term = vscode.window.createTerminal('Giskard Terminal');
            term.show();
            term.sendText(command);
            this._view.webview.postMessage({ type: 'shellExecuted', command });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al ejecutar en terminal: ${err.message}`);
        }
    }
}
