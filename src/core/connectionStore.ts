/**
 * Giskard Assistant VSCode Extension — Core: Connection Store
 * Copyright (C) 2025  Giskard Project — GPL-3.0
 *
 * Manages persistent connection profiles in SQLite (via sql.js WASM).
 * API keys are stored in vscode.SecretStorage (OS keychain), never in SQLite.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

export class ConnectionStore {
    private db: any = null;
    private SQL: any = null;
    private readonly dbPath: string;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Use VS Code's globalStorageUri for cross-platform safe path
        this.dbPath = path.join(context.globalStorageUri.fsPath, 'connections.db');
    }

    async init(): Promise<void> {
        // Ensure storage directory exists
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Init sql.js — point WASM at extension's node_modules
        const initSqlJs = require('sql.js');
        this.SQL = await initSqlJs({
            locateFile: (filename: string) =>
                path.join(this.context.extensionPath, 'node_modules', 'sql.js', 'dist', filename)
        });

        // Load existing DB or create fresh
        if (fs.existsSync(this.dbPath)) {
            const fileBuffer = fs.readFileSync(this.dbPath);
            this.db = new this.SQL.Database(fileBuffer);
        } else {
            this.db = new this.SQL.Database();
        }

        this.db.run(`
            CREATE TABLE IF NOT EXISTS connections (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                type       TEXT NOT NULL CHECK(type IN ('local','remote')),
                url        TEXT NOT NULL,
                tag        TEXT NOT NULL,
                secret_ref TEXT,
                is_active  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        this._persist();
    }

    /** Flush in-memory DB to disk */
    private _persist(): void {
        if (!this.db) return;
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
    }

    /** Return all saved connections, active first */
    getAll(): Connection[] {
        if (!this.db) return [];
        const stmt = this.db.prepare(
            'SELECT * FROM connections ORDER BY is_active DESC, id ASC'
        );
        const rows: Connection[] = [];
        while (stmt.step()) {
            const r = stmt.getAsObject();
            rows.push({
                id: r.id as number,
                name: r.name as string,
                type: r.type as 'local' | 'remote',
                url: r.url as string,
                tag: r.tag as string,
                secretRef: (r.secret_ref as string) || null,
                isActive: (r.is_active as number) === 1,
                createdAt: r.created_at as string,
            });
        }
        stmt.free();
        return rows;
    }

    /** Add a new connection profile */
    async addConnection(
        name: string,
        type: 'local' | 'remote',
        url: string,
        tag: string,
        apiKey?: string
    ): Promise<number> {
        if (!this.db) throw new Error('ConnectionStore not initialized');

        let secretRef: string | null = null;
        if (type === 'remote' && apiKey && apiKey.trim()) {
            secretRef = `conn_${Date.now()}_token`;
            await this.context.secrets.store(secretRef, apiKey.trim());
        }

        this.db.run(
            'INSERT INTO connections (name, type, url, tag, secret_ref) VALUES (?, ?, ?, ?, ?)',
            [name, type.trim(), url.trim(), tag.trim(), secretRef]
        );
        this._persist();

        const result = this.db.exec('SELECT last_insert_rowid() AS id');
        return result[0].values[0][0] as number;
    }

    /** Remove a connection profile and its stored secret */
    async removeConnection(id: number): Promise<void> {
        if (!this.db) return;
        const stmt = this.db.prepare('SELECT secret_ref FROM connections WHERE id = ?');
        stmt.bind([id]);
        if (stmt.step()) {
            const r = stmt.getAsObject();
            if (r.secret_ref) {
                await this.context.secrets.delete(r.secret_ref as string);
            }
        }
        stmt.free();

        this.db.run('DELETE FROM connections WHERE id = ?', [id]);
        this._persist();
    }

    /** Mark a connection as active (only one active at a time) */
    setActive(id: number): void {
        if (!this.db) return;
        this.db.run('UPDATE connections SET is_active = 0');
        this.db.run('UPDATE connections SET is_active = 1 WHERE id = ?', [id]);
        this._persist();
    }

    /** Get the currently active connection, or null */
    getActive(): Connection | null {
        if (!this.db) return null;
        const stmt = this.db.prepare(
            'SELECT * FROM connections WHERE is_active = 1 LIMIT 1'
        );
        let result: Connection | null = null;
        if (stmt.step()) {
            const r = stmt.getAsObject();
            result = {
                id: r.id as number,
                name: r.name as string,
                type: r.type as 'local' | 'remote',
                url: r.url as string,
                tag: r.tag as string,
                secretRef: (r.secret_ref as string) || null,
                isActive: true,
                createdAt: r.created_at as string,
            };
        }
        stmt.free();
        return result;
    }

    /** Retrieve the API token for the active connection, if any */
    async getActiveToken(): Promise<string | null> {
        const active = this.getActive();
        if (!active || !active.secretRef) return null;
        return (await this.context.secrets.get(active.secretRef)) || null;
    }

    dispose(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
