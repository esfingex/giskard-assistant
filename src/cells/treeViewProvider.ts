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

            const isEnabled = rawData?.isEnabled !== false;
            this.description = isEnabled ? `🟢 Activo en Chat ${badges}`.trim() : `⚪ Desactivado ${badges}`.trim();
            this.iconPath = isEnabled
                ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('circle-outline');
            this.contextValue = isEnabled ? 'enabledLocalModel' : 'disabledLocalModel';

            this.command = {
                command: 'giskard-assistant.toggleModelForChat',
                title: 'Activar/Desactivar Modelo para Chat',
                arguments: [label]
            };
        } else if (itemType === 'remote-conn') {
            const activeTag = rawData?.tag || 'AI';
            this.description = rawData?.isActive ? `🟢 Active [${activeTag.toUpperCase()}]` : `⚪ [${activeTag.toUpperCase()}]`;
            this.iconPath = new vscode.ThemeIcon(rawData?.isActive ? 'cloud' : 'cloud-offline');
            this.contextValue = 'remoteConn';
            this.command = {
                command: 'giskard-assistant.openChat',
                title: 'Abrir Chat'
            };
        } else if (itemType === 'memory-bcf') {
            this.description = 'BCF Sovereign Graph';
            this.iconPath = new vscode.ThemeIcon('graph');
            this.contextValue = 'memoryBcf';
        }
    }
}

export class GiskardLocalModelsTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GiskardTreeItem | undefined | null | void> = new vscode.EventEmitter<GiskardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GiskardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private activeCapabilityFilter: string = 'all';
    private activeSearchQuery: string = '';

    constructor(private readonly store: ConnectionStore) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setCapabilityFilter(filter: string): void {
        this.activeCapabilityFilter = filter;
        this.refresh();
    }

    setSearchQuery(query: string): void {
        this.activeSearchQuery = query;
        this.refresh();
    }

    getTreeItem(element: GiskardTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GiskardTreeItem): Promise<GiskardTreeItem[]> {
        const enabledModels = this.store.getEnabledModels();

        // If child of a connection group, return models in that group
        if (element && element.itemType === 'header' && Array.isArray(element.rawData)) {
            return element.rawData.map(m => new GiskardTreeItem(
                m,
                vscode.TreeItemCollapsibleState.None,
                'local-model',
                { isEnabled: enabledModels.includes(m) }
            ));
        }

        // Root level: return connection groups
        try {
            const groups = await fetchLlmModelsGrouped();
            if (!groups || groups.length === 0) {
                return [new GiskardTreeItem('No connections/models detected', vscode.TreeItemCollapsibleState.None, 'header')];
            }

            const filteredGroups: GiskardTreeItem[] = [];

            for (const grp of groups) {
                let matchingModels = grp.models;

                // 1. Filter by Capability
                if (this.activeCapabilityFilter && this.activeCapabilityFilter !== 'all') {
                    matchingModels = matchingModels.filter(m => {
                        const caps = getModelCapabilities(m);
                        if (this.activeCapabilityFilter === 'reasoning') return caps.thinking;
                        if (this.activeCapabilityFilter === 'tools') return caps.tools;
                        if (this.activeCapabilityFilter === 'vision') return caps.vision;
                        if (this.activeCapabilityFilter === 'embedding') return caps.embedding;
                        return true;
                    });
                }

                // 2. Filter by Search Query
                if (this.activeSearchQuery && this.activeSearchQuery.trim()) {
                    const q = this.activeSearchQuery.toLowerCase().trim();
                    matchingModels = matchingModels.filter(m => m.toLowerCase().includes(q));
                }

                if (matchingModels.length > 0) {
                    const tagUpper = (grp.connectionTag || 'AI').toUpperCase();
                    const title = `${grp.connectionName} [${tagUpper}] (${matchingModels.length})`;
                    const item = new GiskardTreeItem(title, vscode.TreeItemCollapsibleState.Expanded, 'header', matchingModels);
                    item.iconPath = new vscode.ThemeIcon('server');
                    filteredGroups.push(item);
                }
            }

            if (filteredGroups.length === 0) {
                const msg = `No models match filter (${this.activeCapabilityFilter} / "${this.activeSearchQuery}")`;
                return [new GiskardTreeItem(msg, vscode.TreeItemCollapsibleState.None, 'header')];
            }

            return filteredGroups;
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

export class GiskardThemePaletteTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GiskardTreeItem | undefined | null | void> = new vscode.EventEmitter<GiskardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GiskardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: GiskardTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GiskardTreeItem): Promise<GiskardTreeItem[]> {
        if (element) return [];
        const themes = [
            { label: '🌙 Sovereign Cyberpunk Dark', icon: 'color-mode' },
            { label: '🔮 Deep Neon Glassmorphic', icon: 'symbol-color' },
            { label: '☀️ Clean Studio Light', icon: 'sun' },
            { label: '🌌 Midnight Emerald', icon: 'sparkle' }
        ];
        return themes.map(t => {
            const item = new GiskardTreeItem(t.label, vscode.TreeItemCollapsibleState.None, 'header');
            item.iconPath = new vscode.ThemeIcon(t.icon);
            return item;
        });
    }
}
