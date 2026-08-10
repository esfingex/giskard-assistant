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

            const isEnabled = Boolean(rawData?.isEnabled);
            this.description = badges.trim();
            this.iconPath = isEnabled
                ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('circle-outline');
            this.contextValue = isEnabled ? 'enabledLocalModel' : 'disabledLocalModel';
            this.tooltip = `Model: ${label}\nStatus: ${isEnabled ? '🟢 Active in Chat' : '⚪ Disabled'}`;

            this.command = {
                command: 'giskard-assistant.toggleModelForChat',
                title: 'Toggle Model for Chat',
                arguments: [label]
            };
        } else if (itemType === 'remote-conn') {
            const activeTag = rawData?.tag || 'AI';
            this.description = `[${activeTag.toUpperCase()}]`;
            this.iconPath = rawData?.isActive
                ? new vscode.ThemeIcon('cloud', new vscode.ThemeColor('testing.iconPassed'))
                : new vscode.ThemeIcon('cloud-offline');
            this.contextValue = 'remoteConn';
            this.tooltip = `Connection: ${rawData?.name}\nURL: ${rawData?.url}\nStatus: ${rawData?.isActive ? '🟢 Active' : '⚪ Standby (Click to toggle)'}`;
            this.command = {
                command: 'giskard-assistant.toggleConnectionActive',
                title: 'Toggle Connection Active State',
                arguments: [rawData?.id]
            };
        } else if (itemType === 'memory-bcf') {
            this.description = 'BCF Sovereign Graph';
            this.iconPath = new vscode.ThemeIcon('graph');
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

    setCapabilityFilter(capability: string): void {
        this.activeCapabilityFilter = capability;
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
        const modelsList = Array.isArray(element?.rawData) ? element?.rawData : element?.rawData?.models;
        if (element && element.itemType === 'header' && Array.isArray(modelsList)) {
            return modelsList.map((m: string) => new GiskardTreeItem(
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
                    const item = new GiskardTreeItem(
                        title,
                        vscode.TreeItemCollapsibleState.Expanded,
                        'header',
                        { id: grp.connectionId, connectionId: grp.connectionId, connectionName: grp.connectionName, models: matchingModels }
                    );
                    item.iconPath = new vscode.ThemeIcon('server');
                    item.contextValue = 'connectionHeaderGroup';

                    let filterTag = '';
                    if (this.activeCapabilityFilter && this.activeCapabilityFilter !== 'all') {
                        const iconMap: Record<string, string> = { reasoning: '🧠 Reasoning', tools: '🛠️ Tools', vision: '👁️ Vision', embedding: '🧩 Embedding' };
                        filterTag += iconMap[this.activeCapabilityFilter] || this.activeCapabilityFilter;
                    }
                    if (this.activeSearchQuery && this.activeSearchQuery.trim()) {
                        filterTag += (filterTag ? ' | ' : '') + `🔍 "${this.activeSearchQuery.trim()}"`;
                    }
                    if (filterTag) {
                        item.description = `[Filter: ${filterTag}]`;
                    }

                    filteredGroups.push(item);
                }
            }

            if (filteredGroups.length === 0) {
                const msg = `No models match filter (${this.activeCapabilityFilter} / "${this.activeSearchQuery}")`;
                return [new GiskardTreeItem(msg, vscode.TreeItemCollapsibleState.None, 'header')];
            }

            return filteredGroups;
        } catch (err: any) {
            return [new GiskardTreeItem(`Error loading models: ${err.message}`, vscode.TreeItemCollapsibleState.None, 'header')];
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
            { label: '🌙 Sovereign Cyberpunk Dark', icon: 'color-mode', preset: 'purple' },
            { label: '🔮 Deep Neon Glassmorphic', icon: 'symbol-color', preset: 'cyan' },
            { label: '☀️ Clean Studio Light', icon: 'sun', preset: 'white' },
            { label: '🌌 Midnight Emerald', icon: 'sparkle', preset: 'emerald' }
        ];
        return themes.map(t => {
            const item = new GiskardTreeItem(t.label, vscode.TreeItemCollapsibleState.None, 'header', t);
            item.iconPath = new vscode.ThemeIcon(t.icon);
            item.contextValue = 'themeItem';
            item.command = {
                command: 'giskard-assistant.selectThemeTree',
                title: 'Apply Visual Theme',
                arguments: [t.preset]
            };
            return item;
        });
    }
}

