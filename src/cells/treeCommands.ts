/**
 * Giskard Assistant VSCode Extension — Célula: Comandos de Árboles (modelos, exclusiones, tema)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de extension.ts. Comandos: addExclusionPatternTree,
 * removeExclusionPatternTree, selectThemeTree, removeLocalModelTree,
 * toggleModelForChat, filterCapabilities, searchModels, refreshTree.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { EventBus } from '../core/eventBus';
import { GiskardChatWebviewProvider } from './chatWebview';
import { GiskardModelSettingsWebviewProvider } from './modelSettingsWebview';
import {
    GiskardLocalModelsTreeProvider,
    GiskardRemoteConnsTreeProvider,
    GiskardFileExclusionsTreeProvider
} from './treeViewProvider';

export interface TreeCommandsContext {
    store: ConnectionStore;
    localModelsTree: GiskardLocalModelsTreeProvider;
    remoteConnsTree: GiskardRemoteConnsTreeProvider;
    fileExclusionsTree: GiskardFileExclusionsTreeProvider;
    modelSettingsProvider: GiskardModelSettingsWebviewProvider;
    provider: GiskardChatWebviewProvider;
}

export function registerTreeCommands(ctx: TreeCommandsContext): vscode.Disposable[] {
    const { store, localModelsTree, remoteConnsTree, fileExclusionsTree, modelSettingsProvider, provider } =
        ctx;

    return [
        vscode.commands.registerCommand('giskard-assistant.addExclusionPatternTree', async () => {
            const pattern = await vscode.window.showInputBox({
                prompt: 'Exclusion Pattern or Gitignore',
                placeHolder: 'e.g. *.log or build/'
            });
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
        vscode.commands.registerCommand('giskard-assistant.removeExclusionPatternTree', async (arg: any) => {
            const pattern =
                typeof arg === 'string' ? arg : (arg?.rawData || arg?.label || '').replace(/^🚫\s*/, '');
            if (!pattern) return;
            let current = store.getExclusionPatterns();
            current = current.filter((p) => p !== pattern);
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
                modelName =
                    typeof arg.label === 'string'
                        ? arg.label
                        : typeof arg.rawData === 'string'
                          ? arg.rawData
                          : '';
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
            modelSettingsProvider.refresh();
            await provider.refreshState();
            vscode.window.showInformationMessage(`✓ Model '${modelName}' removed.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.toggleModelForChat', async (arg: any) => {
            let modelName = '';
            if (typeof arg === 'string') {
                modelName = arg;
            } else if (arg && typeof arg === 'object') {
                if (typeof arg.label === 'string') {
                    modelName = arg.label;
                } else if (arg.label && typeof arg.label.label === 'string') {
                    modelName = arg.label.label;
                } else if (typeof arg.rawData === 'string') {
                    modelName = arg.rawData;
                } else if (arg.rawData && typeof arg.rawData.name === 'string') {
                    modelName = arg.rawData.name;
                } else if (arg.rawData && typeof arg.rawData.model === 'string') {
                    modelName = arg.rawData.model;
                } else if (typeof arg.id === 'string') {
                    modelName = arg.id;
                }
            }
            if (!modelName) return;

            const isNowEnabled = await store.toggleModelEnabled(modelName);
            const enabledList = store.getEnabledModels();

            provider.postMessage({ type: 'setEnabledModels', enabledModels: enabledList });
            await provider.refreshState();
            localModelsTree.refresh();
            modelSettingsProvider.refresh();
            EventBus.instance.fire('modelsUpdated');

            const statusStr = isNowEnabled ? 'enabled 🟢 for Chat' : 'disabled ⚪ from Chat';
            vscode.window.showInformationMessage(`✓ Model '${modelName}' ${statusStr}.`);
        }),
        vscode.commands.registerCommand('giskard-assistant.filterCapabilities', async () => {
            const pick = await vscode.window.showQuickPick(
                [
                    { label: '🧠 Deep Reasoning / Thinking', key: 'reasoning' },
                    { label: '🛠️ Tools & Coder', key: 'tools' },
                    { label: '👁️ Multimodal Vision', key: 'vision' },
                    { label: '🧩 Vectors & Embeddings', key: 'embedding' },
                    { label: '✨ All Models (No Filter)', key: 'all' }
                ],
                { placeHolder: 'Select capability to filter models tree' }
            );
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
        vscode.commands.registerCommand('giskard-assistant.refreshTree', () => {
            localModelsTree.refresh();
            remoteConnsTree.refresh();
            EventBus.instance.fire('modelsUpdated');
            vscode.window.showInformationMessage('🔄 Árboles de Servidores y Modelos actualizados.');
        })
    ];
}
