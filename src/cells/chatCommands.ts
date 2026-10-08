/**
 * Giskard Assistant VSCode Extension — Célula: Comandos de Chat (apertura, sync, código adjunto)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de extension.ts. Comandos: revertLastAiChange, openChat,
 * openChatRight, openChatTab, syncState, attachCodeToChat.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { checkHealth, fetchWaveCurrent, fetchWorkspaceList } from '../core/api';
import { createNewChatPanelTab, GiskardChatWebviewProvider } from './chatWebview';
import { revertLastAiEdit } from './diffHandlers';

export interface ChatCommandsContext {
    context: vscode.ExtensionContext;
    store: ConnectionStore;
    provider: GiskardChatWebviewProvider;
}

export function registerChatCommands(ctx: ChatCommandsContext): vscode.Disposable[] {
    const { context, store, provider } = ctx;

    return [
        // Fase 3c: Revert last AI edit (one-click undo of applied changes)
        vscode.commands.registerCommand('giskard-assistant.revertLastAiChange', () => {
            if (!revertLastAiEdit()) {
                vscode.window.showInformationMessage('No hay cambios de IA recientes para revertir.');
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.newChatContext', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            provider.postMessage({ type: 'clearMessages' });
            vscode.window.showInformationMessage('💬✨ New chat context initialized.');
        }),
        vscode.commands.registerCommand('giskard-assistant.openChat', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            await vscode.commands
                .executeCommand('workbench.action.focusSecondarySideBar')
                .then(undefined, () => {});
        }),
        vscode.commands.registerCommand('giskard-assistant.openChatRight', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            await vscode.commands
                .executeCommand('workbench.action.focusSecondarySideBar')
                .then(undefined, () => {});
        }),
        vscode.commands.registerCommand('giskard-assistant.openChatTab', () => {
            createNewChatPanelTab(context, store);
        }),
        vscode.commands.registerCommand('giskard-assistant.syncState', async () => {
            await provider.refreshState();
            vscode.window.showInformationMessage('✓ Estado del conector sincronizado.');
        }),
        // Ctrl+L — Adjuntar código seleccionado al chat
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
                selection.isEmpty ? document.lineAt(selection.active.line).range : selection
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
    ];
}

/** Verificación pasiva al activar (sin acciones automáticas). Extraída de extension.ts. */
export async function passiveStartupCheck(): Promise<void> {
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
