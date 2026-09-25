/**
 * Giskard Assistant VSCode Extension — Message Router
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 6b).
 * Single dispatch point for every WebviewToHost message type defined in
 * core/webviewContract.ts. Routing policy lives here (e.g. the DeepSeek
 * off-peak gate); the actual work lives in the extracted cells.
 *
 * Depends on the chat cell through an explicit ChatRouterDeps bag.
 */

import * as vscode from 'vscode';
import { getPeakInfo } from '../core/providers/deepseekProvider';
import { WebviewToHostMessage } from '../core/webviewContract';
import { ConnectionStore } from '../core/connectionStore';
import { ChatMessage } from '../core/contextWindow';
import { setAgentActivity } from './statusBar';
import { resetVerifyIterations, approvePlan, compressMemory } from './agentLoop';
import {
    sendConnectionsList,
    handleAddConnection,
    handleRemoveConnection,
    handleResetConnections,
    handleActivateConnection,
    handleTestConnectionUrl,
    ConnectionsContext
} from './connectionsHandlers';
import {
    sendModelsList,
    handleSaveSettings,
    handleAction,
    saveChatHistory,
    restoreChatHistory,
    ChatStateContext
} from './chatStateHandlers';
import { openDiff, DiffContext } from './diffHandlers';
import { KnowledgeContext, fetchSkills, runGraphify } from './knowledgeHandlers';
import {
    sendMcpServersList,
    handleAddMcpServer,
    handleRemoveMcpServer,
    handleToggleMcpServer,
    handleToggleMcpTool,
    handleDiscoverMcpTools,
    handleTestMcpServer,
    handleSearchSmitheryRegistry
} from './mcpHandlers';
import {
    handleOpenFile,
    handleToolReadFile,
    handleToolWriteFile,
    handleToolExec,
    handleToolListDir,
    handleToolSearch,
    handleToolGlob
} from './toolHandlers';
import { AgentLoopContext } from './agentLoop';

/** Explicit dependency bag passed by the chat cell. */
export interface ChatRouterDeps {
    getView(): vscode.WebviewView | undefined;
    /** Aborta la generación activa y limpia el controlador (stopGeneration / clearContext). */
    abortActive(): void;
    tabHistory: Map<string, ChatMessage[]>;
    resetSession(): Promise<void>;
    refreshState(): Promise<void>;
    handlePrompt(
        prompt: string,
        model?: string,
        includeActiveFile?: boolean,
        contextType?: string,
        tabId?: string
    ): Promise<void>;
    store: ConnectionStore;
    cellCtx(): ConnectionsContext;
    stateCtx(): ChatStateContext;
    diffCtx(): DiffContext;
    agentCtx(): AgentLoopContext;
    knowledgeCtx(): KnowledgeContext;
}

