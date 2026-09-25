/**
 * Giskard Assistant VSCode Extension — Cell: Chat Webview Sidebar
 * Copyright (C) 2025-2026 Giskard Project
 *
 * All HTML layout CSS lives in src/cells/htmlShell.ts.
 * MCP operations live in src/cells/mcpHandlers.ts.
 * Tool call bridge ops live in src/cells/toolHandlers.ts.
 */

import * as vscode from 'vscode';
import { ConnectionModelsGroup, resetSession } from '../core/api';
import { ConnectionStore } from '../core/connectionStore';
import { EventBus, EventPayload } from '../core/eventBus';
import { getHtmlForWebview } from './htmlShell';
import { sendMcpServersList } from './mcpHandlers';

import { clearAgentActivity } from './statusBar';
import { ChatMessage } from '../core/contextWindow';
import { AgentState, AgentLoopContext, autoVerifyAndFix } from './agentLoop';
import {
    StreamContext,
    streamFromOllamaLegacy,
    streamOllamaChat,
    streamFromRemoteApi,
    RemoteStreamContext,
    resolveGiskardSysOllama
} from './streamManager';
import { HostToWebviewMessage } from '../core/webviewContract';
import { DiffContext, maybeAutoTriggerDiff } from './diffHandlers';
import { KnowledgeContext } from './knowledgeHandlers';
import { ChatStateContext, sendModelsList } from './chatStateHandlers';
import { ChatRouterDeps, setWebviewMessageListener } from './messageRouter';
import { PromptHost, handlePrompt } from './promptHandlers';
import { ConnectionsContext, sendConnectionsList } from './connectionsHandlers';

