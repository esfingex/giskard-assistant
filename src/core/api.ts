/**
 * Giskard Assistant VSCode Extension — Core API & Backend Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import type { ConnectionStore } from './connectionStore';

/** Mandatory client identifier per Giskard architecture spec */
export const CLIENT_ID = 'vscode-assistant';

// Active ConnectionStore instance (set on extension activation)
let _store: ConnectionStore | null = null;

/** Inject the ConnectionStore so getConnectorUrl() resolves the active profile */
export function setConnectionStore(store: ConnectionStore): void {
    _store = store;
}

/** Returns the active backend URL — from ConnectionStore if set, else VS Code config fallback */
export function getConnectorUrl(): string {
    if (_store) {
        const active = _store.getActive();
        if (active) return active.url.replace(/\/$/, '');
    }
    const config = vscode.workspace.getConfiguration('giskard-assistant');
    return config.get<string>('connectorUrl') || 'http://localhost:3500';
}

/** Returns the mandatory X-Client-Id header value */
export function getClientId(): string {
    return CLIENT_ID;
}

/** Wrapper fetch with AbortController timeout (default 15s) */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 15000
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
}

/** Health check — GET /health with 15s timeout */
export async function checkHealth(baseUrl?: string): Promise<boolean> {
    const url = `${baseUrl || getConnectorUrl()}/health`;
    try {
        const res = await fetchWithTimeout(url, {}, 15000);
        return res.ok;
    } catch {
        return false;
    }
}

/** Reset LLM session context in giskard-assistant backend */
export async function resetSession(): Promise<void> {
    try {
        await fetchWithTimeout(`${getConnectorUrl()}/llm/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
            body: '{}'
        }, 15000);
    } catch {
        // Silent — reset is best-effort
    }
}

/** Passive workspace list check — GET /workspace/list */
export async function fetchWorkspaceList(): Promise<any> {
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/workspace/list`, {
            headers: { 'X-Client-Id': CLIENT_ID }
        }, 15000);
        return res.json();
    } catch {
        return null;
    }
}

/** Passive wave status check — POST /planning/wave/current */
export async function fetchWaveCurrent(workspacePath: string): Promise<any> {
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/planning/wave/current`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
            body: JSON.stringify({ path: workspacePath })
        }, 15000);
        return res.json();
    } catch {
        return null;
    }
}

export async function fetchSandboxList(path: string = '.') {
    const res = await fetchWithTimeout(`${getConnectorUrl()}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
        body: JSON.stringify({ path, recursive: false })
    });
    return res.json();
}

export async function fetchSandboxRead(path: string) {
    const res = await fetchWithTimeout(`${getConnectorUrl()}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
        body: JSON.stringify({ path })
    });
    return res.json();
}

/** Dynamically fetches available LLM models according to the connected active profile (giskard-sys, NVIDIA NIM, OpenAI, Ollama) */
import { fetchModelsForProvider } from './providers';

export interface ConnectionModelsGroup {
    connectionId: number;
    connectionName: string;
    connectionTag: string;
    connectionUrl: string;
    models: string[];
}

export async function fetchLlmModelsGrouped(): Promise<ConnectionModelsGroup[]> {
    try {
        if (!_store) return [];
        const list = _store.getAll();
        const activeConnections = list.filter(c => c.isActive);

        const connsToQuery = activeConnections.length > 0
            ? activeConnections
            : [{ id: 0, name: 'Giskard-Sys', type: 'local' as const, url: getConnectorUrl(), tag: 'giskard-sys', isActive: true }];

        const groups: ConnectionModelsGroup[] = [];

        for (const conn of connsToQuery) {
            const apiKey = conn.id ? (await _store.getApiKey(conn.id) || '') : '';
            const providerModels = await fetchModelsForProvider(conn.url, conn.tag, apiKey);
            if (providerModels.length > 0) {
                groups.push({
                    connectionId: conn.id,
                    connectionName: conn.name,
                    connectionTag: conn.tag,
                    connectionUrl: conn.url,
                    models: providerModels
                });
            }
        }

        return groups;
    } catch {
        return [];
    }
}

export async function fetchLlmModels(): Promise<string[]> {
    const groups = await fetchLlmModelsGrouped();
    const allModels: string[] = [];
    groups.forEach(g => {
        g.models.forEach(m => {
            if (!allModels.includes(m)) allModels.push(m);
        });
    });
    return allModels;
}

export async function updateProviderConfig(activeProvider: string, openaiBaseUrl?: string, openaiApiKey?: string) {
    const res = await fetchWithTimeout(`${getConnectorUrl()}/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
        body: JSON.stringify({
            active_provider: activeProvider,
            openai_base_url: openaiBaseUrl || null,
            openai_api_key: openaiApiKey || null
        })
    });
    return res.json();
}

/** Execute a CLI command through the backend server */
export async function execCliCommand(command: string, ...args: string[]): Promise<any> {
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
            body: JSON.stringify({ command, args })
        });
        return res.json();
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}