export function setWebviewMessageListener(webview: vscode.Webview, deps: ChatRouterDeps): void {
    webview.onDidReceiveMessage(async (data: WebviewToHostMessage) => {
        try {
            switch (data.type) {
                case 'sendPrompt': {
                    // Regla del usuario (2026-09-09): DeepSeek oficial solo en off-peak.
                    const modelLower = String(data.model || '').toLowerCase();
                    if (modelLower.startsWith('deepseek') || modelLower.includes('deepseek')) {
                        const peak = getPeakInfo();
                        if (peak.isPeak) {
                            const choice = await vscode.window.showWarningMessage(
                                `Horario PEAK de DeepSeek API (ventanas 01:00-04:00 y 06:00-10:00 UTC, lun-vie). Proxima transicion: ${peak.nextTransitionUtc} UTC. Las corridas pagadas en peak cuestan mas.`,
                                { modal: true },
                                'Continuar de todos modos',
                                'Cancelar'
                            );
                            if (choice !== 'Continuar de todos modos') {
                                break;
                            }
                        }
                    }
                    resetVerifyIterations();
                    await deps.handlePrompt(
                        data.prompt,
                        data.model,
                        data.includeActiveFile,
                        data.contextType,
                        data.tabId
                    );
                    break;
                }
                case 'stopGeneration':
                    deps.abortActive();
                    break;
                case 'openSettings':
                    await deps.refreshState();
                    break;
                case 'loadConnections':
                    await sendConnectionsList(deps.cellCtx());
                    break;
                case 'addConnection':
                    await handleAddConnection(deps.cellCtx(), data);
                    break;
                case 'removeConnection':
                    await handleRemoveConnection(deps.cellCtx(), data.id);
                    break;
                case 'resetConnections':
                    await handleResetConnections(deps.cellCtx());
                    break;
                case 'activateConnection':
                    await handleActivateConnection(deps.cellCtx(), data.id);
                    break;
                case 'testConnectionUrl':
                    await handleTestConnectionUrl(deps.cellCtx(), data.url);
                    break;
                case 'webviewReady':
                    await deps.refreshState();
                    break;
                case 'createNewChatTab':
                    vscode.commands.executeCommand('giskard-assistant.openChatTab');
                    break;
                case 'fetchModels':
                case 'getModels':
                    await sendModelsList(deps.stateCtx());
                    break;
                case 'modelChanged':
                    if (data.model) {
                        await deps.store.setActiveChatModel(data.model);
                    }
                    break;
                case 'saveSettings':
                    await handleSaveSettings(deps.stateCtx(), data.provider, data.baseUrl, data.apiKey);
                    break;
                case 'clearContext':
                    deps.abortActive();
                    // Fix wave 3: limpiar también el historial agéntico y el límite de auto-fix
                    deps.tabHistory.clear();
                    resetVerifyIterations();
                    await deps.resetSession();
                    if (deps.getView()) {
                        deps.getView()!.webview.postMessage({ type: 'contextCleared' });
                    }
                    break;
                case 'getExclusionPatterns': {
                    const patterns = deps.store.getExclusionPatterns();
                    webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
                    break;
                }
                case 'saveExclusionPatterns': {
                    await deps.store.saveExclusionPatterns(data.patterns || []);
                    vscode.window.showInformationMessage('✓ Patrones de exclusión de workspace guardados.');
                    const patterns = deps.store.getExclusionPatterns();
                    webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
                    break;
                }
                case 'actionBtn':
                    await handleAction(deps.stateCtx(), data.action);
                    break;
                case 'openFile':
                    // Fix: el webview envía relativePath (chatView.js/chatUtils.js)
                    await handleOpenFile(data.relativePath || data.path || '');
                    break;
                case 'openDiff':
                    await openDiff(deps.diffCtx(), data.code, data.filePath);
                    break;
                case 'loadMcpServers':
                    await sendMcpServersList(deps.getView(), deps.store);
                    break;
                case 'addMcpServer':
                    await handleAddMcpServer(
                        deps.getView(),
                        deps.store,
                        data.name,
                        data.serverType,
                        data.commandOrUrl
                    );
                    break;
                case 'removeMcpServer':
                    await handleRemoveMcpServer(deps.getView(), deps.store, data.id);
                    break;
                case 'toggleMcpServer':
                    await handleToggleMcpServer(deps.getView(), deps.store, data.id);
                    break;
                case 'toggleMcpTool':
                    await handleToggleMcpTool(deps.getView(), deps.store, data.serverId, data.toolId);
                    break;
                case 'discoverMcpTools':
                    await handleDiscoverMcpTools(deps.getView(), deps.store, data.serverId);
                    break;
                case 'testMcpServer':
                    await handleTestMcpServer(deps.getView(), data.serverType, data.commandOrUrl);
                    break;
                case 'searchSmithery':
                    await handleSearchSmitheryRegistry(deps.getView(), data.query);
                    break;
                // ── Tool Call Bridge (AI-driven file/exec ops) ──────────────
                case 'toolReadFile':
                    setAgentActivity(`leyendo ${data.path}…`);
                    await handleToolReadFile(deps.getView(), data.path, data.id);
                    break;
                case 'toolWriteFile':
                    setAgentActivity(`escribiendo ${data.path}…`);
                    await handleToolWriteFile(deps.getView(), data.path, data.content, data.id);
                    break;
                case 'toolListDir':
                    setAgentActivity(`listando ${data.path}…`);
                    await handleToolListDir(deps.getView(), data.path, data.id);
                    break;
                case 'toolSearch':
                    setAgentActivity(`buscando «${data.query}»…`);
                    await handleToolSearch(deps.getView(), data.query, data.id);
                    break;
                case 'toolGlob':
                    setAgentActivity(`glob ${data.pattern}…`);
                    await handleToolGlob(deps.getView(), data.pattern, data.id);
                    break;
                case 'toolExec':
                    setAgentActivity(`ejecutando ${data.command}…`);
                    await handleToolExec(deps.getView(), data.command, data.args || [], data.id);
                    break;
                case 'approvePlan':
                    await approvePlan(deps.agentCtx(), data.plan, data.model, data.tabId);
                    break;
                case 'saveChatHistory':
                    await saveChatHistory(deps.stateCtx(), data.tabs);
                    break;
                case 'restoreChatHistory':
                    await restoreChatHistory(deps.stateCtx());
                    break;
                case 'compressMemory':
                    // Fix T1: el webview envía el texto en `history` (antes se leía historyText y llegaba siempre '')
                    await compressMemory(deps.getView(), data.history || '');
                    break;
                case 'runGraphify':
                    await runGraphify(deps.knowledgeCtx());
                    break;
                case 'fetchSkills':
                    await fetchSkills(deps.knowledgeCtx());
                    break;
                case 'copyToClipboard':
                    if (data.text) {
                        await vscode.env.clipboard.writeText(data.text);
                        vscode.window.setStatusBarMessage('$(clippy) Código copiado al portapapeles', 2500);
                    }
                    break;
            }
        } catch (err: any) {
            // Global error boundary: never let an unexpected exception kill the chat
            const view = deps.getView();
            if (view) {
                view.webview.postMessage({
                    type: 'streamError',
                    model: 'model' in data ? data.model : undefined,
                    tabId: 'tabId' in data ? data.tabId : undefined,
                    error: `❌ Error inesperado en Giskard: ${err?.message || err}`
                });
            }
        }
    });
}
