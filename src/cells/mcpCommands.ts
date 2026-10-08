/**
 * Giskard Assistant VSCode Extension — Célula: Comandos MCP (TreeView)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de extension.ts. Comandos: testMcpServerTree, addMcpServerTree,
 * removeMcpServerTree, toggleMcpServerTree, toggleMcpToolTree.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { GiskardChatWebviewProvider } from './chatWebview';
import { GiskardMcpServersTreeProvider } from './treeViewProvider';
import { handleDiscoverMcpTools } from './mcpHandlers';
import { parseItemId } from './commandUtils';

export interface McpCommandsContext {
    store: ConnectionStore;
    mcpServersTree: GiskardMcpServersTreeProvider;
    provider: GiskardChatWebviewProvider;
}

export function registerMcpCommands(ctx: McpCommandsContext): vscode.Disposable[] {
    const { store, mcpServersTree, provider } = ctx;

    return [
        vscode.commands.registerCommand('giskard-assistant.testMcpServerTree', async (arg: any) => {
            const serverId = parseItemId(arg);
            if (!serverId) return;

            const server = store.getMcpServers().find((s) => s.id === Number(serverId));
            if (!server) return;

            vscode.window.showInformationMessage(
                `🧪 Testing connection & discovering tools for '${server.name}'...`
            );
            await handleDiscoverMcpTools(provider.view, store, Number(serverId));
            mcpServersTree.refresh();
        }),
        vscode.commands.registerCommand('giskard-assistant.addMcpServerTree', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'MCP Server Name',
                placeHolder: 'e.g. filesystem'
            });
            if (!name) return;
            const type = await vscode.window.showQuickPick(['stdio', 'sse'], {
                placeHolder: 'MCP Server Type'
            });
            if (!type) return;
            const commandOrUrl = await vscode.window.showInputBox({
                prompt: 'MCP Server Command or URL',
                placeHolder: 'e.g. npx -y @modelcontextprotocol/server-filesystem .'
            });
            if (!commandOrUrl) return;

            await store.addMcpServer(name, type as any, commandOrUrl);
            mcpServersTree.refresh();
            provider.postMessage({ type: 'mcpServersLoaded' });
            vscode.window.showInformationMessage(`✓ MCP Server "${name}" added.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.removeMcpServerTree', async (arg: any) => {
            const serverId = parseItemId(arg);
            if (!serverId) return;
            await store.removeMcpServer(Number(serverId));
            mcpServersTree.refresh();
            provider.postMessage({ type: 'mcpServersLoaded' });
            vscode.window.showInformationMessage('✓ MCP Server removed.');
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleMcpServerTree', async (arg: any) => {
            const serverId = parseItemId(arg);
            if (!serverId) return;
            const newState = await store.toggleMcpServer(Number(serverId));
            mcpServersTree.refresh();
            const statusStr = newState ? 'enabled 🟢' : 'disabled ⚪';
            vscode.window.showInformationMessage(`✓ MCP Server ${statusStr}.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleMcpToolTree', async (arg: any) => {
            const serverId = arg?.serverId || arg?.rawData?.serverId;
            const toolId = arg?.toolId || arg?.rawData?.toolId;
            if (!serverId || !toolId) return;

            const newState = await store.toggleMcpTool(Number(serverId), String(toolId));
            mcpServersTree.refresh();
            provider.postMessage({ type: 'mcpServersLoaded' });
            const statusStr = newState ? 'enabled 🟢' : 'disabled ⚪';
            vscode.window.showInformationMessage(`✓ MCP Tool '${toolId}' ${statusStr}.`);
        })
    ];
}
