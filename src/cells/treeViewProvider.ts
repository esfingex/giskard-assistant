/**
 * Giskard Assistant VSCode Extension — Module: Sidebar Tree View Provider
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { ConnectionStore, getModelCapabilities } from '../core/connectionStore';
import { fetchLlmModelsGrouped } from '../core/api';

export class GiskardTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'local-model' | 'remote-conn' | 'memory-bcf' | 'header',
        public readonly rawData?: any
    ) {
        super(label, collapsibleState);

        if (itemType === 'local-model') {
            const caps = getModelCapabilities(label);
            let badges = '';
            if (caps.thinking) badges += '🧠 ';
            if (caps.tools) badges += '🛠️ ';
            if (caps.vision) badges += '👁️ ';
            if (caps.embedding) badges += '🧩 ';
            this.description = badges ? badges.trim() : 'Local AI Model';
            this.iconPath = new vscode.ThemeIcon('server-environment');
            this.contextValue = 'localModel';
        } else if (itemType === 'remote-conn') {
            const activeTag = rawData?.tag || 'AI';
            this.description = rawData?.isActive ? `🟢 Active [${activeTag.toUpperCase()}]` : `⚪ [${activeTag.toUpperCase()}]`;
            this.iconPath = new vscode.ThemeIcon(rawData?.isActive ? 'cloud' : 'cloud-offline');
            this.contextValue = 'remoteConn';
        } else if (itemType === 'memory-bcf') {
            this.description = 'BCF Sovereign Graph';
            this.iconPath = new vscode.ThemeIcon('graph');
            this.contextValue = 'memoryBcf';
        }

        if (itemType === 'local-model' || itemType === 'remote-conn') {
            this.command = {
                command: 'giskard-assistant.openChat',
                title: 'Abrir Chat'
            };
        }
    }
}

export class GiskardLocalModelsTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GiskardTreeItem | undefined | null | void> = new vscode.EventEmitter<GiskardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GiskardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private readonly store: ConnectionStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GiskardTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GiskardTreeItem): Promise<GiskardTreeItem[]> {
        if (element) return [];

        try {
            const groups = await fetchLlmModelsGrouped();
            const items: GiskardTreeItem[] = [];

            if (groups && groups.length > 0) {
                groups.forEach((grp) => {
                    grp.models.forEach((m) => {
                        items.push(new GiskardTreeItem(m, vscode.TreeItemCollapsibleState.None, 'local-model', grp));
                    });
                });
            }

            if (items.length === 0) {
                items.push(new GiskardTreeItem('No models detected', vscode.TreeItemCollapsibleState.None, 'header'));
            }

            return items;
        } catch {
            return [new GiskardTreeItem('Local AI (127.0.0.1)', vscode.TreeItemCollapsibleState.None, 'header')];
        }
    }
}

export class GiskardRemoteConnsTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GiskardTreeItem | undefined | null | void> = new vscode.EventEmitter<GiskardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GiskardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private readonly store: ConnectionStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GiskardTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GiskardTreeItem): Promise<GiskardTreeItem[]> {
        if (element) return [];
        const conns = this.store.getAll();
        if (conns.length === 0) {
            return [new GiskardTreeItem('No saved connection profiles', vscode.TreeItemCollapsibleState.None, 'header')];
        }
        return conns.map(c => new GiskardTreeItem(c.name, vscode.TreeItemCollapsibleState.None, 'remote-conn', c));
    }
}
