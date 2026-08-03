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
import { checkHealth, fetchWorkspaceList, fetchWaveCurrent } from './core/api';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Giskard Assistant v4.0 activada (GPL-3.0)');

    // 1. Célula Webview Sidebar Chat
    const provider = new GiskardChatWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('giskard.chatView', provider),
        vscode.window.registerWebviewViewProvider('giskard.chatViewExplorer', provider)
    );

    // 2. Célula de Comandos Sandbox
    registerSandboxCommands(context);

    // 3. Comandos de apertura de Chat Sidebar
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-sys.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.giskard-sidebar');
        }),
        vscode.commands.registerCommand('giskard-sys.openChatRight', () => {
            vscode.commands.executeCommand('workbench.action.focusSecondarySideBar');
        })
    );

    // 4. Comando de Sincronización de Estado
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-sys.syncState', async () => {
            await provider.refreshState();
            vscode.window.showInformationMessage('✓ Estado del conector soberano sincronizado en Giskard Assistant.');
        })
    );

    // 5. Ctrl+L — Adjuntar código seleccionado al chat
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-sys.attachCodeToChat', async () => {
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
