/**
 * Giskard Assistant VSCode Extension — Core: Connection Store
 * Copyright (C) 2025  Giskard Project — GPL-3.0
 *
 * Manages persistent connection profiles using VS Code's built-in globalState
 * (backed by VS Code's internal SQLite database) and SecretStorage (OS Keychain).
 */

import * as vscode from 'vscode';

export interface Connection {
    id: number;
    name: string;
    type: 'local' | 'remote';
    url: string;
    tag: string;
    secretRef: string | null;
    isActive: boolean;
    createdAt: string;
}

export interface McpTool {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
}

export interface McpServer {
    id: number;
    name: string;
    type: 'docker' | 'stdio' | 'url';
    commandOrUrl: string;
    isActive: boolean;
    tools?: McpTool[];
    createdAt: string;
}

export interface ModelSettings {
    temperature: number; // 0.0 - 1.0
    topP: number;        // 0.0 - 1.0
    topK: number;        // 1 - 100
    numCtx: number;      // 2048 - 128000
    numPredict: number;  // 512 - 4096
    think?: boolean;
    thinkBudget?: number;
}

const STORAGE_KEY = 'giskard_connections_v1';
const MCP_STORAGE_KEY = 'giskard_mcp_servers_v1';
const EXCLUSION_STORAGE_KEY = 'giskard_exclusion_patterns_v1';
const MODEL_OVERRIDES_STORAGE_KEY = 'giskard_model_overrides_v1';

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    numCtx: 32768,
    numPredict: 4096,
    think: false,
    thinkBudget: 2048
};

export interface ModelCapabilities {
    thinking: boolean;
    tools: boolean;
    vision: boolean;
    embedding: boolean;
}

export function getModelCapabilities(modelName: string): ModelCapabilities {
    const l = (modelName || '').toLowerCase();
    const thinking = l.includes('r1') || l.includes('reasoner') || l.includes('qwq') || l.includes('nemotron-3') || l.includes('thinking');
    const tools = l.includes('instruct') || l.includes('coder') || l.includes('gpt') || l.includes('claude') || l.includes('gemini') || l.includes('llama-3');
    const vision = l.includes('vision') || l.includes('vl') || l.includes('gpt-4o') || l.includes('gemini-1.5') || l.includes('gemini-2') || l.includes('claude-3');
    const embedding = l.includes('embed') || l.includes('bge') || l.includes('nomic');
    return { thinking, tools, vision, embedding };
}

export const DEFAULT_EXCLUSIONS = [
    'node_modules', 'out', 'dist', 'target', 'build', 'coverage',
    '.git', '.gemini', '.cache', 'venv', '.venv'
];

export class ConnectionStore {
    constructor(private readonly context: vscode.ExtensionContext) { }

    async init(): Promise<void> {
        const isInitialized = this.context.globalState.get<boolean>('giskard_initialized_v1', false);
        if (!isInitialized) {
            const connections = this._getRawList();
            if (connections.length === 0) {
                const defaultConn: Connection = {
                    id: 1,
                    name: 'Backend Local (Default)',
                    type: 'local',
                    url: 'http://localhost:3500',
                    tag: 'giskard-sys',
                    secretRef: null,
                    isActive: true,
                    createdAt: new Date().toISOString()
                };
                await this.context.globalState.update(STORAGE_KEY, [defaultConn]);
            }
            await this.context.globalState.update('giskard_initialized_v1', true);
        }

        // Seed default local sovereign MCP server if empty
        const mcpServers = this.getMcpServers();
        if (mcpServers.length === 0) {
            const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || './';
            const defaultMcp: McpServer = {
                id: 1,
                name: 'Servidor MCP Filesystem & Memory',
                type: 'stdio',
                commandOrUrl: `npx -y @modelcontextprotocol/server-filesystem ${wsPath}`,
                isActive: true,
                tools: [
                    { id: 'read_file', name: 'read_file', description: 'Lectura de archivos del workspace', enabled: true },
                    { id: 'write_file', name: 'write_file', description: 'Escritura atómica en workspace', enabled: true },
                    { id: 'search_files', name: 'search_files', description: 'Búsqueda por patrón en workspace', enabled: true },
                    { id: 'directory_tree', name: 'directory_tree', description: 'Árbol recursivo de directorios', enabled: true }
                ],
                createdAt: new Date().toISOString()
            };
            await this.context.globalState.update(MCP_STORAGE_KEY, [defaultMcp]);
        }
    }

