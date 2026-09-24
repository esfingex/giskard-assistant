/**
 * Giskard Assistant VSCode Extension — Shared Webview Message Contract
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Single source of truth for every postMessage type exchanged between the
 * TypeScript extension host and the vanilla-JS webview. Adding a new message
 * type here breaks neither side; forgetting to update both sides breaks loudly.
 */

// ── TS → Webview (extension host pushes state / stream data down) ────────────

export interface SetEnabledModelsMessage {
    type: 'setEnabledModels';
    enabledModels: string[];
}

export interface ExclusionPatternsLoadedMessage {
    type: 'exclusionPatternsLoaded';
    patterns: string[];
}

export interface InjectCodeSnippetMessage {
    type: 'injectCodeSnippet';
    contextBlock: {
        relativePath: string;
        startLine: number;
        endLine: number;
        code: string;
        lang: string;
    };
}

export interface ConnectionsLoadedMessage {
    type: 'connectionsLoaded';
    connections: any[]; // Connection[]
}

export interface ConnectionErrorMessage {
    type: 'connectionError';
    error: string;
}

export interface ConnectionTestedMessage {
    type: 'connectionTested';
    ok: boolean;
    status?: number;
    ms?: number;
    error?: string;
}

export interface ModelsListMessage {
    type: 'modelsList';
    models?: string[];
    enabledModels?: string[];
    groups?: any[]; // ConnectionModelsGroup[]
    localModels?: string[];
    activeTag?: string;
    activeName?: string;
    currentUrl?: string;
    connectionMode?: 'giskardSysActive' | 'ollamaDirect';
}

export interface SettingsErrorMessage {
    type: 'settingsError';
    error: string;
}

export interface ActionResultMessage {
    type: 'actionResult';
    text: string;
}

export interface StreamTokenMessage {
    type: 'streamToken';
    token: string;
    model?: string;
    tabId?: string;
}

export interface StreamCompleteMessage {
    type: 'streamComplete';
    model?: string;
    tabId?: string;
}

export interface StreamErrorMessage {
    type: 'streamError';
    model?: string;
    tabId?: string;
    error: string;
}

export interface StreamStatusMessage {
    type: 'streamStatus';
    phase: 'connecting' | 'connected' | 'done';
    isLocal?: boolean;
    provider?: string;
    model?: string;
    tabId?: string;
}

export interface OfflineModeMessage {
    type: 'offlineMode';
    active: boolean;
}

export interface HandoffMessage {
    type: 'handoff';
    skill?: string;
    message?: string;
}

export interface McpServersLoadedMessage {
    type: 'mcpServersLoaded';
    servers?: any[]; // McpServer[] (extension.ts tree-refresh sends it empty; JS re-fetches)
}

export interface McpTestedMessage {
    type: 'mcpTested';
    ok: boolean;
    ms?: number;
    error?: string;
}

export interface SmitherySearchResultsMessage {
    type: 'smitherySearchResults';
    query: string;
    results?: any[];
    error?: string;
}

export interface ClearMessagesMessage {
    type: 'clearMessages';
}

export interface SelectThemeMessage {
    type: 'selectTheme';
    theme: string;
}

export interface ChatHistoryRestoredMessage {
    type: 'chatHistoryRestored';
    tabs: any[];
}

export interface ContextClearedMessage {
    type: 'contextCleared';
}

export interface ToolReadFileResultMessage {
    type: 'toolReadFileResult';
    id: number;
    path: string;
    content?: string;
    error?: string;
}

export interface ToolListDirResultMessage {
    type: 'toolListDirResult';
    id: number;
    path: string;
    listing?: string;
    error?: string;
}

export interface ToolWriteFileResultMessage {
    type: 'toolWriteFileResult';
    id: number;
    success: boolean;
    path?: string;
    mode?: 'new' | 'overwrite';
    error?: string;
}

export interface ToolExecResultMessage {
    type: 'toolExecResult';
    id: number;
    output?: string;
    error?: string;
}

export interface ToolSearchResultMessage {
    type: 'toolSearchResult';
    id: number;
    query?: string;
    files?: string[];
    error?: string;
}

export interface ToolGlobResultMessage {
    type: 'toolGlobResult';
    id: number;
    pattern?: string;
    files?: string[];
    error?: string;
}

/** Union of all messages the extension host may push down to the webview. */
export type HostToWebviewMessage =
    | SetEnabledModelsMessage
    | ExclusionPatternsLoadedMessage
    | InjectCodeSnippetMessage
    | ConnectionsLoadedMessage
    | ConnectionErrorMessage
    | ConnectionTestedMessage
    | ModelsListMessage
    | SettingsErrorMessage
    | ActionResultMessage
    | StreamTokenMessage
    | StreamCompleteMessage
    | StreamErrorMessage
    | StreamStatusMessage
    | OfflineModeMessage
    | HandoffMessage
    | McpServersLoadedMessage
    | McpTestedMessage
    | SmitherySearchResultsMessage
    | ClearMessagesMessage
    | SelectThemeMessage
    | ChatHistoryRestoredMessage
    | ContextClearedMessage
    | ToolReadFileResultMessage
    | ToolListDirResultMessage
    | ToolWriteFileResultMessage
    | ToolExecResultMessage
    | ToolSearchResultMessage
    | ToolGlobResultMessage;

// ── Webview → TS (user actions bubble up) ────────────────────────────────────

export interface SendPromptMessage {
    type: 'sendPrompt';
    prompt: string;
    model?: string;
    tabId?: string;
    includeFile?: boolean;
}

