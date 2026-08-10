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
import { checkHealth, fetchWorkspaceList, fetchWaveCurrent, setConnectionStore, fetchLlmModels } from './core/api';
import { ConnectionStore } from './core/connectionStore';

import { GiskardStatusBar } from './cells/statusBar';
import { GiskardInlineCompletionProvider } from './cells/inlineCompletionProvider';
import { GiskardLocalModelsTreeProvider, GiskardRemoteConnsTreeProvider, GiskardThemePaletteTreeProvider, GiskardMcpServersTreeProvider, GiskardFileExclusionsTreeProvider } from './cells/treeViewProvider';
import { handleDiscoverMcpTools } from './cells/mcpHandlers';
import { GiskardModelSettingsWebviewProvider } from './cells/modelSettingsWebview';

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
    context.subscriptions.push(statusBar);

    // 0.3 Inline Code Completion Provider (Ghost Text / FIM)
    const inlineProvider = new GiskardInlineCompletionProvider(store);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
    );

    // 1. Célula Webview Sidebar Chat
    const provider = new GiskardChatWebviewProvider(context.extensionUri, store);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('giskard.chatView', provider)
    );

    // 2. Célula de Comandos Sandbox
    registerSandboxCommands(context);

    // 3. Command Registrations & Server Management
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-assistant.newChatContext', async () => {
            await vscode.commands.executeCommand('giskard.chatView.focus');
            provider.postMessage({ type: 'clearMessages' });
            vscode.window.showInformationMessage('💬✨ New chat context initialized.');
        }),
        vscode.commands.registerCommand('giskard-assistant.addModelOrConnection', async () => {
            const action = await vscode.window.showQuickPick([
                { label: '🦙 Pull Local Ollama Model', detail: 'Download/Pull a model into Ollama (e.g. qwen2.5-coder, deepseek-r1:8b, llama3.2)', id: 'ollama-pull' },
                { label: '🌐 Add Remote AI Provider', detail: 'Configure DeepSeek, NVIDIA NIM, OpenAI, Anthropic, Gemini API Key & URL', id: 'remote-conn' },
                { label: '🦀 Connect to Giskard-Sys Backend', detail: 'Connect to Rust Axum local backend (default port 3500)', id: 'giskard-sys' }
            ], { placeHolder: 'Select Action to Add AI Model or Provider' });

            if (!action) return;

            if (action.id === 'ollama-pull') {
                const modelName = await vscode.window.showInputBox({
                    prompt: 'Enter Ollama Model Name to Pull',
                    placeHolder: 'e.g. qwen2.5-coder:7b, deepseek-r1:8b, llama3.2:3b, mistral'
                });
                if (!modelName || !modelName.trim()) return;

                const targetModel = modelName.trim();
                vscode.window.showInformationMessage(`🦙 Pulling Ollama model '${targetModel}' in background...`);

                const terminal = vscode.window.createTerminal(`Ollama Pull ${targetModel}`);
                terminal.show();
                terminal.sendText(`ollama pull ${targetModel}`);

                await store.toggleModelEnabled(targetModel);
                localModelsTree.refresh();
                await provider.refreshState();
            } else if (action.id === 'remote-conn') {
                await vscode.commands.executeCommand('giskard-assistant.addRemoteConnectionTree');
            } else if (action.id === 'giskard-sys') {
                const url = await vscode.window.showInputBox({
                    prompt: 'Giskard-Sys Axum Server URL',
                    value: 'http://localhost:3500'
                });
                if (!url) return;
                await store.addConnection('Giskard-Sys Backend', 'local', url, 'giskard-sys');
                localModelsTree.refresh();
                remoteConnsTree.refresh();
                await provider.refreshState();
                vscode.window.showInformationMessage(`✓ Giskard-Sys connection saved.`);
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.removeRemoteConnectionTree', async (arg: any) => {
            const connId = typeof arg === 'number' ? arg : (typeof arg === 'string' ? Number(arg) : (arg?.rawData?.id || arg?.id));
            if (!connId) return;

            const conn = store.getAll().find(c => Number(c.id) === Number(connId));
            const nameStr = conn ? conn.name : 'AI Connection';

            await store.removeConnection(Number(connId));
            remoteConnsTree.refresh();
            localModelsTree.refresh();
            await provider.refreshState();
            vscode.window.showInformationMessage(`✓ AI Connection "${nameStr}" deleted.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.addRemoteConnectionTree', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'AI Connection Name', placeHolder: 'e.g. DeepSeek API / Ollama / NVIDIA NIM' });
            if (!name) return;
            const type = await vscode.window.showQuickPick(['remote', 'local'], { placeHolder: 'Connection Type' });
            if (!type) return;
            const url = await vscode.window.showInputBox({ prompt: 'AI Service Base URL', placeHolder: 'e.g. https://api.deepseek.com or http://localhost:11434' });
            if (!url) return;
            const tag = await vscode.window.showInputBox({ prompt: 'Identifier Tag / Category', placeHolder: 'e.g. deepseek, nvidia, ollama' });

            await store.addConnection(name, type as any, url, tag || 'ai');
            remoteConnsTree.refresh();
            provider.postMessage({ type: 'connectionsLoaded' });
            vscode.window.showInformationMessage(`✓ AI Connection "${name}" added.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.testMcpServerTree', async (arg: any) => {
            const serverId = typeof arg === 'number' ? arg : (typeof arg === 'string' ? Number(arg) : (arg?.rawData?.id || arg?.id));
            if (!serverId) return;

            const server = store.getMcpServers().find(s => s.id === Number(serverId));
            if (!server) return;

            vscode.window.showInformationMessage(`🧪 Testing connection & discovering tools for '${server.name}'...`);
            await handleDiscoverMcpTools(provider.view, store, Number(serverId));
            mcpServersTree.refresh();
        }),
        vscode.commands.registerCommand('giskard-assistant.addMcpServerTree', async () => {
            const name = await vscode.window.showInputBox({ prompt: 'MCP Server Name', placeHolder: 'e.g. filesystem' });
            if (!name) return;
            const type = await vscode.window.showQuickPick(['stdio', 'sse'], { placeHolder: 'MCP Server Type' });
            if (!type) return;
            const commandOrUrl = await vscode.window.showInputBox({ prompt: 'MCP Server Command or URL', placeHolder: 'e.g. npx -y @modelcontextprotocol/server-filesystem .' });
            if (!commandOrUrl) return;

            await store.addMcpServer(name, type as any, commandOrUrl);
            mcpServersTree.refresh();
            provider.postMessage({ type: 'mcpServersLoaded' });
            vscode.window.showInformationMessage(`✓ MCP Server "${name}" added.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.addExclusionPatternTree', async () => {
            const pattern = await vscode.window.showInputBox({ prompt: 'Exclusion Pattern or Gitignore', placeHolder: 'e.g. *.log or build/' });
            if (!pattern) return;

            const current = store.getExclusionPatterns();
            if (!current.includes(pattern)) {
                current.push(pattern);
                await store.saveExclusionPatterns(current);
                fileExclusionsTree.refresh();
                provider.postMessage({ type: 'exclusionPatternsLoaded', patterns: current });
                vscode.window.showInformationMessage(`✓ Pattern "${pattern}" added to exclusions.`);
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.removeMcpServerTree', async (arg: any) => {
            const serverId = typeof arg === 'string' || typeof arg === 'number' ? arg : (arg?.rawData?.id || arg?.id);
            if (!serverId) return;
            await store.removeMcpServer(Number(serverId));
            mcpServersTree.refresh();
            provider.postMessage({ type: 'mcpServersLoaded' });
            vscode.window.showInformationMessage('✓ MCP Server removed.');
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleMcpServerTree', async (arg: any) => {
            const serverId = typeof arg === 'number' ? arg : (typeof arg === 'string' ? Number(arg) : (arg?.rawData?.id || arg?.id));
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
        }),
        vscode.commands.registerCommand('giskard-assistant.removeExclusionPatternTree', async (arg: any) => {
            const pattern = typeof arg === 'string' ? arg : (arg?.rawData || arg?.label || '').replace(/^🚫\s*/, '');
            if (!pattern) return;
            let current = store.getExclusionPatterns();
            current = current.filter(p => p !== pattern);
            await store.saveExclusionPatterns(current);
            fileExclusionsTree.refresh();
            provider.postMessage({ type: 'exclusionPatternsLoaded', patterns: current });
            vscode.window.showInformationMessage(`✓ Pattern "${pattern}" removed from exclusions.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.selectThemeTree', async (themeLabel: string) => {
            if (!themeLabel) return;
            provider.postMessage({ type: 'selectTheme', theme: themeLabel });
            vscode.window.showInformationMessage(`🎨 Visual theme applied: ${themeLabel}`);
        }),
        vscode.commands.registerCommand('giskard-assistant.removeLocalModelTree', async (arg: any) => {
            let modelName = '';
            if (typeof arg === 'string') {
                modelName = arg;
            } else if (arg && typeof arg === 'object') {
                modelName = typeof arg.label === 'string' ? arg.label : (typeof arg.rawData === 'string' ? arg.rawData : '');
            }
            if (!modelName) return;

            const choice = await vscode.window.showWarningMessage(
                `Remove or unload model '${modelName}'?`,
                'Remove from Active List',
                'Delete Ollama Model (ollama rm)'
            );
            if (!choice) return;

            if (choice === 'Delete Ollama Model (ollama rm)') {
                const terminal = vscode.window.createTerminal(`Ollama Rm ${modelName}`);
                terminal.sendText(`ollama rm ${modelName}`);
            }

            await store.removeEnabledModel(modelName);
            localModelsTree.refresh();
            await provider.refreshState();
            vscode.window.showInformationMessage(`✓ Model '${modelName}' removed.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleModelForChat', async (arg: any) => {
            let modelName = '';
            if (typeof arg === 'string') {
                modelName = arg;
            } else if (arg && typeof arg === 'object') {
                modelName = typeof arg.label === 'string' ? arg.label : (typeof arg.rawData === 'string' ? arg.rawData : '');
            }
            if (!modelName) return;

            const isNowEnabled = await store.toggleModelEnabled(modelName);
            const enabledList = store.getEnabledModels();

            provider.postMessage({ type: 'setEnabledModels', enabledModels: enabledList });
            await provider.refreshState();
            localModelsTree.refresh();

            const statusStr = isNowEnabled ? 'enabled 🟢 for Chat' : 'disabled ⚪ from Chat';
            vscode.window.showInformationMessage(`✓ Model '${modelName}' ${statusStr}.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.manageApiKey', async () => {
            const active = store.getActive();
            if (!active) {
                vscode.window.showWarningMessage('No active connection profile selected.');
                return;
            }
            const apiKey = await vscode.window.showInputBox({
                prompt: `Enter / Update API Key for ${active.name} (${active.tag.toUpperCase()})`,
                password: true
            });
            if (apiKey !== undefined) {
                await store.saveApiKey(active.id, apiKey);
                vscode.window.showInformationMessage(`🔑 API Key updated for ${active.name}!`);
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.filterCapabilities', async () => {
            const pick = await vscode.window.showQuickPick([
                { label: '🧠 Deep Reasoning / Thinking', key: 'reasoning' },
                { label: '🛠️ Tools & Coder', key: 'tools' },
                { label: '👁️ Multimodal Vision', key: 'vision' },
                { label: '🧩 Vectors & Embeddings', key: 'embedding' },
                { label: '✨ All Models (No Filter)', key: 'all' }
            ], { placeHolder: 'Select capability to filter models tree' });
            if (pick) {
                localModelsTree.setCapabilityFilter(pick.key);
                vscode.window.showInformationMessage(`✓ Capability filter active: ${pick.label}`);
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.searchModels', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search models by name or term (leave empty to clear)',
                placeHolder: 'e.g. qwen, r1, llama, gpt-4o'
            });
            if (query !== undefined) {
                localModelsTree.setSearchQuery(query);
                if (query.trim()) {
                    vscode.window.showInformationMessage(`🔍 Tree filtered by: "${query}"`);
                } else {
                    vscode.window.showInformationMessage(`🔍 Search filter cleared.`);
                }
            }
        }),
        vscode.commands.registerCommand('giskard-assistant.openSettingsModal', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.giskard-explorer');
        }),
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
            vscode.window.showInformationMessage('✓ Estado del conector sincronizado.');
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
