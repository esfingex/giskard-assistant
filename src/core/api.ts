/**
 * Giskard-Sys VSCode Extension — Core API & Settings Client
 */

import * as vscode from 'vscode';

export function getConnectorUrl(): string {
    const config = vscode.workspace.getConfiguration('giskard-sys');
    return config.get<string>('connectorUrl') || 'http://localhost:3500';
}

export function getClientId(): string {
    const config = vscode.workspace.getConfiguration('giskard-sys');
    return config.get<string>('clientId') || 'VSCode-Copilot';
}

export async function fetchSandboxList(path: string = '.') {
    const res = await fetch(`${getConnectorUrl()}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify({ path, recursive: false })
    });
    return res.json();
}

export async function fetchSandboxRead(path: string) {
    const res = await fetch(`${getConnectorUrl()}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify({ path })
    });
    return res.json();
}

export async function fetchLlmModels() {
    try {
        const res = await fetch(`${getConnectorUrl()}/llm/models`);
        const data: any = await res.json();
        return data.success ? data.data.map((m: any) => m.name) : [];
    } catch {
        return ['qwen3-coder:30b', 'phi4:14b', 'aya-expanse:8b'];
    }
}

export async function updateProviderConfig(activeProvider: string, openaiBaseUrl?: string, openaiApiKey?: string) {
    const res = await fetch(`${getConnectorUrl()}/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify({
            active_provider: activeProvider,
            openai_base_url: openaiBaseUrl || null,
            openai_api_key: openaiApiKey || null
        })
    });
    return res.json();
}

export async function execCliCommand(command: string, prompt: string) {
    const res = await fetch(`${getConnectorUrl()}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify({ command, args: [prompt] })
    });
    return res.json();
}