    private _cachedTokenMap: Map<string, { apiKey: string; url?: string }> = new Map();

    clearTokenCache() {
        this._cachedTokenMap.clear();
    }

    private _getRawList(): Connection[] {
        return this.context.globalState.get<Connection[]>(STORAGE_KEY, []);
    }

    private async _saveRawList(connections: Connection[]): Promise<void> {
        this.clearTokenCache();
        await this.context.globalState.update(STORAGE_KEY, connections);
    }

    /** Return all saved connections, active first */
    getAll(): Connection[] {
        const list = this._getRawList();
        return list.slice().sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    }

    /** Get active selected model for Chat */
    getActiveChatModel(): string | undefined {
        return this.context.globalState.get<string>('giskard_active_chat_model');
    }

    /** Set active selected model for Chat */
    async setActiveChatModel(model: string): Promise<void> {
        await this.context.globalState.update('giskard_active_chat_model', model);
    }

    /** Get array of multi-selected enabled models for Chat dropdown */
    getEnabledModels(): string[] {
        const raw = this.context.globalState.get<string[]>('giskard_enabled_chat_models_v1') || [];
        return raw.filter(m => typeof m === 'string' && m.trim().length > 0 && m !== '[object Object]');
    }

    /** Check if a specific model is enabled (Default: FALSE / Disabled) */
    isModelEnabled(modelName: string): boolean {
        const list = this.getEnabledModels();
        return list.includes(modelName);
    }

    /** Toggle multi-selected enabled state for a model */
    async toggleModelEnabled(modelName: string): Promise<boolean> {
        const current = this.getEnabledModels();
        let list = [...current];
        const index = list.indexOf(modelName);
        let newState = false;
        if (index >= 0) {
            list.splice(index, 1);
            newState = false;
        } else {
            list.push(modelName);
            newState = true;
        }

        await this.context.globalState.update('giskard_enabled_chat_models_v1', list);
        return newState;
    }

    /** Remove a model from enabled list and purge its saved settings */
    async removeEnabledModel(modelName: string): Promise<void> {
        const current = this.getEnabledModels();
        const list = current.filter(m => m !== modelName);
        await this.context.globalState.update('giskard_enabled_chat_models_v1', list);
        await this.removeModelOverrides(modelName);
    }

    /** Add a new connection profile */
    async addConnection(
        name: string,
        type: 'local' | 'remote',
        url: string,
        tag: string,
        apiKey?: string
    ): Promise<number> {
        let secretRef: string | null = null;
        if (apiKey && apiKey.trim()) {
            secretRef = `conn_${Date.now()}_token`;
            await this.context.secrets.store(secretRef, apiKey.trim());
        }

        const list = this._getRawList();
        // Deactivate previous connections so the newly created profile becomes the active one
        list.forEach(c => c.isActive = false);

        const newId = Date.now();
        const newConn: Connection = {
            id: newId,
            name: name.trim(),
            type,
            url: url.trim().replace(/\/$/, ''),
            tag: tag.trim(),
            secretRef,
            isActive: true,
            createdAt: new Date().toISOString()
        };

        list.push(newConn);
        await this._saveRawList(list);
        return newId;
    }

    /** Retrieve stored API key secret for a connection */
    async getApiKey(id: number): Promise<string | undefined> {
        const list = this._getRawList();
        const conn = list.find(c => c.id === id);
        if (conn && conn.secretRef) {
            return await this.context.secrets.get(conn.secretRef);
        }
        return undefined;
    }

    /** Save or update API key secret for a connection */
    async saveApiKey(id: number, apiKey: string): Promise<void> {
        const list = this._getRawList();
        const conn = list.find(c => c.id === id);
        if (!conn) return;
        if (!conn.secretRef) {
            conn.secretRef = `conn_${id}_token`;
        }
        await this.context.secrets.store(conn.secretRef, apiKey.trim());
        await this._saveRawList(list);
    }

