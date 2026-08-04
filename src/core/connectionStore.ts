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

const STORAGE_KEY = 'giskard_connections_v1';

export class ConnectionStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

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

    /** Remove a connection profile and its stored secret */
    async removeConnection(id: number): Promise<void> {
        let list = this._getRawList();
        const target = list.find(c => c.id === id);
        if (!target) return;

        if (target.secretRef) {
            try {
                await this.context.secrets.delete(target.secretRef);
            } catch {}
        }

        const wasActive = target.isActive;
        list = list.filter(c => c.id !== id);

        // If removed connection was active, activate the first remaining connection
        if (wasActive && list.length > 0) {
            list[0].isActive = true;
        }

        await this._saveRawList(list);
    }

    /** Mark a connection as active (only one active at a time) */
    async setActive(id: number): Promise<void> {
        const list = this._getRawList();
        let updated = false;
        for (const c of list) {
            if (c.id === id) {
                c.isActive = true;
                updated = true;
            } else {
                c.isActive = false;
            }
        }
        if (updated) {
            await this._saveRawList(list);
        }
    }

    /** Get the currently active connection, or null */
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

    dispose(): void {
        // No teardown needed for globalState
    }
}
