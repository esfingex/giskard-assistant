/**
 * Giskard Assistant VSCode Extension — Module: Status Bar Heartbeat & Health Indicator
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';

export class GiskardStatusBar {
    private _item: vscode.StatusBarItem;

    constructor(private readonly store: ConnectionStore) {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._item.command = 'giskard-assistant.openChat';
        this.updateStatus(true);
        this._item.show();
    }

    public updateStatus(online: boolean, activeModel?: string) {
        const active = this.store.getActive();
        const connName = active ? active.name : 'Local AI';
        const modelLabel = activeModel ? ` (${activeModel})` : '';

        if (online) {
            this._item.text = `$(pulse) Giskard: ${connName}${modelLabel}`;
            this._item.tooltip = `Giskard Assistant Online | Active Connection: ${connName} (${active?.url || 'http://localhost:3500'}). Click to open Chat.`;
            this._item.backgroundColor = undefined;
        } else {
            this._item.text = `$(warning) Giskard: Offline`;
            this._item.tooltip = `Giskard Assistant Offline | Failed to connect to ${connName}. Click to open Chat & re-check.`;
            this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
    }

    public dispose() {
        this._item.dispose();
    }
}