    /** Remove a connection profile and its stored secret */
    async removeConnection(id: number): Promise<void> {
        let list = this._getRawList();
        const target = list.find(c => c.id === id);
        if (!target) return;

        if (target.secretRef) {
            try {
                await this.context.secrets.delete(target.secretRef);
            } catch { }
        }

        const wasActive = target.isActive;
        list = list.filter(c => c.id !== id);

        // If removed connection was active, activate the first remaining connection
        if (wasActive && list.length > 0) {
            list[0].isActive = true;
        }

        if (list.length === 0) {
            await this.context.globalState.update('giskard_enabled_chat_models_v1', []);
        }

        await this._saveRawList(list);
    }

    /** Toggle active state for a connection profile (allows multiple active profiles) */
    async toggleActive(id: number): Promise<void> {
        const list = this._getRawList();
        const conn = list.find(c => c.id === id);
        if (conn) {
            conn.isActive = !conn.isActive;
            await this._saveRawList(list);
        }
    }

    /** Mark or toggle a connection as active */
    async setActive(id: number): Promise<void> {
        await this.toggleActive(id);
    }

    /** Get active remote connection profile */
    getActiveRemote(): Connection | null {
        const list = this._getRawList();
        return list.find(c => c.isActive && (c.type === 'remote' || ['nvidia', 'deepseek', 'kimi', 'qwen', 'openai'].includes(c.tag))) || null;
    }

    /** Get active local connection profile (giskard-sys or ollama) */
    getActiveLocal(): Connection | null {
        const list = this._getRawList();
        return list.find(c => c.isActive && (c.type === 'local' || c.tag === 'giskard-sys' || c.tag === 'ollama')) || null;
    }

    /** Get the primary active connection, or null */
    getActive(): Connection | null {
        const list = this._getRawList();
        const active = list.find(c => c.isActive);
        if (active) return active;
        if (list.length > 0) return list[0];
        return null;
    }

    /** Find connection profile by exact provider tag (e.g. 'nvidia', 'openai', 'deepseek', 'giskard-sys', 'ollama') */
    getConnectionByTag(tag: string): Connection | null {
        const cleanTag = (tag || '').toLowerCase().trim();
        if (!cleanTag) return null;
        const list = this._getRawList();
        return list.find(c => (c.tag || '').toLowerCase().trim() === cleanTag) || null;
    }

    /** Robust API key lookup with session RAM cache: tries exact tag match, active connection, then any saved secret in SecretStorage */
    async getAnyRemoteApiKey(providerTag?: string): Promise<{ apiKey: string; url?: string } | null> {
        const cleanTag = (providerTag || '').toLowerCase().trim();
        const cacheKey = cleanTag || '__default__';

        if (this._cachedTokenMap.has(cacheKey)) {
            return this._cachedTokenMap.get(cacheKey)!;
        }

        const list = this._getRawList();

        // 1. Exact tag match
        if (cleanTag) {
            const tagConn = list.find(c => (c.tag || '').toLowerCase().trim() === cleanTag);
            if (tagConn && tagConn.secretRef) {
                const key = await this.context.secrets.get(tagConn.secretRef);
                if (key && key.trim()) {
                    const result = { apiKey: key.trim(), url: tagConn.url };
                    this._cachedTokenMap.set(cacheKey, result);
                    return result;
                }
            }
        }

        // 2. Active connection
        const active = this.getActive();
        if (active && active.secretRef) {
            const key = await this.context.secrets.get(active.secretRef);
            if (key && key.trim()) {
                const result = { apiKey: key.trim(), url: active.url };
                this._cachedTokenMap.set(cacheKey, result);
                return result;
            }
        }

        // 3. Any saved connection with a secret in SecretStorage
        for (const conn of list) {
            if (conn.secretRef) {
                const key = await this.context.secrets.get(conn.secretRef);
                if (key && key.trim()) {
                    const result = { apiKey: key.trim(), url: conn.url };
                    this._cachedTokenMap.set(cacheKey, result);
                    return result;
                }
            }
        }

        return null;
    }