export interface StopGenerationMessage {
    type: 'stopGeneration';
}

export interface OpenSettingsMessage {
    type: 'openSettings';
}

export interface LoadConnectionsMessage {
    type: 'loadConnections';
}

export interface AddConnectionMessage {
    type: 'addConnection';
    name: string;
    connType: 'local' | 'remote';
    url: string;
    tag: string;
    apiKey?: string;
}

export interface RemoveConnectionMessage {
    type: 'removeConnection';
    id: number;
}

export interface ResetConnectionsMessage {
    type: 'resetConnections';
}

export interface ActivateConnectionMessage {
    type: 'activateConnection';
    id: number;
}

export interface TestConnectionUrlMessage {
    type: 'testConnectionUrl';
    url: string;
    tag?: string;
    apiKey?: string;
}

export interface WebviewReadyMessage {
    type: 'webviewReady';
}

export interface CreateNewChatTabMessage {
    type: 'createNewChatTab';
}

export interface FetchModelsMessage {
    type: 'fetchModels';
}

export interface GetModelsMessage {
    type: 'getModels';
}

export interface ModelChangedMessage {
    type: 'modelChanged';
    model: string;
    tabId?: string;
}

export interface SaveSettingsMessage {
    type: 'saveSettings';
    settings: Record<string, any>;
}

export interface ClearContextMessage {
    type: 'clearContext';
}

export interface GetExclusionPatternsMessage {
    type: 'getExclusionPatterns';
}

export interface SaveExclusionPatternsMessage {
    type: 'saveExclusionPatterns';
    patterns: string[];
}

export interface ActionBtnMessage {
    type: 'actionBtn';
    action: string;
    data?: any;
}

export interface OpenFileMessage {
    type: 'openFile';
    path: string;
}

export interface OpenDiffMessage {
    type: 'openDiff';
    text: string;
}

export interface LoadMcpServersMessage {
    type: 'loadMcpServers';
}

export interface AddMcpServerMessage {
    type: 'addMcpServer';
    name: string;
    serverType: 'docker' | 'stdio' | 'url';
    commandOrUrl: string;
}

export interface RemoveMcpServerMessage {
    type: 'removeMcpServer';
    id: number;
}

export interface ToggleMcpServerMessage {
    type: 'toggleMcpServer';
    id: number;
}

export interface ToggleMcpToolMessage {
    type: 'toggleMcpTool';
    serverId: number;
    toolId: string;
}

export interface DiscoverMcpToolsMessage {
    type: 'discoverMcpTools';
    id: number;
}

export interface TestMcpServerMessage {
    type: 'testMcpServer';
    id: number;
}

export interface SearchSmitheryMessage {
    type: 'searchSmithery';
    query: string;
}

/** Tool call bridge messages (read-only + exec with approval) */
export interface ToolReadFileMessage {
    type: 'toolReadFile';
    path: string;
    id: number;
}

export interface ToolWriteFileMessage {
    type: 'toolWriteFile';
    path: string;
    content: string;
    id: number;
    approved?: boolean;
}

export interface ToolListDirMessage {
    type: 'toolListDir';
    path: string;
    id: number;
}

export interface ToolSearchMessage {
    type: 'toolSearch';
    query: string;
    id: number;
}

export interface ToolGlobMessage {
    type: 'toolGlob';
    pattern: string;
    id: number;
}

export interface ToolExecMessage {
    type: 'toolExec';
    command: string;
    id: number;
    approved?: boolean;
}

export interface ApprovePlanMessage {
    type: 'approvePlan';
    approved: boolean;
}

export interface SaveChatHistoryMessage {
    type: 'saveChatHistory';
    tabs: any[];
}

export interface RestoreChatHistoryMessage {
    type: 'restoreChatHistory';
    tabId: string;
}

export interface CompressMemoryMessage {
    type: 'compressMemory';
}

export interface RunGraphifyMessage {
    type: 'runGraphify';
}

export interface FetchSkillsMessage {
    type: 'fetchSkills';
}

export interface CopyToClipboardMessage {
    type: 'copyToClipboard';
    text: string;
}

/** Union of all messages the webview may bubble up to the extension host. */
export type WebviewToHostMessage =
    | SendPromptMessage
    | StopGenerationMessage
    | OpenSettingsMessage
    | LoadConnectionsMessage
    | AddConnectionMessage
    | RemoveConnectionMessage
    | ResetConnectionsMessage
    | ActivateConnectionMessage
    | TestConnectionUrlMessage
    | WebviewReadyMessage
    | CreateNewChatTabMessage
    | FetchModelsMessage
    | GetModelsMessage
    | ModelChangedMessage
    | SaveSettingsMessage
    | ClearContextMessage
    | GetExclusionPatternsMessage
    | SaveExclusionPatternsMessage
    | ActionBtnMessage
    | OpenFileMessage
    | OpenDiffMessage
    | LoadMcpServersMessage
    | AddMcpServerMessage
    | RemoveMcpServerMessage
    | ToggleMcpServerMessage
    | ToggleMcpToolMessage
    | DiscoverMcpToolsMessage
    | TestMcpServerMessage
    | SearchSmitheryMessage
    | ToolReadFileMessage
    | ToolWriteFileMessage
    | ToolListDirMessage
    | ToolSearchMessage
    | ToolGlobMessage
    | ToolExecMessage
    | ApprovePlanMessage
    | SaveChatHistoryMessage
    | RestoreChatHistoryMessage
    | CompressMemoryMessage
    | RunGraphifyMessage
    | FetchSkillsMessage
    | CopyToClipboardMessage;