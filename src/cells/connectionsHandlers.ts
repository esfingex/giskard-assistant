/**
 * Giskard Assistant VSCode Extension — Connections Handlers
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 2).
 * Handles the connection lifecycle surfaced in the chat webview:
 * list, add, remove, reset, activate and URL reachability test.
 *
 * Functions are pure of `this` — they receive the context explicitly.
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { fetchWithTimeout, getClientId } from '../core/api';
import { HostToWebviewMessage } from '../core/webviewContract';

/** Explicit dependency bag passed by the chat cell. */
export interface ConnectionsContext {
    view?: vscode.WebviewView;
    panel?: vscode.WebviewPanel;
    store: ConnectionStore;
    postMessage(message: HostToWebviewMessage): void;
    refreshState(): Promise<void>;
}

function hasSurface(ctx: ConnectionsContext): boolean {
    return Boolean(ctx.view || ctx.panel);
}

export async function sendConnectionsList(ctx: ConnectionsContext): Promise<void> {
    if (!hasSurface(ctx)) return;
    const connections = ctx.store.getAll();
    ctx.postMessage({ type: 'connectionsLoaded', connections });
}

export async function handleAddConnection(
    ctx: ConnectionsContext,
    data: { name: string; connType: 'local' | 'remote'; url: string; tag: string; apiKey?: string }
): Promise<void> {
    if (!hasSurface(ctx)) return;
    try {
        const id = await ctx.store.addConnection(data.name, data.connType, data.url, data.tag, data.apiKey);
        vscode.window.showInformationMessage(`✓ Conexión "${data.name}" guardada.`);
        await ctx.store.setActive(id);
        await ctx.refreshState();
    } catch (err: any) {
        ctx.postMessage({ type: 'connectionError', error: err.message });
        vscode.window.showErrorMessage(`Error guardando conexión: ${err.message}`);
    }
}

export async function handleRemoveConnection(ctx: ConnectionsContext, id: number): Promise<void> {
    if (!hasSurface(ctx)) return;
    try {
        await ctx.store.removeConnection(id);
        vscode.window.showInformationMessage(`✓ Connection deleted.`);
        await ctx.refreshState();
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error deleting connection: ${err.message}`);
    }
}

export async function handleResetConnections(ctx: ConnectionsContext): Promise<void> {
    if (!hasSurface(ctx)) return;
    try {
        const list = ctx.store.getAll();
        for (const c of list) {
            await ctx.store.removeConnection(c.id);
        }
        await ctx.store.init();
        vscode.window.showInformationMessage(`✓ All connection profiles reset.`);
        await ctx.refreshState();
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error resetting connections: ${err.message}`);
    }
}

export async function handleActivateConnection(ctx: ConnectionsContext, id: number): Promise<void> {
    if (!hasSurface(ctx)) return;
    try {
        await ctx.store.setActive(id);
        const active = ctx.store.getActive();
        const url = active?.url || 'desconocida';
        vscode.window.showInformationMessage(`✓ Conexión activa: ${active?.name || url}`);
        await ctx.refreshState();
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error activando conexión: ${err.message}`);
    }
}

export async function handleTestConnectionUrl(ctx: ConnectionsContext, url: string): Promise<void> {
    if (!hasSurface(ctx)) return;
    const start = Date.now();
    try {
        const cleanUrl = url.trim().replace(/\/$/, '');
        let res = await fetchWithTimeout(
            `${cleanUrl}/health`,
            {
                headers: { 'X-Client-Id': getClientId() }
            },
            5000
        ).catch(() => null);

        if (!res || !res.ok) {
            res = await fetchWithTimeout(cleanUrl, {}, 5000).catch(() => null);
        }

        const ms = Date.now() - start;
        const ok = Boolean(
            res &&
            (res.ok || res.status === 200 || res.status === 401 || res.status === 404 || res.status === 405)
        );
        let statusText = `HTTP ${res?.status}`;
        if (res?.status === 401) statusText += ' (Requiere API Key)';
        ctx.postMessage({
            type: 'connectionTested',
            ok,
            status: res?.status,
            ms,
            error: ok ? undefined : res ? statusText : 'Servidor no responde en esa URL'
        });
    } catch (err: any) {
        const ms = Date.now() - start;
        let reason = err.message;
        if (err.name === 'AbortError') reason = 'Timeout — sin respuesta en 5 segundos';
        else if (err.message.includes('ECONNREFUSED'))
            reason = 'Conexión rechazada — verifica que el servidor esté activo';
        else if (err.message.includes('ENOTFOUND')) reason = 'Host no encontrado — verifica la URL';

        ctx.postMessage({
            type: 'connectionTested',
            ok: false,
            error: reason,
            ms
        });
    }
}