export class GiskardChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'giskard-assistant.chatView';

    private _view?: vscode.WebviewView;
    private _activeAbortController: AbortController | null = null;
    private _localModelStreaming: boolean = false;
    private _modelConnectionMap: Map<string, ConnectionModelsGroup> = new Map();

    /** Últimos modelo/URL/tab usados — para el bucle auto-corrector con tests */
    private _agentState: AgentState = { lastModel: '', lastOllamaUrl: '', lastBotResponse: '' };

    /** Fase 2: per-tab chat history (messages[]) for the host-side agent loop */
    private _tabHistory: Map<string, ChatMessage[]> = new Map();
    private readonly _agentLoopBudget = 28000; // safe margin under the 32K local window

    /** Snapshots of AI edits (original content) for one-click revert */

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _store: ConnectionStore,
        private readonly _context?: vscode.ExtensionContext
    ) {
        EventBus.instance.onDidChange(async (e: EventPayload) => {
            if (
                e.event === 'modelsUpdated' ||
                e.event === 'modelToggled' ||
                e.event === 'connectionChanged'
            ) {
                await this.refreshState();
            }
        });
    }

    /** Revert the most recent AI edit (Fase 3: snapshot + revert) */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = await getHtmlForWebview(this._extensionUri, webviewView.webview);

        this._setWebviewMessageListener(webviewView.webview);

        await this.refreshState();
    }

    private _panel?: vscode.WebviewPanel;

    public async attachPanel(panel: vscode.WebviewPanel) {
        this._panel = panel;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        panel.webview.html = await getHtmlForWebview(this._extensionUri, panel.webview);
        this._setWebviewMessageListener(panel.webview);

        panel.onDidDispose(() => {
            if (this._activeAbortController) {
                this._activeAbortController.abort();
            }
            this._panel = undefined;
        });

        await this.refreshState();
    }

    public get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    public async refreshState() {
        const enabledModels = this._store.getEnabledModels();
        const patterns = this._store.getExclusionPatterns();

        if (this._view) {
            this._view.webview.postMessage({ type: 'setEnabledModels', enabledModels });
            this._view.webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
        }
        if (this._panel) {
            this._panel.webview.postMessage({ type: 'setEnabledModels', enabledModels });
            this._panel.webview.postMessage({ type: 'exclusionPatternsLoaded', patterns });
        }

        await sendConnectionsList(this._cellCtx());
        await sendModelsList(this._stateCtx());
        if (this._view) await sendMcpServersList(this._view, this._store);
    }

    public postMessage(message: HostToWebviewMessage) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
        if (this._panel) {
            this._panel.webview.postMessage(message);
        }
    }

    public injectCodeContext(contextBlock: {
        relativePath: string;
        startLine: number;
        endLine: number;
        code: string;
        lang: string;
    }) {
        this.postMessage({
            type: 'injectCodeSnippet',
            contextBlock
        });
    }

    /** Dependencias del router de mensajes (decomposition wave 6b) */
    private _routerDeps(): ChatRouterDeps {
        return {
            getView: () => this._view,
            abortActive: () => {
                if (this._activeAbortController) {
                    this._activeAbortController.abort();
                    this._activeAbortController = null;
                }
            },
            tabHistory: this._tabHistory,
            resetSession: () => resetSession(),
            refreshState: () => this.refreshState(),
            handlePrompt: (prompt, model, includeActiveFile, contextType, tabId) =>
                this._handlePrompt(
                    prompt,
                    model || '',
                    Boolean(includeActiveFile),
                    contextType || 'none',
                    tabId
                ),
            store: this._store,
            cellCtx: () => this._cellCtx(),
            stateCtx: () => this._stateCtx(),
            diffCtx: () => this._diffCtx(),
            agentCtx: () => this._agentCtx(),
            knowledgeCtx: () => this._knowledgeCtx()
        };
    }

    /** Contexto para la célula de estado (decomposition wave 6) */
    private _stateCtx(): ChatStateContext {
        return {
            view: this._view,
            panel: this._panel,
            store: this._store,
            modelConnectionMap: this._modelConnectionMap,
            postMessage: (m) => this.postMessage(m),
            extensionContext: this._context
        };
    }

    /** Contexto para la célula de conocimiento (decomposition wave 5) */
    private _knowledgeCtx(): KnowledgeContext {
        return { view: this._view, store: this._store };
    }

    /** Contexto para la célula de diffs (decomposition wave 4) */
    private _diffCtx(): DiffContext {
        return {
            onEditApplied: () =>
                autoVerifyAndFix(this._agentCtx()).catch(() => {
                    /* best-effort */
                })
        };
    }

    /** Contexto para la célula del bucle agéntico (decomposition wave 3) */
    private _agentCtx(): AgentLoopContext {
        return {
            view: this._view,
            agentState: this._agentState,
            tabHistory: this._tabHistory,
            streamChat: (messages, model, ollamaUrl, tabId) =>
                this._streamOllamaChat(messages, model, ollamaUrl, tabId),
            maybeAutoTriggerDiff: (u, r, pf, f) => maybeAutoTriggerDiff(this._diffCtx(), u, r, pf, f),
            handlePrompt: (prompt, model, includeFile, mode, tabId) =>
                this._handlePrompt(prompt, model || '', Boolean(includeFile), mode || 'none', tabId),
            clearAbort: () => {
                this._activeAbortController = null;
            },
            firstEnabledModel: () => this._store.getEnabledModels()[0] || ''
        };
    }

    /** Contexto compartido para las células extraídas (decomposition wave 2+) */
    private _cellCtx(): ConnectionsContext {
        return {
            view: this._view,
            panel: this._panel,
            store: this._store,
            postMessage: (m) => this.postMessage(m),
            refreshState: () => this.refreshState()
        };
    }

    private async _handlePrompt(
        prompt: string,
        model: string,
        includeActiveFile: boolean,
        contextType: string,
        tabId?: string
    ) {
        await handlePrompt(this._promptHost(), prompt, model, includeActiveFile, contextType, tabId);
    }

    /** Host para la célula del orquestador de prompts (wave 9) */
    private _promptHost(): PromptHost {
        return {
            getView: () => this._view,
            store: this._store,
            agentState: this._agentState,
            modelConnectionMap: this._modelConnectionMap,
            isLocalStreaming: () => this._localModelStreaming,
            setLocalStreaming: (v) => {
                this._localModelStreaming = v;
            },
            getAbort: () => this._activeAbortController,
            setAbort: (c) => {
                this._activeAbortController = c;
            },
            agentCtx: () => this._agentCtx(),
            diffCtx: () => this._diffCtx(),
            streamRemote: (
                baseUrl,
                apiKey,
                mdl,
                fullPrompt,
                userPrompt,
                extractedPath,
                includeActiveFile,
                tabId
            ) =>
                this._streamFromRemoteApi(
                    baseUrl,
                    apiKey,
                    mdl,
                    fullPrompt,
                    userPrompt,
                    extractedPath,
                    includeActiveFile,
                    tabId
                ),
            streamOllamaFallback: (
                fullPrompt,
                mdl,
                userPrompt,
                extractedPath,
                includeActiveFile,
                customOllamaUrl,
                tabId
            ) =>
                this._streamFromOllamaFallback(
                    fullPrompt,
                    mdl,
                    userPrompt,
                    extractedPath,
                    includeActiveFile,
                    customOllamaUrl,
                    tabId
                ),
            resolveGiskardSysOllama: (url) => this._resolveGiskardSysOllama(url)
        };
    }

    /** Streams directly from Remote OpenAI-compatible APIs (NVIDIA NIM, DeepSeek, Kimi, Qwen, etc) */
    /** Wrapper: construye el RemoteStreamContext y delega a streamManager (versión viva, wave 9) */
    private async _streamFromRemoteApi(
        baseUrl: string,
        apiKey: string,
        model: string,
        fullPrompt: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        tabId?: string
    ) {
        if (!this._view) return;
        this._activeAbortController = new AbortController();
        const ctx: RemoteStreamContext = {
            view: this._view,
            abortController: this._activeAbortController,
            lastBotResponse: { text: '' },
            maybeAutoTriggerDiff: (u, r, p, f) => maybeAutoTriggerDiff(this._diffCtx(), u, r, p, f),
            clearAbort: () => {
                this._activeAbortController = null;
            }
        };
        await streamFromRemoteApi(
            ctx,
            baseUrl,
            apiKey,
            model,
            fullPrompt,
            userPrompt,
            extractedPath,
            includeActiveFile,
            tabId
        );
        this._agentState.lastBotResponse = ctx.lastBotResponse.text;
    }

    private async _streamFromOllamaFallback(
        fullPrompt: string,
        model: string,
        userPrompt?: string,
        extractedPath?: string,
        includeActiveFile?: boolean,
        customOllamaUrl?: string,
        tabId?: string
    ) {
        if (!this._view) return;

        this._activeAbortController = new AbortController();

        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const defaultModel = config.get<string>('defaultModel') || 'qwen3-coder:30b';
        const ollamaBaseUrl =
            customOllamaUrl || config.get<string>('ollamaBaseUrl') || 'http://127.0.0.1:11434';
        const targetModel = model && !model.startsWith('cli:') ? model : defaultModel;

        const ctx: StreamContext = {
            view: this._view,
            abortController: this._activeAbortController,
            lastBotResponse: { text: '' }
        };

        try {
            await streamFromOllamaLegacy(ctx, ollamaBaseUrl, fullPrompt, targetModel, tabId);
            this._agentState.lastBotResponse = ctx.lastBotResponse.text;
            clearAgentActivity();
            this._view.webview.postMessage({ type: 'streamComplete', model: targetModel, tabId });
            await maybeAutoTriggerDiff(
                this._diffCtx(),
                userPrompt || fullPrompt,
                this._agentState.lastBotResponse,
                extractedPath,
                includeActiveFile
            );
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'streamError',
                    model: targetModel,
                    tabId,
                    error: `❌ Error con el modelo local ${targetModel}: ${err?.message || err}`
                });
            }
        } finally {
            this._activeAbortController = null;
        }
    }

    /** Fase 2: stream a chat completion from Ollama's /api/chat with a structured message history */
    private async _streamOllamaChat(
        messages: ChatMessage[],
        model: string,
        ollamaUrl: string,
        tabId?: string
    ): Promise<string> {
        if (!this._view) return '';
        this._activeAbortController = new AbortController();

        const ctx: StreamContext = {
            view: this._view,
            abortController: this._activeAbortController,
            lastBotResponse: { text: '' }
        };
        return await streamOllamaChat(ctx, messages, model, ollamaUrl, tabId);
    }

    /** Fase 2: host-side agent loop for local Ollama models — model → read-only tools → model, with history + budget */
    /**
     * Resuelve la URL de Ollama que sirve el backend giskard-sys consultando
     * GET /policy. Solo devuelve valor cuando el proveedor activo es "ollama".
     * Cacheada 60s para no golpear el conector en cada mensaje.
     * Delegada a streamManager.ts.
     */
    private async _resolveGiskardSysOllama(connectorUrl: string): Promise<string | null> {
        return await resolveGiskardSysOllama(connectorUrl);
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        setWebviewMessageListener(webview, this._routerDeps());
    }
}

let _chatTabCounter = 1;

export function createNewChatPanelTab(
    context: vscode.ExtensionContext,
    store: ConnectionStore,
    title?: string
) {
    _chatTabCounter++;
    const panelTitle = title || `GISKARD #${_chatTabCounter}`;
    const panel = vscode.window.createWebviewPanel('giskard-chat-tab', panelTitle, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
    });

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'giskard.svg');

    const provider = new GiskardChatWebviewProvider(context.extensionUri, store);
    provider.attachPanel(panel);
}
