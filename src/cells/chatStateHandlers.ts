/**
 * Giskard Assistant VSCode Extension — Chat State Handlers
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 6).
 * Models list assembly, provider settings, CLI actions and chat tab history.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { fetchLlmModels, fetchLlmModelsGrouped, execCliCommand, getConnectorUrl } from '../core/api';
import { fetchOllamaModels } from '../core/providers';
import { ConnectionModelsGroup } from '../core/api';
import { HostToWebviewMessage } from '../core/webviewContract';

export interface ChatStateContext {
    view?: vscode.WebviewView;
    panel?: vscode.WebviewPanel;
    store: ConnectionStore;
    /** Mapa modelo → ConnectionModelsGroup, compartido con _handlePrompt */
    modelConnectionMap: Map<string, ConnectionModelsGroup>;
    postMessage(message: HostToWebviewMessage): void;
    extensionContext?: vscode.ExtensionContext;
}

export async function sendModelsList(ctx: ChatStateContext): Promise<void> {
    if (!ctx.view && !ctx.panel) return;

    let enabledModels = ctx.store.getEnabledModels();

    const activeConn = ctx.store.getActive();
    const activeTag = activeConn?.tag || 'giskard-sys';
    const activeName = activeConn?.name || (activeConn?.type === 'remote' ? 'Remote API' : 'Giskard-Sys');

    const groups = await fetchLlmModelsGrouped().catch(() => []);
    const remoteModels = await fetchLlmModels().catch(() => []);

    const ollamaConn = ctx.store.getAll().find((c) => c.tag === 'ollama' || c.url.includes(':11434'));
    const ollamaUrl = ollamaConn?.url || 'http://127.0.0.1:11434';
    const localModels = await fetchOllamaModels(ollamaUrl).catch(() => []);

    const flatGroupModels: string[] = [];
    ctx.modelConnectionMap.clear();
    groups.forEach((g) => {
        if (g && Array.isArray(g.models)) {
            flatGroupModels.push(...g.models);
            g.models.forEach((m) => {
                if (m) ctx.modelConnectionMap.set(m, g);
            });
        }
    });

    const allFlatModels = Array.from(
        new Set([...enabledModels, ...flatGroupModels, ...remoteModels, ...localModels])
    ).filter((m) => Boolean(m));

    // Auto-enable if empty
    if (enabledModels.length === 0 && allFlatModels.length > 0) {
        enabledModels = allFlatModels;
        ctx.store.setEnabledModels(enabledModels);
    }

    ctx.postMessage({ type: 'setEnabledModels', enabledModels });

    const config = vscode.workspace.getConfiguration('giskard-assistant');
    const isGiskardSysEnabled = config.get<boolean>('giskardSys.enabled', false);
    const connectionMode = isGiskardSysEnabled ? 'giskardSysActive' : 'ollamaDirect';

    ctx.postMessage({
        type: 'modelsList',
        models: allFlatModels,
        enabledModels,
        groups,
        localModels,
        activeTag,
        activeName,
        currentUrl: getConnectorUrl(),
        connectionMode
    });
}

export async function handleSaveSettings(
    ctx: ChatStateContext,
    provider: string,
    _baseUrl?: string,
    _apiKey?: string
): Promise<void> {
    try {
        const res = await execCliCommand('config', 'update', provider);
        if (res.success) {
            vscode.window.showInformationMessage(`✓ Proveedor IA actualizado a: ${provider}`);
        } else {
            ctx.view?.webview.postMessage({ type: 'settingsError', error: res.error });
        }
    } catch (err: any) {
        ctx.view?.webview.postMessage({ type: 'settingsError', error: err.message });
    }
}

export async function handleAction(ctx: ChatStateContext, action: string): Promise<void> {
    if (!ctx.view) return;
    try {
        const resData = await execCliCommand('rtk', action);
        const text = resData.success ? resData.data : `Error Ejecución: ${resData.error}`;
        ctx.view.webview.postMessage({ type: 'actionResult', text });
    } catch (err: any) {
        ctx.view.webview.postMessage({ type: 'streamError', error: err.message });
    }
}

/** Fase 4a: persist chat tabs history in workspaceState */
export async function saveChatHistory(ctx: ChatStateContext, tabs: any[]): Promise<void> {
    if (!ctx.extensionContext || !Array.isArray(tabs) || tabs.length === 0) return;
    try {
        // Cap payload: keep the most recent 2 tabs if the serialized history is large
        let safeTabs = tabs;
        const serialized = JSON.stringify(tabs);
        if (serialized && serialized.length > 90000) {
            safeTabs = tabs.slice(-2);
        }
        await ctx.extensionContext.workspaceState.update('giskard.chatTabs', safeTabs);
    } catch {
        /* non-critical: history persistence is best-effort */
    }
}

/** Fase 4a: restore chat tabs from workspaceState and push to the webview */
export async function restoreChatHistory(ctx: ChatStateContext): Promise<void> {
    if (!ctx.extensionContext || !ctx.view) return;
    try {
        const tabs = ctx.extensionContext.workspaceState.get<any[]>('giskard.chatTabs', []);
        if (Array.isArray(tabs) && tabs.length > 0) {
            ctx.view.webview.postMessage({ type: 'chatHistoryRestored', tabs });
        }
    } catch {
        /* non-critical */
    }
}