export class GiskardMcpServersTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
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
        if (!element) {
            const servers = this.store.getMcpServers();
            if (servers.length === 0) {
                return [new GiskardTreeItem('No MCP Servers configured', vscode.TreeItemCollapsibleState.None, 'header')];
            }
            return servers.map(s => {
                const item = new GiskardTreeItem(
                    s.name,
                    s.tools && s.tools.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    'header',
                    s
                );
                const totalTools = s.tools ? s.tools.length : 0;
                const activeTools = s.tools ? s.tools.filter((t: any) => t.enabled !== false).length : 0;
                const toolsBadge = totalTools > 0 ? `[${activeTools}/${totalTools} active] ` : '';
                item.description = `${toolsBadge}${s.commandOrUrl}`;
                item.iconPath = s.isActive
                    ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
                    : new vscode.ThemeIcon('circle-outline');
                item.contextValue = 'mcpServer';

                const tooltip = new vscode.MarkdownString();
                tooltip.appendMarkdown(`**MCP Server:** ${s.name}\n\n`);
                tooltip.appendMarkdown(`- **Type:** \`${s.type.toUpperCase()}\`\n`);
                tooltip.appendMarkdown(`- **Status:** ${s.isActive ? '🟢 Active' : '⚪ Disabled'}\n`);
                tooltip.appendMarkdown(`- **Command/URL:** \`${s.commandOrUrl}\`\n`);
                if (s.tools && s.tools.length > 0) {
                    tooltip.appendMarkdown(`- **Tools Discovered:** ${s.tools.length}\n`);
                }
                item.tooltip = tooltip;
                return item;
            });
        }

        if (element.rawData && element.rawData.tools) {
            const serverId = element.rawData.id;
            const tools = element.rawData.tools;
            return tools.map((t: any) => {
                const isEnabled = t.enabled !== false;
                const toolId = t.id || t.name;
                const item = new GiskardTreeItem(
                    t.name,
                    vscode.TreeItemCollapsibleState.None,
                    'header',
                    { serverId, toolId, tool: t }
                );
                item.description = t.description || 'MCP Tool';
                item.iconPath = isEnabled
                    ? new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('testing.iconPassed'))
                    : new vscode.ThemeIcon('circle-outline');
                item.contextValue = 'mcpTool';

                const tooltip = new vscode.MarkdownString();
                tooltip.appendMarkdown(`**MCP Tool:** \`${t.name}\`\n\n`);
                tooltip.appendMarkdown(`- **Status:** ${isEnabled ? '🟢 Active' : '⚪ Disabled'}\n`);
                tooltip.appendMarkdown(`- **Description:** ${t.description || 'No description provided'}\n`);
                item.tooltip = tooltip;

                item.command = {
                    command: 'giskard-assistant.toggleMcpToolTree',
                    title: 'Enable / Disable MCP Tool',
                    arguments: [{ serverId, toolId }]
                };
                return item;
            });
        }

        return [];
    }
}

export class GiskardFileExclusionsTreeProvider implements vscode.TreeDataProvider<GiskardTreeItem> {
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
        const patterns = this.store.getExclusionPatterns();
        if (patterns.length === 0) {
            return [new GiskardTreeItem('No exclusion patterns configured', vscode.TreeItemCollapsibleState.None, 'header')];
        }
        return patterns.map(p => {
            const item = new GiskardTreeItem(`🚫 ${p}`, vscode.TreeItemCollapsibleState.None, 'header', p);
            item.iconPath = new vscode.ThemeIcon('exclude');
            item.contextValue = 'exclusionPattern';
            item.command = {
                command: 'giskard-assistant.removeExclusionPatternTree',
                title: 'Eliminar Patrón de Exclusión',
                arguments: [p]
            };
            return item;
        });
    }
}
