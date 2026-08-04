/**
 * Giskard Assistant VSCode Extension — Core API & Backend Client
 * Copyright (C) 2025  Giskard Project
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
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

export async function fetchLlmModels() {
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/llm/models`, {
            headers: { 'X-Client-Id': CLIENT_ID }
        }, 15000);
        const data: any = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
            return data.data.map((m: any) => m.name);
        }
        return [];
    } catch {
        return [];
    }
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

export async function execCliCommand(command: string, prompt: string) {
    const res = await fetchWithTimeout(`${getConnectorUrl()}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
        body: JSON.stringify({ command, args: [prompt] })
    });
    return res.json();
}
