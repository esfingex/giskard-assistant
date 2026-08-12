/**
 * Giskard Assistant VSCode Extension — Core EventBus Singleton
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';

export type EventMap = {
    'modelsUpdated': void;
    'modelToggled': { modelId: string; enabled: boolean };
    'connectionChanged': void;
};

export interface EventPayload {
    event: keyof EventMap;
    data?: any;
}

export class EventBus {
    private static _instance: EventBus;
    private _emitter = new vscode.EventEmitter<EventPayload>();

    public static get instance(): EventBus {
        if (!EventBus._instance) {
            EventBus._instance = new EventBus();
        }
        return EventBus._instance;
    }

    public get onDidChange(): vscode.Event<EventPayload> {
        return this._emitter.event;
    }

    public fire<T extends keyof EventMap>(event: T, data?: EventMap[T]): void {
        this._emitter.fire({ event, data });
    }
}
