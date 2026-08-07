/**
 * Giskard-Sys VSCode Extension — Entry Point
 * Copyright (C) 2025  Giskard Project
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import * as vscode from 'vscode';
import { GiskardChatWebviewProvider } from './cells/chatWebview';
import { registerSandboxCommands } from './cells/sandboxCommands';
import { checkHealth, fetchWorkspaceList, fetchWaveCurrent, setConnectionStore } from './core/api';
import { ConnectionStore } from './core/connectionStore';

import { GiskardStatusBar } from './cells/statusBar';
import { GiskardInlineCompletionProvider } from './cells/inlineCompletionProvider';
import { GiskardLocalModelsTreeProvider, GiskardRemoteConnsTreeProvider, GiskardThemePaletteTreeProvider } from './cells/treeViewProvider';

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Giskard Assistant v4.2.0 activada (GPL-3.0)');

    // 0. Initialize SQLite Connection Store
    const store = new ConnectionStore(context);
    try {
        await store.init();
        setConnectionStore(store);
    } catch (err: any) {
        vscode.window.showWarningMessage(`Giskard: Connection store init failed: ${err.message}`);
    }
    context.subscriptions.push({ dispose: () => store.dispose() });

    // 0.1 Status Bar Heartbeat Item
    const statusBar = new GiskardStatusBar(store);
    context.subscriptions.push(statusBar);

    // 0.2 Inline Code Completion Provider (Ghost Text / FIM)
    const inlineProvider = new GiskardInlineCompletionProvider(store);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
    );

    // 1. Célula Webview Sidebar Chat
    const provider = new GiskardChatWebviewProvider(context.extensionUri, store);
    const localModelsTree = new GiskardLocalModelsTreeProvider(store);
    const remoteConnsTree = new GiskardRemoteConnsTreeProvider(store);
    const themePaletteTree = new GiskardThemePaletteTreeProvider();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('giskard.chatView', provider),
        vscode.window.registerTreeDataProvider('giskard-local-models', localModelsTree),
        vscode.window.registerTreeDataProvider('giskard-remote-connections', remoteConnsTree),
        vscode.window.registerTreeDataProvider('giskard-theme-palette', themePaletteTree)
    );

    // 2. Célula de Comandos Sandbox
    registerSandboxCommands(context);

    // 3. Comandos de apertura & Gestión de Servidores desde el TreeView
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-assistant.addServer', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'Nombre de la Conexión (ej. Mi Servidor Ollama, NVIDIA NIM, DeepSeek)', placeHolder: 'NVIDIA NIM Prod' });
            if (!name) return;
            const url = await vscode.window.showInputBox({ prompt: 'URL Base del Endpoint API (ej. https://integrate.api.nvidia.com/v1 o http://localhost:11434)', placeHolder: 'https://integrate.api.nvidia.com/v1' });
            if (!url) return;
            const tag = await vscode.window.showInputBox({ prompt: 'Tag / Proveedor (nvidia, deepseek, ollama, openai, gemini, qwen)', placeHolder: 'nvidia' });
            if (!tag) return;
            const apiKey = await vscode.window.showInputBox({ prompt: 'API Key (Opcional para local)', password: true });

            await store.addConnection(name, 'remote', url, tag.toLowerCase(), apiKey || undefined);
            localModelsTree.refresh();
            remoteConnsTree.refresh();
            vscode.window.showInformationMessage(`✓ Servidor '${name}' agregado y activado con éxito en Giskard!`);
        }),
        vscode.commands.registerCommand('giskard-assistant.refreshTree', () => {
            localModelsTree.refresh();
            remoteConnsTree.refresh();
            vscode.window.showInformationMessage('🔄 Árboles de Servidores y Modelos actualizados.');
        }),
        vscode.commands.registerCommand('giskard-assistant.openChat', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            await vscode.commands.executeCommand('workbench.action.focusSecondarySideBar').then(undefined, () => {});
        }),
        vscode.commands.registerCommand('giskard-assistant.openChatRight', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            await vscode.commands.executeCommand('workbench.action.focusSecondarySideBar').then(undefined, () => {});
        })
    );

    // 4. Comando de Sincronización de Estado
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-assistant.syncState', async () => {
            await provider.refreshState();
            vscode.window.showInformationMessage('✓ Estado del conector soberano sincronizado.');
        })
    );

    // 5. Ctrl+L — Adjuntar código seleccionado al chat
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-assistant.attachCodeToChat', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Giskard: Abre un archivo de código para adjuntar al chat.');
                return;
            }

            const selection = editor.selection;
            const document = editor.document;

            // Capture selected text or full cursor block (current line if no selection)
            const selectedText = document.getText(
                selection.isEmpty
                    ? document.lineAt(selection.active.line).range
                    : selection
            );

            const relativePath = vscode.workspace.asRelativePath(document.uri);
            const startLine = (selection.isEmpty ? selection.active.line : selection.start.line) + 1;
            const endLine = (selection.isEmpty ? selection.active.line : selection.end.line) + 1;
            const lang = document.languageId;

            const contextBlock = {
                relativePath,
                startLine,
                endLine,
                code: selectedText,
                lang
            };

            // Open / focus the Giskard chat panel
            await vscode.commands.executeCommand('workbench.view.extension.giskard-sidebar');

            // Inject snippet into Webview with pre-fill prompt
            provider.injectCodeContext(contextBlock);
        })
    );

    // 6. Verificación Pasiva en Activación (sin acciones automáticas)
    _passiveStartupCheck();

    async function _passiveStartupCheck() {
        const isOnline = await checkHealth();
        if (isOnline) {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
                await fetchWorkspaceList();
                await fetchWaveCurrent(folders[0].uri.fsPath);
            }
            // Health OK — extension is ready, no auto-chat actions
        }
        // If offline: silently wait for user to interact
    }
}

export function deactivate() {}
