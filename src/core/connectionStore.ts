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

const STORAGE_KEY = 'giskard_connections_v1';
const MCP_STORAGE_KEY = 'giskard_mcp_servers_v1';

export class ConnectionStore {
    constructor(private readonly context: vscode.ExtensionContext) { }

    async init(): Promise<void> {
        // Check if there are saved connections. If empty, seed default local backend.
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

    private _getRawList(): Connection[] {
        return this.context.globalState.get<Connection[]>(STORAGE_KEY, []);
    }

    private async _saveRawList(connections: Connection[]): Promise<void> {
        await this.context.globalState.update(STORAGE_KEY, connections);
    }

    /** Return all saved connections, active first */
    getAll(): Connection[] {
        const list = this._getRawList();
        return list.slice().sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
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
        if (type === 'remote' && apiKey && apiKey.trim()) {
            secretRef = `conn_${Date.now()}_token`;
            await this.context.secrets.store(secretRef, apiKey.trim());
        }

        const list = this._getRawList();
        const newId = Date.now();
        const isFirst = list.length === 0;

        const newConn: Connection = {
            id: newId,
            name: name.trim(),
            type,
            url: url.trim().replace(/\/$/, ''),
            tag: tag.trim(),
            secretRef,
            isActive: isFirst, // Automatically activate if it's the first connection
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

    async toggleMcpServer(id: number): Promise<void> {
        const list = this.getMcpServers();
        const target = list.find(s => s.id === id);
        if (target) {
            target.isActive = !target.isActive;
            await this.context.globalState.update(MCP_STORAGE_KEY, list);
        }
    }

    async updateMcpTools(id: number, tools: McpTool[]): Promise<void> {
        const list = this.getMcpServers();
        const target = list.find(s => s.id === id);
        if (target) {
            target.tools = tools;
            await this.context.globalState.update(MCP_STORAGE_KEY, list);
        }
    }

    async toggleMcpTool(serverId: number, toolId: string): Promise<void> {
        const list = this.getMcpServers();
        const target = list.find(s => s.id === serverId);
        if (target && target.tools) {
            const tool = target.tools.find(t => t.id === toolId);
            if (tool) {
                tool.enabled = !tool.enabled;
                await this.context.globalState.update(MCP_STORAGE_KEY, list);
            }
        }
    }

    dispose(): void {
        // No teardown needed for globalState
    }
}
