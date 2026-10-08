/**
 * Giskard Assistant VSCode Extension — Célula: Comandos de Conexiones (TreeView + quickpick)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de extension.ts. Comandos: addModelOrConnection, addRemoteConnectionTree,
 * toggleConnectionActive, removeRemoteConnectionTree, manageApiKey, addServer.
 * Funciones puras de contexto explícito — cero `this`.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { PROVIDER_CATALOG, CUSTOM_PROVIDER_ENTRY } from '../core/providerCatalog';
import { GiskardChatWebviewProvider } from './chatWebview';
import { GiskardModelSettingsWebviewProvider } from './modelSettingsWebview';
import {
    GiskardLocalModelsTreeProvider,
    GiskardRemoteConnsTreeProvider
} from './treeViewProvider';
import { parseItemId } from './commandUtils';

export interface ConnectionCommandsContext {
    store: ConnectionStore;
    localModelsTree: GiskardLocalModelsTreeProvider;
    remoteConnsTree: GiskardRemoteConnsTreeProvider;
    modelSettingsProvider: GiskardModelSettingsWebviewProvider;
    provider: GiskardChatWebviewProvider;
}

export function registerConnectionCommands(ctx: ConnectionCommandsContext): vscode.Disposable[] {
    const { store, localModelsTree, remoteConnsTree, modelSettingsProvider, provider } = ctx;

    return [
        vscode.commands.registerCommand('giskard-assistant.addModelOrConnection', async () => {
            const action = await vscode.window.showQuickPick(
                [
                    {
                        label: '🦙 Pull Local Ollama Model',
                        detail: 'Download/Pull a model into Ollama (e.g. qwen2.5-coder, deepseek-r1:8b, llama3.2)',
                        id: 'ollama-pull'
                    },
                    {
                        label: '🌐 Add Remote AI Provider',
                        detail: 'Configure DeepSeek, NVIDIA NIM, OpenAI, Anthropic, Gemini API Key & URL',
                        id: 'remote-conn'
                    },
                    {
                        label: '🦀 Connect to Giskard-Sys Backend',
                        detail: 'Connect to Rust Axum local backend (default port 3500)',
                        id: 'giskard-sys'
                    }
                ],
                { placeHolder: 'Select Action to Add AI Model or Provider' }
            );

            if (!action) return;

            if (action.id === 'ollama-pull') {
                const modelName = await vscode.window.showInputBox({
                    prompt: 'Enter Ollama Model Name to Pull',
                    placeHolder: 'e.g. qwen2.5-coder:7b, deepseek-r1:8b, llama3.2:3b, mistral'
                });
                if (!modelName || !modelName.trim()) return;

                const targetModel = modelName.trim();
                vscode.window.showInformationMessage(
                    `🦙 Pulling Ollama model '${targetModel}' in background...`
                );

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
        vscode.commands.registerCommand('giskard-assistant.addRemoteConnectionTree', async () => {
            const providerPick = await vscode.window.showQuickPick(
                [...PROVIDER_CATALOG, CUSTOM_PROVIDER_ENTRY].map((e) => ({
                    label: `${e.emoji} ${e.name}`,
                    url: e.url,
                    tag: e.tag,
                    type: e.type,
                    detail: e.detail
                })),
                { placeHolder: 'Select AI Provider / Connection to Add' }
            );

            if (!providerPick) return;

            let name = providerPick.label.replace(/^[^\s]+\s*/, '');
            let url = providerPick.url;
            let tag = providerPick.tag;
            const type: 'local' | 'remote' = providerPick.type as any;

            if (providerPick.tag === 'custom') {
                const customName = await vscode.window.showInputBox({
                    prompt: 'Connection Profile Name',
                    placeHolder: 'e.g. My Custom LLM Server'
                });
                if (!customName) return;
                name = customName;

                const customUrl = await vscode.window.showInputBox({
                    prompt: 'Base URL',
                    placeHolder: 'e.g. http://localhost:8080/v1'
                });
                if (!customUrl) return;
                url = customUrl;

                const customTag = await vscode.window.showInputBox({
                    prompt: 'Provider Tag (e.g. custom, vllm, lm-studio)',
                    value: 'custom'
                });
                tag = customTag || 'custom';
            } else {
                const customUrl = await vscode.window.showInputBox({
                    prompt: `Base URL for ${name}`,
                    value: url
                });
                if (!customUrl) return;
                url = customUrl;
            }

            let apiKey: string | undefined = undefined;
            if (type === 'remote' || tag !== 'ollama') {
                apiKey = await vscode.window.showInputBox({
                    prompt: `API Key / Bearer Token for ${name} (Optional for local)`,
                    password: true
                });
            }

            await store.addConnection(name, type, url, tag, apiKey);
            remoteConnsTree.refresh();
            localModelsTree.refresh();
            await provider.refreshState();
            vscode.window.showInformationMessage(`✓ AI Connection "${name}" added and activated.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleConnectionActive', async (arg: any) => {
            const connId = parseItemId(arg);
            if (connId === null) return;

            await store.toggleActive(connId);

            const conn = store.getAll().find((c) => Number(c.id) === connId);
            const nameStr = conn ? conn.name : 'AI Connection';
            const isActive = conn ? conn.isActive : false;

            remoteConnsTree.refresh();
            localModelsTree.refresh();
            modelSettingsProvider.refresh();
            await provider.refreshState();

            const statusStr = isActive ? 'enabled 🟢 (Active)' : 'disabled ⚪ (Standby)';
            vscode.window.showInformationMessage(`✓ AI Connection "${nameStr}" ${statusStr}.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.removeRemoteConnectionTree', async (arg: any) => {
            const connId = parseItemId(arg, true);
            if (connId === null) return;

            const conn = store.getAll().find((c) => Number(c.id) === connId);
            const nameStr = conn ? conn.name : (arg as any)?.rawData?.connectionName || 'AI Connection';

            const confirm = await vscode.window.showWarningMessage(
                `Delete AI connection profile '${nameStr}'?`,
                { modal: true },
                'Delete Connection'
            );
            if (confirm !== 'Delete Connection') return;

            await store.removeConnection(connId);
            remoteConnsTree.refresh();
            localModelsTree.refresh();
            modelSettingsProvider.refresh();
            await provider.refreshState();
            vscode.window.showInformationMessage(`✓ AI Connection "${nameStr}" deleted.`);
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
        vscode.commands.registerCommand('giskard-assistant.addServer', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Nombre de la Conexión (ej. Mi Servidor Ollama, NVIDIA NIM, DeepSeek)',
                placeHolder: 'NVIDIA NIM Prod'
            });
            if (!name) return;
            const url = await vscode.window.showInputBox({
                prompt: 'URL Base del Endpoint API (ej. https://integrate.api.nvidia.com/v1 o http://localhost:11434)',
                placeHolder: 'https://integrate.api.nvidia.com/v1'
            });
            if (!url) return;
            const tag = await vscode.window.showInputBox({
                prompt: 'Tag / Proveedor (nvidia, deepseek, ollama, openai, gemini, qwen)',
                placeHolder: 'nvidia'
            });
            if (!tag) return;
            const apiKey = await vscode.window.showInputBox({
                prompt: 'API Key (Opcional para local)',
                password: true
            });

            await store.addConnection(name, 'remote', url, tag.toLowerCase(), apiKey || undefined);
            localModelsTree.refresh();
            remoteConnsTree.refresh();
            vscode.window.showInformationMessage(
                `✓ Servidor '${name}' agregado y activado con éxito en Giskard!`
            );
        })
    ];
}
