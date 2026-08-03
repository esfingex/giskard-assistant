/**
 * Giskard Assistant VSCode Extension — Cell: Chat Webview Sidebar
 * Copyright (C) 2025  Giskard Project
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This file handles ONLY the bridge between VSCode host and the Webview.
 * All rendering and CSS live in media/chatView.js.
 * System prompts MUST NOT contain layout CSS.
 */

import * as vscode from 'vscode';
import {
    getConnectorUrl,
    getClientId,
    execCliCommand,
    fetchLlmModels,
    updateProviderConfig,
    fetchWithTimeout,
    checkHealth,
    resetSession
} from '../core/api';

interface CodeContextBlock {
    relativePath: string;
    startLine: number;
    endLine: number;
    code: string;
    lang: string;
}

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;

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

        // Message router — clean dispatch, no auto-loads on init
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendPrompt':
                    await this._handlePrompt(data.prompt, data.model, data.includeActiveFile, data.contextType);
                    break;
                case 'fetchModels':
                    await this._sendModelsList();
                    break;
                case 'fetchPolicy':
                    await this._handleFetchPolicy();
                    break;
                case 'addAllowedCommand':
                    await this._handleAddCommandPolicy(data.command);
                    break;
                case 'removeAllowedCommand':
                    await this._handleRemoveCommandPolicy(data.command);
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
                    vscode.window.showInformationMessage(`✓ Giskard-Sys configurado en: ${data.url}`);
                    await this.refreshState();
                    break;
                case 'compressMemory':
                    await this._handleCompressMemory(data.history);
                    break;
                case 'openDiff':
                    await this._handleOpenDiff(data.code);
                    break;
                case 'executeShellCommand':
                    await this._handleExecuteShellCommand(data.command);
                    break;
                case 'checkGraphify':
                    await this._handleCheckGraphify();
                    break;
                case 'runGraphify':
                    await this._handleRunGraphify();
                    break;
                case 'stopGeneration':
                    this._handleStopGeneration();
                    break;
                case 'clearContext':
                    await this._handleClearContext();
                    break;
                case 'openFile':
                    await this._handleOpenFile(data.relativePath);
                    break;
            }
        });

        // NO auto-loads here — chat starts empty, user initiates all actions
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
        await this._handleFetchPolicy();
    }

    // ── Private Handlers ──────────────────────────────────────────────────────

    private async _handleClearContext() {
        // Abort any active stream
        if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
        }
        // Reset backend session context (best-effort)
        await resetSession();
        // Notify webview to clear UI
        if (this._view) {
            this._view.webview.postMessage({ type: 'contextCleared' });
        }
    }

    private async _handleOpenFile(relativePath: string) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('No hay un workspace abierto en VSCode.');
            return;
        }
        try {
            const resolvedUri = vscode.Uri.joinPath(folders[0].uri, relativePath);
            const doc = await vscode.workspace.openTextDocument(resolvedUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Giskard: No se pudo abrir '${relativePath}': ${err.message}`);
        }
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
            const res = await fetchWithTimeout(url, { headers: { 'X-Client-Id': getClientId() } });
            const data: any = await res.json();
            this._view.webview.postMessage({ type: 'graphifyStatus', status: data });
        } catch {
            this._view.webview.postMessage({ type: 'graphifyStatus', status: { success: false, error: 'Sin conexión a Giskard-Sys' } });
        }
    }

    private async _handleRunGraphify() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('No hay ninguna carpeta de workspace abierta en VSCode para indexar con Graphify.');
            return;
        }
        const targetPath = folders[0].uri.fsPath;
        vscode.window.showInformationMessage(`🕸️ Iniciando indexación con Graphify en: ${targetPath}...`);
        try {
            const url = `${getConnectorUrl()}/extensions/graphify/run`;
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ path: targetPath })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`✓ Graphify: Grafo generado exitosamente en ${targetPath}`);
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
            const res = await fetchWithTimeout(url, { headers: { 'X-Client-Id': getClientId() } });
            const data: any = await res.json();
            if (data.success) {
                this._view.webview.postMessage({ type: 'policyLoaded', policy: data.data });
            }
        } catch {
            // Silent
        }
    }

    private async _handleAddCommandPolicy(command: string) {
        if (!this._view) return;
        try {
            const url = `${getConnectorUrl()}/policy/commands/add`;
            const res = await fetchWithTimeout(url, {
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
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ command })
            });
            const data: any = await res.json();
            if (data.success) {
                vscode.window.showInformationMessage(`🚫 Comando removido en Giskard-Sys: ${command}`);
                await this._handleFetchPolicy();
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al remover comando: ${err.message}`);
        }
    }

    private async _handleExecuteShellCommand(cmdText: string) {
        // Find or create a dedicated Giskard Terminal
        let terminal = vscode.window.terminals.find(t => t.name === 'Giskard Terminal');
        if (!terminal) {
            terminal = vscode.window.createTerminal('Giskard Terminal');
        }
        terminal.show();
        terminal.sendText(cmdText);
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

        const tempDoc = await vscode.workspace.openTextDocument({
            content: proposedCode,
            language: activeDoc.languageId
        });

        await vscode.commands.executeCommand(
            'vscode.diff',
            activeUri,
            tempDoc.uri,
            `Giskard Proposed Changes: ${activeDoc.fileName}`
        );

        const selection = await vscode.window.showInformationMessage(
            `¿Deseas aplicar esta propuesta de cambios a ${activeDoc.fileName}?`,
            '✓ Accept', '✗ Reject'
        );

        if (selection === '✓ Accept') {
            const fullRange = new vscode.Range(
                activeDoc.positionAt(0),
                activeDoc.positionAt(activeText.length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(activeUri, fullRange, proposedCode);
            await vscode.workspace.applyEdit(edit);
            await activeDoc.save();
            vscode.window.showInformationMessage(`✓ Cambios aplicados exitosamente a ${activeDoc.fileName}`);

            // Also persist to giskard-assistant sandbox
            try {
                await fetchWithTimeout(`${getConnectorUrl()}/write`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                    body: JSON.stringify({ path: activeDoc.uri.fsPath, content: proposedCode })
                });
            } catch { /* Silent */ }
        }
    }

    private async _handleCompressMemory(history: string) {
        if (!this._view) return;
        try {
            const prompt = `Analiza este historial de chat y genera un resumen comprimido BCF [EN]/[ES] con las decisiones clave y contexto técnico para guardar en memoria soberana:\n\n${history}`;
            const url = `${getConnectorUrl()}/llm/chat`;
            const res = await fetchWithTimeout(url, {
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

    private async _handlePrompt(
        prompt: string,
        model: string,
        includeActiveFile: boolean,
        contextType: string
    ) {
        if (!this._view) return;

        let fullPrompt = prompt;

        // Passive workspace context injection (no auto-mount)
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const activeFolder = folders[0];
            const folderPath = activeFolder.uri.fsPath;
            const folderName = activeFolder.name;
            fullPrompt = `[Proyecto Activo VSCode: ${folderName} (${folderPath})]\n${fullPrompt}`;
        }

        if (includeActiveFile) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const docText = editor.document.getText();
                const fileName = editor.document.fileName;
                fullPrompt = `[Archivo Activo: ${fileName}]\n\`\`\`\n${docText}\n\`\`\`\n\n${fullPrompt}`;
            }
        }

        if (contextType && contextType !== 'none') {
            fullPrompt = `[Contexto Adjunto (${contextType})]\n${fullPrompt}`;
        }

        // CLI model path
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

        // Abort any previous stream
        if (this._activeAbortController) {
            this._activeAbortController.abort();
        }
        this._activeAbortController = new AbortController();

        // Check giskard-assistant backend health before streaming; fallback to direct Ollama if offline
        const connectorUrl = getConnectorUrl();
        const isOnline = await checkHealth(connectorUrl);

        if (!isOnline) {
            // Offline fallback: direct Ollama
            this._view.webview.postMessage({ type: 'offlineMode', active: true });
            await this._streamFromOllamaFallback(fullPrompt, model);
            return;
        }

        this._view.webview.postMessage({ type: 'offlineMode', active: false });

        try {
            const url = `${connectorUrl}/llm/stream`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
                body: JSON.stringify({ model, prompt: fullPrompt, inject_sandbox_context: true }),
                signal: this._activeAbortController.signal
            });

            // Handle policy rejection errors explicitly
            if (res.status === 403) {
                const errBody = await res.json().catch(() => ({}));
                this._view.webview.postMessage({
                    type: 'policyError',
                    statusCode: 403,
                    payload: errBody
                });
                return;
            }

            if (!res.ok || !res.body) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `No se pudo conectar a ${url} (HTTP ${res.status})`
                });
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
                        const dataToken = line.startsWith('data: ')
                            ? line.substring(6)
                            : line.substring(5);
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
            if (err.name !== 'AbortError') {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `Error conectando al conector soberano: ${err.message}`
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    /** Offline fallback: stream directly from local Ollama */
    private async _streamFromOllamaFallback(prompt: string, model: string) {
        if (!this._view) return;
        try {
            const res = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt, stream: true }),
                signal: this._activeAbortController?.signal
            });

            if (!res.ok || !res.body) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `Giskard-Sys offline. Ollama fallback también falló (HTTP ${res.status}).`
                });
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                try {
                    const json = JSON.parse(chunk);
                    if (json.response) {
                        this._view.webview.postMessage({ type: 'streamToken', token: json.response, model });
                    }
                    if (json.done) {
                        this._view.webview.postMessage({ type: 'streamComplete' });
                        return;
                    }
                } catch { /* Partial chunk, continue */ }
            }
            this._view.webview.postMessage({ type: 'streamComplete' });
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                this._view.webview.postMessage({
                    type: 'streamError',
                    error: `Giskard-Sys y Ollama fallback inaccesibles: ${err.message}`
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

    // ── HTML Shell (CSS & layout only, NO system prompts, NO business logic) ──

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
        .offline-badge { display: none; font-size: 9px; font-weight: bold; background: rgba(251,146,60,0.2); color: #fb923c; border: 1px solid rgba(251,146,60,0.4); padding: 1px 5px; border-radius: 3px; }
        .offline-badge.visible { display: inline-block; }
        select, button, input, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; border-radius: 4px; font-size: 11px; }
        select { flex: 1; }
        .messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; padding-right: 4px; }
        .msg { padding: 8px 12px; border-radius: 8px; font-size: 11px; word-break: break-word; line-height: 1.5; }
        .msg.user { background: var(--user-msg-bg); color: #ffffff; align-self: flex-end; white-space: pre-wrap; }
        .msg.bot { background: var(--bot-msg-bg); align-self: flex-start; width: 96%; box-sizing: border-box; }
        .msg.error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; align-self: flex-start; width: 96%; font-family: monospace; font-size: 10px; white-space: pre-wrap; }
        .msg.context-block { background: rgba(56,189,248,0.08); border: 1px dashed rgba(56,189,248,0.35); align-self: flex-start; width: 96%; font-size: 10px; }
        .model-tag { display: inline-block; font-size: 9px; font-weight: bold; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 6px; border-radius: 4px; margin-bottom: 6px; }
        details.think-box { background: var(--think-box-bg); border: 1px dashed var(--vscode-input-border); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; font-size: 10px; }
        details.think-box summary { cursor: pointer; font-weight: bold; opacity: 0.85; user-select: none; }
        details.think-box summary:hover { opacity: 1; }
        .think-content { font-style: italic; opacity: 0.85; border-left: 2px solid var(--vscode-button-background); padding: 4px 8px; margin-top: 6px; font-size: 10px; line-height: 1.5; max-height: 200px; overflow-y: auto; word-break: break-word; }
        .code-block-wrapper { position: relative; margin: 8px 0; }
        .code-actions { display: flex; gap: 4px; position: absolute; top: 6px; right: 6px; opacity: 0; transition: opacity 0.15s; }
        .code-block-wrapper:hover .code-actions { opacity: 1; }
        .code-action-btn { font-size: 9px; padding: 2px 6px; background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.1)); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-input-border); border-radius: 3px; cursor: pointer; font-weight: bold; }
        .file-link { color: #38bdf8; cursor: pointer; text-decoration: underline; font-family: monospace; font-size: 10px; }
        :root { --user-font-color: #f8fafc; --user-header-color: #ffffff; --user-header-border: rgba(255,255,255,0.15); --user-msg-bg: var(--vscode-button-background); --bot-msg-bg: var(--vscode-editor-inactiveSelectionBackground); --think-box-bg: rgba(0,0,0,0.25); }
        .answer-content { font-size: 11px; line-height: 1.6; word-break: break-word; margin-top: 4px; color: var(--user-font-color); }
        .answer-content p { margin: 6px 0; }
        .answer-content h1, .answer-content h2, .answer-content h3, .answer-content h4 { color: var(--user-header-color); font-weight: bold; margin: 12px 0 6px 0; border-bottom: 1px solid var(--user-header-border); padding-bottom: 3px; }
        .answer-content h1 { font-size: 14px; } .answer-content h2 { font-size: 13px; } .answer-content h3 { font-size: 12px; }
        .answer-content pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 10px; overflow: auto; margin: 0; font-family: var(--vscode-editor-font-family, monospace); white-space: pre; word-break: normal; }
        .answer-content code { background: rgba(255,255,255,0.08); color: #f8fafc; padding: 2px 5px; border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px; }
        .answer-content pre code { background: transparent; padding: 0; color: inherit; }
        .answer-content table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; }
        .answer-content th, .answer-content td { border: 1px solid var(--vscode-input-border); padding: 6px 10px; text-align: left; }
        .answer-content th { background: rgba(255,255,255,0.06); color: var(--user-header-color); font-weight: bold; }
        .answer-content tr:nth-child(even) { background: rgba(255,255,255,0.03); }
        .answer-content ul, .answer-content ol { margin: 6px 0; padding-left: 20px; }
        .answer-content li { margin: 3px 0; }
        .answer-content blockquote { border-left: 3px solid var(--user-header-color); margin: 8px 0; padding-left: 10px; opacity: 0.9; font-style: italic; }
        .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-input-border); margin-bottom: 8px; padding-bottom: 4px; }
        .tab-btn { flex: 1; background: transparent; border: none; padding: 6px 4px; font-size: 10px; font-weight: bold; cursor: pointer; opacity: 0.6; border-radius: 4px; color: var(--vscode-foreground); }
        .tab-btn.active { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .tab-content { display: none; flex-direction: column; gap: 8px; }
        .tab-content.active { display: flex; }
        .filter-tag { font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }
        .filter-tag.ollama { background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); }
        .cmd-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; background: rgba(255,255,255,0.08); border: 1px solid var(--vscode-input-border); padding: 1px 5px; border-radius: 4px; }
        .cmd-badge button { background: transparent; border: none; color: #f87171; font-weight: bold; cursor: pointer; padding: 0 2px; }
        .input-box { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; background: transparent; position: relative; }
        textarea { resize: none; width: 100%; box-sizing: border-box; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
        .menu-dropdown { position: absolute; bottom: 35px; left: 0; background: var(--vscode-menu-background); border: 1px solid var(--vscode-menu-border); border-radius: 6px; display: none; flex-direction: column; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.5); width: 220px; }
        .menu-item { padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-menu-foreground); }
        .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        .btn-add, .btn-compress, .btn-clear { background: transparent; border: 1px solid var(--vscode-input-border); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 10px; }
        .btn-clear { color: #f87171; border-color: rgba(248,113,113,0.4); }
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
                    <option value="">— Selecciona un modelo —</option>
                </optgroup>
            </select>
            <button class="btn-clear" id="clear-ctx-btn" title="Limpiar historial y resetear contexto de sesión">🗑️</button>
        </div>

        <div class="status-bar">
            <span id="token-counter">Tokens: 0</span>
            <span class="offline-badge" id="offline-badge">📴 OFFLINE MODE</span>
            <button class="btn-compress" id="compress-btn" title="Guardar resumen en memoria soberana y limpiar ventana">Comprimir Memoria</button>
        </div>

        <!-- Messages area — starts empty, no auto-welcome message -->
        <div class="messages" id="messages"></div>

        <div class="input-box">
            <div class="menu-dropdown" id="context-menu">
                <div class="menu-item" id="ctx-graphify">Graphify: Grafo Memoria</div>
                <div class="menu-item" id="ctx-mentions">@ Mentions (@file, @git)</div>
            </div>
            <textarea id="prompt" rows="2" placeholder="Pregunta a la IA… (Enter para enviar, Shift+Enter para salto de línea)"></textarea>
            <div class="toolbar">
                <button class="btn-add" id="add-ctx-btn">+ Context</button>
                <label><input type="checkbox" id="inc-file" checked> Archivo activo</label>
                <button id="send-btn" class="btn-send">Enviar ⚡</button>
                <button id="stop-btn" class="btn-send" style="display: none; background: #ef4444; border-color: #ef4444; color: #ffffff;">🛑 Detener</button>
            </div>
        </div>
    </div>

    <!-- Modal Ajustes -->
    <div class="modal" id="settings-modal">
        <div class="modal-card">
            <h4>⚙️ Ajustes de Giskard Assistant</h4>
            <div class="tab-nav">
                <button type="button" class="tab-btn active" id="tab-btn-local">Local & Visibilidad</button>
                <button type="button" class="tab-btn" id="tab-btn-remote">API Remota & Keys</button>
                <button type="button" class="tab-btn" id="tab-btn-palette">🎨 Paleta</button>
            </div>

            <!-- Tab 1: Local -->
            <div class="tab-content active" id="tab-content-local">
                <div class="field">
                    <label>URL Servidor Giskard-Sys:</label>
                    <input type="text" id="cfg-connector-url" value="http://localhost:3500">
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
                    <div id="model-filter-list" style="max-height: 70px; overflow-y: auto; border: 1px solid var(--vscode-input-border); padding: 4px; border-radius: 4px; background: rgba(0,0,0,0.15);">Carga modelos con el botón de refresco →</div>
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

            <!-- Tab 3: Color Palette -->
            <div class="tab-content" id="tab-content-palette">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 10px; font-weight: bold;">⚡ Presets de 1 Clic:</label>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
                        <button type="button" id="preset-white" style="font-size: 9px; padding: 4px 6px; background: #1e293b; color: #ffffff; border: 1px solid #475569; border-radius: 4px; cursor: pointer;">⚪ Blanco Minimal</button>
                        <button type="button" id="preset-cyan" style="font-size: 9px; padding: 4px 6px; background: #0f172a; color: #38bdf8; border: 1px solid #38bdf8; border-radius: 4px; cursor: pointer;">🔵 Neón Cyan</button>
                        <button type="button" id="preset-emerald" style="font-size: 9px; padding: 4px 6px; background: #064e3b; color: #34d399; border: 1px solid #34d399; border-radius: 4px; cursor: pointer;">🟢 Matrix Emerald</button>
                        <button type="button" id="preset-purple" style="font-size: 9px; padding: 4px 6px; background: #3b0764; color: #c084fc; border: 1px solid #c084fc; border-radius: 4px; cursor: pointer;">🟣 Cyberpunk</button>
                    </div>
                    <div class="field"><label>Color de Texto Principal:</label><input type="color" id="palette-text-color" value="#f8fafc" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>Color de Encabezados:</label><input type="color" id="palette-header-color" value="#ffffff" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>Color de Acento:</label><input type="color" id="palette-accent-color" value="#38bdf8" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>💬 Burbuja Usuario (Fondo):</label><input type="color" id="palette-user-bg" value="#0284c7" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>🤖 Burbuja IA (Fondo):</label><input type="color" id="palette-bot-bg" value="#1e293b" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>💡 Caja de Razonamiento:</label><input type="color" id="palette-think-bg" value="#0f172a" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
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
