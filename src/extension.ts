/**
 * Giskard-Sys VSCode Extension — Entry Point (composition root)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Solo construye las dependencias y las reparte a las células de comandos.
 * La lógica vive en src/cells/ (connectionCommands, mcpCommands, treeCommands,
 * chatCommands, sandboxCommands).
 */

import * as vscode from 'vscode';
import { GiskardChatWebviewProvider } from './cells/chatWebview';
import { registerSandboxCommands } from './cells/sandboxCommands';
import { setConnectionStore } from './core/api';
import { ConnectionStore } from './core/connectionStore';

import { GiskardStatusBar, registerStatusBarInstance } from './cells/statusBar';
import { GiskardInlineCompletionProvider } from './cells/inlineCompletionProvider';
import {
    GiskardLocalModelsTreeProvider,
    GiskardRemoteConnsTreeProvider,
    GiskardThemePaletteTreeProvider,
    GiskardMcpServersTreeProvider,
    GiskardFileExclusionsTreeProvider
} from './cells/treeViewProvider';
import { GiskardModelSettingsWebviewProvider } from './cells/modelSettingsWebview';
import { registerConnectionCommands } from './cells/connectionCommands';
import { registerMcpCommands } from './cells/mcpCommands';
import { registerTreeCommands } from './cells/treeCommands';
import { registerChatCommands, passiveStartupCheck } from './cells/chatCommands';

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Giskard Assistant v4.2.0 activada (GPL-3.0)');

    const store = new ConnectionStore(context);
    const localModelsTree = new GiskardLocalModelsTreeProvider(store);
    const remoteConnsTree = new GiskardRemoteConnsTreeProvider(store);
    const themePaletteTree = new GiskardThemePaletteTreeProvider();
    const mcpServersTree = new GiskardMcpServersTreeProvider(store);
    const fileExclusionsTree = new GiskardFileExclusionsTreeProvider(store);
    const modelSettingsProvider = new GiskardModelSettingsWebviewProvider(context.extensionUri, store);

    // 0. Register Tree View Providers synchronously so VS Code finds them immediately
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('giskard-local-models', localModelsTree),
        vscode.window.registerTreeDataProvider('giskard-remote-connections', remoteConnsTree),
        vscode.window.registerTreeDataProvider('giskard-theme-palette', themePaletteTree),
        vscode.window.registerTreeDataProvider('giskard-mcp-servers', mcpServersTree),
        vscode.window.registerTreeDataProvider('giskard-file-exclusions', fileExclusionsTree),
        vscode.window.registerWebviewViewProvider('giskard-model-settings', modelSettingsProvider)
    );

    // 0.1 Initialize SQLite Connection Store
    try {
        await store.init();
        setConnectionStore(store);
    } catch (err: any) {
        vscode.window.showWarningMessage(`Giskard: Connection store init failed: ${err.message}`);
    }
    context.subscriptions.push({ dispose: () => store.dispose() });

    // 0.2 Status Bar Heartbeat Item
    const statusBar = new GiskardStatusBar(store);
    registerStatusBarInstance(statusBar);
    context.subscriptions.push(statusBar);

    // 0.3 Inline Code Completion Provider (Ghost Text / FIM)
    const inlineProvider = new GiskardInlineCompletionProvider(store);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
    );

    // 1. Célula Webview Sidebar Chat
    const provider = new GiskardChatWebviewProvider(context.extensionUri, store, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('giskard.chatView', provider));

    // 1.1 Célula de Comandos Sandbox
    registerSandboxCommands(context);

    // 2. Células de comandos (conexiones, MCP, árboles, chat)
    context.subscriptions.push(
        ...registerConnectionCommands({
            store,
            localModelsTree,
            remoteConnsTree,
            modelSettingsProvider,
            provider
        }),
        ...registerMcpCommands({ store, mcpServersTree, provider }),
        ...registerTreeCommands({
            store,
            localModelsTree,
            remoteConnsTree,
            fileExclusionsTree,
            modelSettingsProvider,
            provider
        }),
        ...registerChatCommands({ context, store, provider })
    );

    // 3. Verificación Pasiva en Activación (sin acciones automáticas)
    await passiveStartupCheck();
}

export function deactivate() {}
