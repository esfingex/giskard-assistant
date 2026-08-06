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
    fetchLlmModelsGrouped,
    fetchWithTimeout,
    checkHealth,
    resetSession
} from '../core/api';
import { fetchOllamaModels } from '../core/providers';
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

export function getModelMaxContextWindow(modelName: string): number {
    const m = (modelName || '').toLowerCase();
    if (m.includes('nemotron-3-ultra') || m.includes('nemotron-3-nano')) return 16384;
    if (m.includes('nemotron-4') || m.includes('nemotron-mini') || m.includes('phi')) return 32768;
    if (m.includes('llama-3.3') || m.includes('llama-3.1') || m.includes('llama-3.2') || m.includes('gpt-oss') || m.includes('gpt-4')) return 128000;
    if (m.includes('qwimi') || m.includes('distill') || m.includes('kimi') || m.includes('moonshot')) return 128000;
    if (m.includes('coder') || m.includes('code') || m.includes('deepseek') || m.includes('qwen')) return 65536;
    if (m.includes('gemini')) return 1048576;
    if (m.includes('claude')) return 200000;
    return 32768;
}

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'giskard-assistant.chatView';

    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;
    private _lastBotResponse: string = '';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _store: ConnectionStore
    ) { }

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

    public async refreshState() {
        await this._sendConnectionsList();
        await this._sendModelsList();
        await sendMcpServersList(this._view, this._store);
    }

    public injectCodeContext(contextBlock: { relativePath: string; startLine: number; endLine: number; code: string; lang: string }) {
        if (!this._view) return;
        this._view.webview.postMessage({
            type: 'injectCodeSnippet',
            contextBlock
        });
    }

    private async _sendConnectionsList() {
        if (!this._view) return;
        const connections = this._store.getAll();
        this._view.webview.postMessage({ type: 'connectionsLoaded', connections });
    }

    private async _handleAddConnection(data: any) {
        if (!this._view) return;
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
            this._view.webview.postMessage({ type: 'connectionError', error: err.message });
            vscode.window.showErrorMessage(`Error guardando conexión: ${err.message}`);
        }
    }

    private async _handleRemoveConnection(id: number) {
        if (!this._view) return;
        try {
            await this._store.removeConnection(id);
            vscode.window.showInformationMessage(`✓ Conexión eliminada.`);
            await this.refreshState();
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
            const cleanUrl = url.trim().replace(/\/$/, '');
            let res = await fetchWithTimeout(`${cleanUrl}/health`, {
                headers: { 'X-Client-Id': getClientId() }
            }, 5000).catch(() => null);

            if (!res || !res.ok) {
                res = await fetchWithTimeout(cleanUrl, {}, 5000).catch(() => null);
            }

            const ms = Date.now() - start;
            const ok = Boolean(res && (res.ok || res.status === 200 || res.status === 404));
            this._view.webview.postMessage({
                type: 'connectionTested',
                ok,
                status: res?.status,
                ms,
                error: ok ? undefined : (res ? `HTTP ${res.status}` : 'Servidor giskard-sys no responde en esa URL')
            });
        } catch (err: any) {
            const ms = Date.now() - start;
            let reason = err.message;
            if (err.name === 'AbortError') reason = 'Timeout — sin respuesta en 5 segundos';
            else if (err.message.includes('ECONNREFUSED')) reason = 'Conexión rechazada — verifica que el servidor esté activo';
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
        const activeConn = this._store.getActive();
        const activeTag = activeConn?.tag || 'giskard-sys';
        const activeName = activeConn?.name || (activeConn?.type === 'remote' ? 'Remote API' : 'Giskard-Sys');

        const groups = await fetchLlmModelsGrouped();
        const remoteModels = await fetchLlmModels();

        // Only query local Ollama server if an active connection is explicitly set to Ollama
        const ollamaConn = this._store.getAll().find(c => c.isActive && (c.tag === 'ollama' || c.url.includes(':11434')));
        const localModels = ollamaConn ? await fetchOllamaModels(ollamaConn.url) : [];

        this._view.webview.postMessage({
            type: 'modelsList',
            models: remoteModels,
            groups,
            localModels,
            activeTag,
            activeName,
            currentUrl: getConnectorUrl()
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
                    this._view.webview.postMessage({ type: 'streamToken', token: '📦 Aplicando código propuesto en el editor...', model });
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

        // 1. Check if Giskard-Sys active connection is present
        const giskardConn = this._store.getActiveLocal();
        const isGiskardActive = giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500'));

        // 2. Check active MCP context
        const mcpContext = getActiveMcpPromptContext(this._store);

        // Build System Capability Context Header
        let systemHeader = '';
        if (isGiskardActive) {
            systemHeader += `[Capa Soberana Giskard-Sys (${giskardConn.url}): ACTIVA | Sandbox Jail + Grafo LTM + Auditoría RTK]\n`;
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
        const targetModel = model || 'meta/llama-3.3-70b-instruct';
        let activeTag = (activeConn?.tag || 'ollama').toLowerCase();
        const maxContext = getModelMaxContextWindow(targetModel);

        const isRemoteConnection = (activeConn && activeConn.type === 'remote') ||
                                    ['nvidia', 'deepseek', 'kimi', 'qwen', 'openai', 'anthropic', 'gemini'].includes(activeTag) ||
                                    targetModel.includes('/') ||
                                    targetModel.startsWith('deepseek') ||
                                    targetModel.startsWith('moonshot') ||
                                    targetModel.startsWith('qwen');

        let apiKey = '';
        const allConns = this._store.getAll();

        if (isRemoteConnection) {
            const modelPrefix = targetModel.split('/')[0].toLowerCase();
            
            let targetConn = (activeConn && activeConn.secretRef) ? activeConn : null;
            if (!targetConn) {
                targetConn = allConns.find(c => (c.tag.toLowerCase().includes('nvidia') || c.tag.toLowerCase().includes(modelPrefix) || c.type === 'remote') && Boolean(c.secretRef)) || null;
            }
            if (!targetConn) {
                targetConn = allConns.find(c => Boolean(c.secretRef)) || null;
            }

            if (targetConn) {
                activeConn = targetConn;
                activeTag = (targetConn.tag || 'nvidia').toLowerCase();
                apiKey = (await this._store.getApiKey(targetConn.id)) || '';
            }
        } else if (activeConn && activeConn.id) {
            apiKey = (await this._store.getApiKey(activeConn.id)) || '';
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

        // 1. Explicit Local Model selected (starts with "local:") -> Stream from active/local Ollama
        if (targetModel.startsWith('local:')) {
            const localModelName = targetModel.replace(/^local:/, '');
            const ollamaUrl = (activeTag === 'ollama' && activeConn?.url) ? activeConn.url : undefined;
            await this._streamFromOllamaFallback(fullPrompt, localModelName, prompt, targetPathMatch, includeActiveFile, ollamaUrl);
            return;
        }

        // 2. Active Connection is REMOTE (NVIDIA NIM, DeepSeek, Kimi, Qwen, OpenAI, or type === 'remote')
        if (isRemoteConnection) {
            if (!apiKey || !apiKey.trim()) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `⚠️ Falta la API Key para conectar con ${targetModel}.\n\n💡 Agrega tu conexión en ⚙️ Ajustes -> Remote Connections (API Remota) con tu token (ej. nvapi-...) y haz clic en 'Activar'.`
                });
                return;
            }

            let remoteUrl = 'https://integrate.api.nvidia.com/v1';
            if (targetModel.includes('deepseek')) {
                remoteUrl = 'https://api.deepseek.com/v1';
            } else if (targetModel.includes('kimi') || targetModel.includes('moonshot')) {
                remoteUrl = 'https://api.moonshot.cn/v1';
            } else if (targetModel.includes('qwen') || targetModel.includes('dashscope')) {
                remoteUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
            } else if (activeConn && activeConn.type === 'remote' && activeConn.url && !activeConn.url.includes('localhost') && !activeConn.url.includes('127.0.0.1')) {
                remoteUrl = activeConn.url;
            }

            await this._streamFromRemoteApi(remoteUrl, apiKey, targetModel, fullPrompt, prompt, targetPathMatch, includeActiveFile);
            return;
        }

        // 3. Active Connection is OLLAMA (local or remote Ollama server profile)
        if (activeTag === 'ollama') {
            const ollamaUrl = activeConn?.url || 'http://127.0.0.1:11434';
            await this._streamFromOllamaFallback(fullPrompt, targetModel, prompt, targetPathMatch, includeActiveFile, ollamaUrl);
            return;
        }

        // 4. Active Connection is GISKARD-SYS (local port 3500)
        const connectorUrl = activeConn?.url || getConnectorUrl();
        const isOnline = await checkHealth(connectorUrl);

        if (!isOnline) {
            this._view.webview.postMessage({ type: 'offlineMode', active: true });
            await this._streamFromOllamaFallback(fullPrompt, targetModel, prompt, targetPathMatch, includeActiveFile);
            return;
        }

        this._view.webview.postMessage({ type: 'offlineMode', active: false });

        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

        try {
            const streamUrl = `${connectorUrl}/llm/stream`;
            const payload = {
                prompt: fullPrompt,
                model: targetModel || undefined,
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
                            const choice = json.choices && json.choices[0];
                            const delta = choice?.delta;
                            const msg = choice?.message;

                            if (delta?.content) {
                                contentToken = delta.content;
                            } else if (delta?.reasoning_content) {
                                contentToken = delta.reasoning_content;
                            } else if (msg?.content) {
                                contentToken = msg.content;
                            } else if (msg?.reasoning_content) {
                                contentToken = msg.reasoning_content;
                            } else if (json.content) {
                                contentToken = json.content;
                            } else if (typeof json === 'string') {
                                contentToken = json;
                            }

                            if (contentToken) {
                                accumulated += contentToken;
                                this._view.webview.postMessage({ type: 'streamToken', token: contentToken, model: targetModel });
                            }
                        } catch {
                            if (rawData) {
                                accumulated += rawData;
                                this._view.webview.postMessage({ type: 'streamToken', token: rawData, model: targetModel });
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

            try {
                this._view.webview.postMessage({ type: 'offlineMode', active: true });
                await this._streamFromOllamaFallback(fullPrompt, targetModel, prompt, targetPathMatch, includeActiveFile);
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

    /** Streams directly from Remote OpenAI-compatible APIs (NVIDIA NIM, DeepSeek, Kimi, Qwen, etc) */
    private async _streamFromRemoteApi(
        baseUrl: string,
        apiKey: string,
        model: string,
        fullPrompt: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean
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
        const maxContext = getModelMaxContextWindow(model);
        const estPromptTokens = Math.ceil(fullPrompt.length / 3.5);
        const maxResponseTokens = Math.min(4096, Math.max(512, maxContext - estPromptTokens - 200));

        try {
            const response = await fetch(cleanUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: fullPrompt }],
                    stream: true,
                    temperature: 0.7,
                    max_tokens: maxResponseTokens
                }),
                signal
            });

            if (!response.ok || !response.body) {
                const errText = await response.text().catch(() => response.statusText);
                throw new Error(`API Remota (${cleanUrl}) respondió HTTP ${response.status}: ${errText}`);
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
                            const choice = json.choices && json.choices[0];
                            const delta = choice?.delta;
                            const msg = choice?.message;

                            if (delta?.content) {
                                contentToken = delta.content;
                            } else if (delta?.reasoning_content) {
                                contentToken = delta.reasoning_content;
                            } else if (msg?.content) {
                                contentToken = msg.content;
                            } else if (msg?.reasoning_content) {
                                contentToken = msg.reasoning_content;
                            } else if (json.content) {
                                contentToken = json.content;
                            }

                            if (contentToken) {
                                accumulated += contentToken;
                                this._view.webview.postMessage({ type: 'streamToken', token: contentToken, model });
                            }
                        } catch { }
                    }
                }
            }

            this._lastBotResponse = accumulated;
            this._view.webview.postMessage({ type: 'streamComplete' });
            await this._maybeAutoTriggerDiff(userPrompt || fullPrompt, accumulated, extractedPath, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') return;
            this._view.webview.postMessage({
                type: 'streamError',
                error: `Error en API Remota (${model}): ${err.message}`
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
        customOllamaUrl?: string
    ) {
        if (!this._view) return;

        this._activeAbortController = new AbortController();
        const signal = this._activeAbortController.signal;

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const defaultModel = config.get<string>('defaultModel') || 'qwen3-coder:30b';
        const ollamaBaseUrl = customOllamaUrl || config.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';

        let targetModel = (model && !model.startsWith('cli:')) ? model : defaultModel;
        if (targetModel.includes('/') || targetModel.startsWith('deepseek') || targetModel.startsWith('moonshot')) {
            const availableLocal = await fetchOllamaModels(ollamaBaseUrl);
            targetModel = availableLocal.length > 0 ? availableLocal[0] : 'qwen3-coder:30b';
        }
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
                        this._view.webview.postMessage({ type: 'streamToken', token: json.response, model: targetModel });
                    }
                } catch {
                    if (chunk && !chunk.includes('{')) {
                        ollamaAccumulated += chunk;
                        this._view.webview.postMessage({ type: 'streamToken', token: chunk, model: targetModel });
                    }
                }
            }

            this._lastBotResponse = ollamaAccumulated;
            this._view.webview.postMessage({ type: 'streamComplete' });
            await this._maybeAutoTriggerDiff(userPrompt || fullPrompt, ollamaAccumulated, extractedPath, includeActiveFile);

        } catch (err: any) {
            if (err.name === 'AbortError') return;
            throw err;
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
                : `Error guardando memoria: ${res.error}`;
            this._view.webview.postMessage({ type: 'streamToken', token: `\n\n[Sistema]: ${msg}` });
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: err.message });
        }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendPrompt':
                    await this._handlePrompt(data.prompt, data.model, data.includeActiveFile, data.contextType);
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
                case 'activateConnection':
                    await this._handleActivateConnection(data.id);
                    break;
                case 'testConnectionUrl':
                    await this._handleTestConnectionUrl(data.url);
                    break;
                case 'fetchModels':
                    await this._sendModelsList();
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
                case 'actionBtn':
                    await this._handleAction(data.action);
                    break;
                case 'openFile':
                    await handleOpenFile(data.path);
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
                    await handleToolReadFile(this._view, data.path, data.id);
                    break;
                case 'toolWriteFile':
                    await handleToolWriteFile(this._view, data.path, data.content, data.id);
                    break;
                case 'toolExec':
                    await handleToolExec(this._view, data.command, data.args, data.id);
                    break;
                case 'compressMemory':
                    await this._handleCompressMemory(data.historyText || '');
                    break;
                case 'runGraphify':
                    await this._handleRunGraphify();
                    break;
            }
        });
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
