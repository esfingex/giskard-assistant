/**
 * Giskard Assistant VSCode Extension — Cell: Chat Webview Sidebar
 * Dedicated Webview script loaded from media/chatView.js and media/marked.min.js
 */

import * as vscode from 'vscode';
import { getConnectorUrl, getClientId, execCliCommand, fetchLlmModels, updateProviderConfig } from '../core/api';

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'sendPrompt') {
                await this._handlePrompt(data.prompt, data.model, data.includeActiveFile, data.contextType);
            } else if (data.type === 'fetchModels') {
                await this._sendModelsList();
            } else if (data.type === 'fetchPolicy') {
                await this._handleFetchPolicy();
            } else if (data.type === 'addAllowedCommand') {
                await this._handleAddCommandPolicy(data.command);
            } else if (data.type === 'removeAllowedCommand') {
                await this._handleRemoveCommandPolicy(data.command);
            } else if (data.type === 'executeAction') {
                await this._handleAction(data.action);
            } else if (data.type === 'saveSettings') {
                await this._handleSaveSettings(data.provider, data.baseUrl, data.apiKey);
            } else if (data.type === 'saveConnectorUrl') {
                const config = vscode.workspace.getConfiguration('giskard-sys');
                await config.update('connectorUrl', data.url, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`✓ Conector Giskard-Sys configurado en: ${data.url}`);
                await this.refreshState();
            } else if (data.type === 'compressMemory') {
                await this._handleCompressMemory(data.history);
            } else if (data.type === 'openDiff') {
                await this._handleOpenDiff(data.code);
            } else if (data.type === 'mountWorkspace') {
                await this._handleMountWorkspace();
            } else if (data.type === 'executeShellCommand') {
                await this._handleExecuteShellCommand(data.command);
            } else if (data.type === 'checkGraphify') {
                await this._handleCheckGraphify();
            } else if (data.type === 'runGraphify') {
                await this._handleRunGraphify();
            }
        });

        this._sendModelsList();
        this._handleFetchPolicy();
        this._handleCheckGraphify();
    }

    public async refreshState() {
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'stateRefreshed', url: getConnectorUrl() });
        await this._sendModelsList();
        await this._handleFetchPolicy();
        await this._handleCheckGraphify();
    }

    private async _sendModelsList() {
        if (!this._view) return;
        const models = await fetchLlmModels();
        this._view.webview.postMessage({ type: 'modelsList', models, currentUrl: getConnectorUrl() });
    }

    private async _handleCheckGraphify() {
        if (!this._view) return;
        try {
            const url = `${getConnectorUrl()}/extensions/graphify/check`;
            const res = await fetch(url);
            const data: any = await res.json();
            this._view.webview.postMessage({ type: 'graphifyStatus', status: data });
        } catch {
            this._view.webview.postMessage({ type: 'graphifyStatus', status: { success: false, error: 'Sin conexión a Giskard-Sys' } });
        }
    }

    private async _handleRunGraphify() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage("No hay ninguna carpeta de workspace abierta en VSCode para indexar con Graphify.");
            return;
        }

        const targetPath = folders[0].uri.fsPath;
        vscode.window.showInformationMessage(`🕸️ Iniciando indexación con Graphify en: ${targetPath}...`);
        try {
            const url = `${getConnectorUrl()}/extensions/graphify/run`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ path: targetPath })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`✓ Graphify: Grafo de memoria generado exitosamente para ${targetPath}`);
                if (this._view) {
                    this._view.webview.postMessage({ type: 'graphifyResult', result: data.data });
                }
            } else {
                vscode.window.showErrorMessage(`Graphify Error: ${data.error}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error ejecutando Graphify: ${err.message}`);
        }
    }

    private async _handleFetchPolicy() {
        if (!this._view) return;
        try {
            const url = `${getConnectorUrl()}/policy`;
            const res = await fetch(url);
            const data: any = await res.json();
            if (data.success) {
                this._view.webview.postMessage({ type: 'policyLoaded', policy: data.data });
            }
        } catch {
            // Silencioso
        }
    }

    private async _handleAddCommandPolicy(command: string) {
        if (!this._view) return;
        try {
            const url = `${getConnectorUrl()}/policy/commands/add`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`✓ Comando permitido en Giskard-Sys: ${command}`);
                await this._handleFetchPolicy();
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al agregar comando: ${err.message}`);
        }
    }

    private async _handleRemoveCommandPolicy(command: string) {
        if (!this._view) return;
        try {
            const url = `${getConnectorUrl()}/policy/commands/remove`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`🚫 Comando bloqueado/removido en Giskard-Sys: ${command}`);
                await this._handleFetchPolicy();
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al remover comando: ${err.message}`);
        }
    }

    private async _handleExecuteShellCommand(cmdText: string) {
        let terminal = vscode.window.activeTerminal;
        if (!terminal) {
            terminal = vscode.window.createTerminal('Giskard Terminal');
        }
        terminal.show();
        terminal.sendText(cmdText);

        try {
            const url = `${getConnectorUrl()}/exec`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command: 'shell', args: [cmdText] })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`⚡ Comando Shell ejecutado via Giskard-Sys: ${cmdText}`);
            } else {
                vscode.window.showWarningMessage(`Shell enviada a Terminal integrada (${data.error || 'OK'})`);
            }
        } catch (err: any) {
            // Silencioso
        }
    }

    private async _handleMountWorkspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage("No hay ninguna carpeta de workspace abierta en VSCode.");
            return;
        }

        const targetPath = folders[0].uri.fsPath;
        try {
            const url = `${getConnectorUrl()}/workspace/mount`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ path: targetPath })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`✓ Workspace montado en Sandbox Jail: ${targetPath}`);
            } else {
                vscode.window.showErrorMessage(`Fallo al montar workspace: ${data.error}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error de conexión al conector: ${err.message}`);
        }
    }

    private async _handleOpenDiff(proposedCode: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            const doc = await vscode.workspace.openTextDocument({ content: proposedCode, language: 'typescript' });
            await vscode.window.showTextDocument(doc);
            return;
        }

        const activeDoc = editor.document;
        const activeUri = activeDoc.uri;
        const activeText = activeDoc.getText();

        const tempDoc = await vscode.workspace.openTextDocument({ content: proposedCode, language: activeDoc.languageId });
        await vscode.commands.executeCommand('vscode.diff', activeUri, tempDoc.uri, `Propuesta de Cambios: ${activeDoc.fileName}`);

        const selection = await vscode.window.showInformationMessage(
            `Giskard Assistant: ¿Deseas aplicar esta propuesta de cambios a ${activeDoc.fileName}?`,
            "Aplicar Cambios ✏️", "Descartar"
        );

        if (selection === "Aplicar Cambios ✏️") {
            const fullRange = new vscode.Range(
                activeDoc.positionAt(0),
                activeDoc.positionAt(activeText.length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(activeUri, fullRange, proposedCode);
            await vscode.workspace.applyEdit(edit);
            await activeDoc.save();
            vscode.window.showInformationMessage(`✓ Cambios aplicados exitosamente a ${activeDoc.fileName}`);
        }
    }

    private async _handleCompressMemory(history: string) {
        if (!this._view) return;
        try {
            const prompt = `Analiza este historial de chat y genera un resumen comprimido BCF [EN]/[ES] con las decisiones clave y contexto técnico para guardar en memoria soberana:\n\n${history}`;
            const url = `${getConnectorUrl()}/llm/chat`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ model: 'qwimi-k2.6:distill', prompt, inject_sandbox_context: true })
            });
            const data: any = await res.json();
            const summary = data.success ? data.data : 'Resumen de sesión guardado.';
            this._view.webview.postMessage({ type: 'memoryCompressed', summary });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: `Fallo al comprimir memoria: ${err.message}` });
        }
    }

    private async _handleSaveSettings(provider: string, baseUrl?: string, apiKey?: string) {
        if (!this._view) return;
        try {
            const res = await updateProviderConfig(provider, baseUrl, apiKey);
            if (res.success) {
                vscode.window.showInformationMessage(`✓ Proveedor configurado: ${provider}`);
                this._view.webview.postMessage({ type: 'settingsSaved', message: `✓ Proveedor guardado: ${provider}` });
                await this._sendModelsList();
            } else {
                this._view.webview.postMessage({ type: 'settingsError', error: res.error });
            }
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'settingsError', error: err.message });
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

    private async _handlePrompt(prompt: string, model: string, includeActiveFile: boolean, contextType: string) {
        if (!this._view) return;

        let fullPrompt = prompt;
        if (includeActiveFile) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const docText = editor.document.getText();
                const fileName = editor.document.fileName;
                fullPrompt = `[Archivo Activo: ${fileName}]\n\`\`\`\n${docText}\n\`\`\`\n\n${prompt}`;
            }
        }

        if (contextType && contextType !== 'none') {
            fullPrompt = `[Contexto Adjunto (${contextType})]\n${fullPrompt}`;
        }

        if (model.startsWith('cli:')) {
            const cliName = model.replace('cli:', '');
            try {
                const resData: any = await execCliCommand(cliName, fullPrompt);
                const text = resData.success ? resData.data : `Error CLI: ${resData.error}`;
                this._view.webview.postMessage({ type: 'streamToken', token: text, model });
                this._view.webview.postMessage({ type: 'streamComplete' });
            } catch (err: any) {
                this._view.webview.postMessage({ type: 'streamError', error: err.message });
            }
            return;
        }

        try {
            const url = `${getConnectorUrl()}/llm/stream`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ model, prompt: fullPrompt, inject_sandbox_context: true })
            });

            if (!res.ok || !res.body) {
                this._view.webview.postMessage({ type: 'streamError', error: `No se pudo conectar a ${url} (HTTP ${res.status})` });
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('data:')) {
                        let dataToken = line.startsWith('data: ') ? line.substring(6) : line.substring(5);
                        if (dataToken === '[DONE]' || dataToken.trim() === '[DONE]') {
                            this._view.webview.postMessage({ type: 'streamComplete' });
                            return;
                        }
                        this._view.webview.postMessage({ type: 'streamToken', token: dataToken, model });
                    }
                }
            }
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            this._view.webview.postMessage({ type: 'streamError', error: `Error conectando al conector soberano: ${err.message}` });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'marked.min.js'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chatView.js'));

        return `<!DOCTYPE html>
<html lang="es" style="height: 100%;">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource}; connect-src *;">
    <style>
        html, body { height: 100%; margin: 0; padding: 0; box-sizing: border-box; overflow: hidden; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: transparent; }
        .chat-container { display: flex; flex-direction: column; height: 100%; padding: 8px; box-sizing: border-box; }
        .header { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; flex-shrink: 0; }
        .status-bar { display: flex; justify-content: space-between; align-items: center; font-size: 10px; opacity: 0.8; margin-bottom: 6px; padding: 2px 4px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; }
        select, button, input, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; border-radius: 4px; font-size: 11px; }
        select { flex: 1; }
        .messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; padding-right: 4px; }
        .msg { padding: 8px 12px; border-radius: 8px; font-size: 11px; word-break: break-word; line-height: 1.5; }
        .msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; white-space: pre-wrap; }
        .msg.bot { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; width: 96%; box-sizing: border-box; }
        
        .model-tag { display: inline-block; font-size: 9px; font-weight: bold; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 6px; border-radius: 4px; margin-bottom: 6px; }
        details.think-box { background: rgba(0,0,0,0.25); border: 1px dashed var(--vscode-input-border); border-radius: 6px; padding: 8px; margin-bottom: 8px; font-size: 10px; }
        details.think-box summary { cursor: pointer; font-weight: bold; opacity: 0.85; user-select: none; }
        details.think-box summary:hover { opacity: 1; }
        .think-content { font-style: italic; opacity: 0.85; border-left: 2px solid var(--vscode-button-background); padding-left: 8px; margin-top: 6px; font-size: 10px; line-height: 1.5; }
        
        /* Markdown Renderer Styles */
        :root {
            --user-font-color: #f8fafc;
            --user-header-color: #ffffff;
            --user-header-border: rgba(255, 255, 255, 0.15);
        }
        .answer-content { font-size: 11px; line-height: 1.6; word-break: break-word; margin-top: 4px; color: var(--user-font-color); }
        .answer-content p { margin: 6px 0; }
        .answer-content h1, .answer-content h2, .answer-content h3, .answer-content h4 { color: var(--user-header-color); font-weight: bold; margin: 12px 0 6px 0; border-bottom: 1px solid var(--user-header-border); padding-bottom: 3px; }
        .answer-content h1 { font-size: 14px; }
        .answer-content h2 { font-size: 13px; }
        .answer-content h3 { font-size: 12px; }
        .answer-content pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 10px; overflow-x: auto; margin: 8px 0; font-family: var(--vscode-editor-font-family, monospace); }
        .answer-content code { background: rgba(255,255,255,0.08); color: #f8fafc; padding: 2px 5px; border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px; }
        .answer-content pre code { background: transparent; padding: 0; color: inherit; }
        .answer-content table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; }
        .answer-content th, .answer-content td { border: 1px solid var(--vscode-input-border); padding: 6px 10px; text-align: left; }
        .answer-content th { background: rgba(255,255,255,0.06); color: var(--user-header-color); font-weight: bold; }
        .answer-content tr:nth-child(even) { background: rgba(255,255,255,0.03); }
        .answer-content ul, .answer-content ol { margin: 6px 0; padding-left: 20px; }
        .answer-content li { margin: 3px 0; }
        .answer-content blockquote { border-left: 3px solid var(--user-header-color); margin: 8px 0; padding-left: 10px; opacity: 0.9; font-style: italic; }

        /* Modal Tabs */
        .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-input-border); margin-bottom: 8px; padding-bottom: 4px; }
        .tab-btn { flex: 1; background: transparent; border: none; padding: 6px 4px; font-size: 10px; font-weight: bold; cursor: pointer; opacity: 0.6; border-radius: 4px; color: var(--vscode-foreground); }
        .tab-btn.active { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .tab-content { display: none; flex-direction: column; gap: 8px; }
        .tab-content.active { display: flex; }

        .filter-group-title { font-weight: bold; font-size: 10px; color: #38bdf8; margin: 4px 0 4px 0; padding-bottom: 2px; border-bottom: 1px solid rgba(56,189,248,0.2); }
        .filter-tag { font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }
        .filter-tag.ollama { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
        .filter-tag.cli { background: rgba(251, 146, 60, 0.2); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.4); }
        .cmd-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; background: rgba(255,255,255,0.08); border: 1px solid var(--vscode-input-border); padding: 1px 5px; border-radius: 4px; }
        .cmd-badge button { background: transparent; border: none; color: #f87171; font-weight: bold; cursor: pointer; padding: 0 2px; }

        .input-box { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; background: transparent; position: relative; }
        textarea { resize: none; width: 100%; box-sizing: border-box; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
        .menu-dropdown { position: absolute; bottom: 35px; left: 0; background: var(--vscode-menu-background); border: 1px solid var(--vscode-menu-border); border-radius: 6px; display: none; flex-direction: column; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.5); width: 220px; }
        .menu-item { padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-menu-foreground); }
        .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        .btn-add, .btn-compress { background: transparent; border: 1px solid var(--vscode-input-border); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 10px; }
        .btn-send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; padding: 5px 12px; font-weight: bold; }
        .btn-settings { background: transparent; border: none; cursor: pointer; font-size: 14px; padding: 2px 4px; }
        
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 200; justify-content: center; align-items: center; }
        .modal-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); padding: 12px; border-radius: 8px; width: 90%; max-width: 320px; display: flex; flex-direction: column; gap: 8px; }
        .modal-card h4 { margin: 0 0 4px 0; font-size: 12px; }
        .field { display: flex; flex-direction: column; gap: 3px; font-size: 10px; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="header">
            <button class="btn-settings" id="open-settings-btn" title="Ajustes de Conector / API">⚙️</button>
            <select id="model-select">
                <optgroup label="Enjambre Local (Ollama)">
                    <option value="qwimi-k2.6:distill">qwimi-k2.6:distill (128K)</option>
                </optgroup>
            </select>
        </div>

        <div class="status-bar">
            <span id="token-counter">Tokens: 0 / 32,768</span>
            <button class="btn-compress" id="compress-btn" title="Guardar resumen en memoria soberana y limpiar ventana">Comprimir Memoria</button>
        </div>

        <div class="messages" id="messages">
            <div class="msg bot">Giskard Assistant listo. Contexto de Sandbox activado.</div>
        </div>
        <div class="input-box">
            <div class="menu-dropdown" id="context-menu">
                <div class="menu-item" id="ctx-graphify">Graphify: Grafo Memoria</div>
                <div class="menu-item" id="ctx-media">Media / Captura</div>
                <div class="menu-item" id="ctx-mentions">@ Mentions (@file, @git)</div>
                <div class="menu-item" id="ctx-action-check">Action: rtk cargo check</div>
                <div class="menu-item" id="ctx-action-python">Action: rtk python3 test</div>
            </div>
            <textarea id="prompt" rows="2" placeholder="Pregunta a la IA... (Enter para enviar, Shift+Enter para salto de línea)"></textarea>
            <div class="toolbar">
                <button class="btn-add" id="add-ctx-btn">+ Context</button>
                <label><input type="checkbox" id="inc-file" checked> Archivo activo</label>
                <button id="send-btn" class="btn-send">Enviar ⚡</button>
            </div>
        </div>
    </div>

    <!-- Modal Ajustes Conector / API con Pestañas (Tabs) -->
    <div class="modal" id="settings-modal">
        <div class="modal-card">
            <h4>⚙️ Ajustes de Giskard Assistant</h4>
            
            <div class="tab-nav">
                <button type="button" class="tab-btn active" id="tab-btn-local">Local & Visibilidad</button>
                <button type="button" class="tab-btn" id="tab-btn-remote">API Remota & Keys</button>
                <button type="button" class="tab-btn" id="tab-btn-palette">🎨 Paleta & Estilos</button>
            </div>

            <!-- Tab 1: Local & Models & Command Policy & Graphify -->
            <div class="tab-content active" id="tab-content-local">
                <div class="field">
                    <label>URL Servidor Giskard-Sys:</label>
                    <input type="text" id="cfg-connector-url" value="http://localhost:3500">
                </div>
                <div style="display: flex; gap: 4px; margin: 2px 0;">
                    <button type="button" id="mount-workspace-btn" style="flex: 1; background: transparent; border: 1px solid #38bdf8; color: #38bdf8; padding: 4px; border-radius: 4px; font-size: 9px; cursor: pointer;">Montar Workspace</button>
                    <button type="button" id="run-graphify-btn" style="flex: 1; background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #38bdf8; padding: 4px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Generar Grafo Graphify</button>
                </div>
                <div class="field">
                    <label>Tema & Color de Texto:</label>
                    <select id="cfg-theme-select">
                        <option value="minimal_white">Blanco Minimalista (Estilo Antigravity)</option>
                        <option value="cyan_accent">Azul Neón / Cyan Accent</option>
                    </select>
                </div>
                <div class="field">
                    <label>Proveedor Activo Backend:</label>
                    <select id="cfg-provider">
                        <option value="ollama">Ollama (Local)</option>
                        <option value="openai_compat">OpenAI / Compatible / Remoto</option>
                        <option value="gemini">Gemini CLI</option>
                        <option value="claude">Claude CLI</option>
                    </select>
                </div>
                <div class="field">
                    <label>🎯 Modelos Visibles en Selector:</label>
                    <div id="model-filter-list" style="max-height: 70px; overflow-y: auto; border: 1px solid var(--vscode-input-border); padding: 4px; border-radius: 4px; background: rgba(0,0,0,0.15);">Cargando modelos...</div>
                </div>
                <div class="field" style="margin-top: 4px;">
                    <label>🛡️ Comandos Permitidos (Shell / Tools):</label>
                    <div id="cmd-policy-list" style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 60px; overflow-y: auto; border: 1px solid var(--vscode-input-border); padding: 4px; border-radius: 4px; background: rgba(0,0,0,0.15);">Cargando permisos...</div>
                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        <input type="text" id="add-cmd-input" placeholder="ej. docker, npm..." style="flex: 1; font-size: 10px;">
                        <button type="button" id="add-cmd-btn" style="padding: 2px 6px; font-size: 10px;">+ Permitir</button>
                    </div>
                </div>
            </div>

            <!-- Tab 2: Remote & Keys -->
            <div class="tab-content" id="tab-content-remote">
                <div class="field">
                    <label>Base URL Remota (OpenAI/Compatible):</label>
                    <input type="text" id="cfg-base-url" placeholder="https://api.openai.com/v1">
                </div>
                <div class="field">
                    <label>API Key Remota (OpenAI / DeepSeek / External):</label>
                    <input type="password" id="cfg-api-key" placeholder="sk-...">
                </div>
            </div>

            <!-- Tab 3: Configurable Color Palette -->
            <div class="tab-content" id="tab-content-palette">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 10px; font-weight: bold;">⚡ Presets de 1 Clic:</label>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
                        <button type="button" id="preset-white" style="font-size: 9px; padding: 4px 6px; background: #1e293b; color: #ffffff; border: 1px solid #475569; border-radius: 4px; cursor: pointer;">⚪ Blanco Minimal</button>
                        <button type="button" id="preset-cyan" style="font-size: 9px; padding: 4px 6px; background: #0f172a; color: #38bdf8; border: 1px solid #38bdf8; border-radius: 4px; cursor: pointer;">🔵 Neón Cyan</button>
                        <button type="button" id="preset-emerald" style="font-size: 9px; padding: 4px 6px; background: #064e3b; color: #34d399; border: 1px solid #34d399; border-radius: 4px; cursor: pointer;">🟢 Matrix Emerald</button>
                        <button type="button" id="preset-purple" style="font-size: 9px; padding: 4px 6px; background: #3b0764; color: #c084fc; border: 1px solid #c084fc; border-radius: 4px; cursor: pointer;">🟣 Cyberpunk</button>
                    </div>

                    <div class="field">
                        <label>Color de Texto Principal:</label>
                        <input type="color" id="palette-text-color" value="#f8fafc" style="height: 26px; padding: 2px; cursor: pointer; width: 100%;">
                    </div>
                    <div class="field">
                        <label>Color de Encabezados (H1, H2, H3):</label>
                        <input type="color" id="palette-header-color" value="#ffffff" style="height: 26px; padding: 2px; cursor: pointer; width: 100%;">
                    </div>
                    <div class="field">
                        <label>Color de Acento (Etiquetas y Botones):</label>
                        <input type="color" id="palette-accent-color" value="#38bdf8" style="height: 26px; padding: 2px; cursor: pointer; width: 100%;">
                    </div>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px;">
                <button id="close-modal-btn" style="background: transparent;">Cancelar</button>
                <button id="save-cfg-btn" class="btn-send">Guardar 💾</button>
            </div>
        </div>
    </div>

    <script src="${markedUri}"></script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
