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
export async function fetchLlmModels(): Promise<string[]> {
    try {
        const baseUrl = getConnectorUrl();
        const activeConn = _store?.getActive();
        let apiKey = '';
        if (_store && activeConn) {
            apiKey = (await _store.getApiKey(activeConn.id)) || '';
        }

        const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        let res = await fetchWithTimeout(`${baseUrl}/llm/models`, { headers }, 5000).catch(() => null);
        if (!res || !res.ok) {
            res = await fetchWithTimeout(`${baseUrl}/v1/models`, { headers }, 5000).catch(() => null);
        }
        if (!res || !res.ok) {
            res = await fetchWithTimeout(`${baseUrl}/models`, { headers }, 5000).catch(() => null);
        }
        if (!res || !res.ok) {
            res = await fetchWithTimeout(`${baseUrl}/api/tags`, { headers }, 5000).catch(() => null);
        }

        if (res && res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data) {
                // Format A: { success: true, data: [...] } (giskard-sys format)
                if (data.success && Array.isArray(data.data) && data.data.length > 0) {
                    return data.data.map((m: any) => m.name || m.id || String(m));
                }
                // Format B: { data: [{ id: "..." }, ...] } (OpenAI / NVIDIA NIM format)
                if (Array.isArray(data.data) && data.data.length > 0) {
                    return data.data.map((m: any) => m.id || m.name || String(m));
                }
                // Format C: { models: [{ name: "..." }, ...] } (Ollama / vLLM format)
                if (Array.isArray(data.models) && data.models.length > 0) {
                    return data.models.map((m: any) => m.name || m.id || String(m));
                }
            }
        }
    } catch {}

    // Fallback: Query local Ollama directly via configured ollamaUrl
    try {
        const config = vscode.workspace.getConfiguration('giskard-assistant');
        const ollamaBaseUrl = config.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';
        const resOllama = await fetchWithTimeout(`${ollamaBaseUrl.replace(/\/$/, '')}/api/tags`, {}, 5000);
        const dataOllama: any = await resOllama.json();
        if (Array.isArray(dataOllama.models) && dataOllama.models.length > 0) {
            return dataOllama.models.map((m: any) => m.name);
        }
    } catch {}

    return [];
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