    /** Retrieve the API token for the active connection, if any */
    async getActiveToken(): Promise<string | null> {
        const active = this.getActive();
        if (!active || !active.secretRef) return null;
        return (await this.context.secrets.get(active.secretRef)) || null;
    }

    // ── MCP Server Storage ───────────────────────────────────────────────────

    getMcpServers(): McpServer[] {
        return this.context.globalState.get<McpServer[]>(MCP_STORAGE_KEY, []);
    }

    async addMcpServer(name: string, type: 'docker' | 'stdio' | 'url', commandOrUrl: string): Promise<number> {
        const list = this.getMcpServers();
        const newId = Date.now();
        const newMcp: McpServer = {
            id: newId,
            name: name.trim(),
            type,
            commandOrUrl: commandOrUrl.trim(),
            isActive: true,
            createdAt: new Date().toISOString()
        };
        list.push(newMcp);
        await this.context.globalState.update(MCP_STORAGE_KEY, list);
        return newId;
    }

    async removeMcpServer(id: number): Promise<void> {
        const list = this.getMcpServers().filter(s => s.id !== id);
        await this.context.globalState.update(MCP_STORAGE_KEY, list);
    }

    async toggleMcpServer(id: number): Promise<boolean> {
        const list = [...this.getMcpServers()];
        const target = list.find(s => s.id === id);
        let newState = false;
        if (target) {
            target.isActive = !target.isActive;
            newState = target.isActive;
            await this.context.globalState.update(MCP_STORAGE_KEY, list);
        }
        return newState;
    }

    async updateMcpTools(id: number, tools: McpTool[]): Promise<void> {
        const list = this.getMcpServers();
        const target = list.find(s => s.id === id);
        if (target) {
            target.tools = tools;
            await this.context.globalState.update(MCP_STORAGE_KEY, list);
        }
    }

    async toggleMcpTool(serverId: number, toolId: string): Promise<boolean> {
        const list = [...this.getMcpServers()];
        const target = list.find(s => s.id === serverId);
        let newState = false;
        if (target && target.tools) {
            const tool = target.tools.find(t => t.id === toolId || t.name === toolId);
            if (tool) {
                tool.enabled = tool.enabled === false ? true : false;
                newState = tool.enabled;
                await this.context.globalState.update(MCP_STORAGE_KEY, list);
            }
        }
        return newState;
    }

    // ── Exclusion Patterns Storage ─────────────────────────────────────────────

    getExclusionPatterns(): string[] {
        return this.context.globalState.get<string[]>(EXCLUSION_STORAGE_KEY, DEFAULT_EXCLUSIONS);
    }

    async saveExclusionPatterns(patterns: string[]): Promise<void> {
        const clean = patterns
            .map(p => p.trim().replace(/^\*\*\//, '').replace(/\/$/, ''))
            .filter(Boolean);
        await this.context.globalState.update(EXCLUSION_STORAGE_KEY, clean);
    }

    // ── Model Overrides Storage ─────────────────────────────────────────────

    getModelOverrides(modelName: string): ModelSettings {
        const allMap = this.context.globalState.get<Record<string, ModelSettings>>(MODEL_OVERRIDES_STORAGE_KEY, {});
        return allMap[modelName] || { ...DEFAULT_MODEL_SETTINGS };
    }

    async saveModelOverrides(modelName: string, settings: Partial<ModelSettings>): Promise<void> {
        const allMap = this.context.globalState.get<Record<string, ModelSettings>>(MODEL_OVERRIDES_STORAGE_KEY, {});
        const current = allMap[modelName] || { ...DEFAULT_MODEL_SETTINGS };
        allMap[modelName] = { ...current, ...settings };
        await this.context.globalState.update(MODEL_OVERRIDES_STORAGE_KEY, allMap);
    }

    /** Delete stored hyperparameter overrides for a specific model name */
    async removeModelOverrides(modelName: string): Promise<void> {
        const allMap = this.context.globalState.get<Record<string, ModelSettings>>(MODEL_OVERRIDES_STORAGE_KEY, {});
        if (allMap[modelName]) {
            delete allMap[modelName];
            await this.context.globalState.update(MODEL_OVERRIDES_STORAGE_KEY, allMap);
        }
    }

    dispose(): void {
        // No teardown needed for globalState
    }
}
