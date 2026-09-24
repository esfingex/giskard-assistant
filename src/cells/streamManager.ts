/**
 * Giskard Assistant VSCode Extension — Stream Manager
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.2.6 → v4.3.0 decomposition).
 * Handles SSE streaming from all backends: Giskard-Sys, Ollama /api/generate,
 * Ollama /api/chat, and remote provider APIs.
 *
 * Functions are pure of `this` — they receive webview, abort controller, and
 * other dependencies explicitly.
 */

import * as vscode from 'vscode';
import { getClientId, getClientToken, fetchWithTimeout } from '../core/api';
import { getModelMaxContextWindow } from '../core/contextWindow';

/** Shared streaming context passed by the caller */
export interface StreamContext {
    view: vscode.WebviewView;
    abortController: AbortController;
    /** Accumulated full response text (updated in-place for legacy methods) */
    lastBotResponse: { text: string };
}

// ─── Giskard-Sys Backend (SSE via /llm/stream) ────────────────────────────────

export async function streamFromGiskardSys(
    ctx: StreamContext,
    connectorUrl: string,
    fullPrompt: string,
    targetModel: string,
    tabId?: string
): Promise<void> {
    const { view, abortController, lastBotResponse } = ctx;
    const streamUrl = `${connectorUrl}/llm/stream`;
    const sessionName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';

    const response = await fetch(streamUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'X-Client-Id': getClientId(),
            'X-Client-Token': getClientToken()
        },
        body: JSON.stringify({
            prompt: fullPrompt,
            model: targetModel || undefined,
            session_id: sessionName,
            project: sessionName
        }),
        signal: abortController.signal
    });

    if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Servidor respondió HTTP ${response.status}: ${errText}`);
    }

    view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const raw = trimmed.slice(6);
            if (raw === '[DONE]') break;

            try {
                const json = JSON.parse(raw);
                let token = '';
                const content = json?.choices?.[0]?.delta?.content;
                if (content !== undefined && content !== null) {
                    token = String(content);
                } else if (json?.choices?.[0]?.delta?.reasoning_content) {
                    token = String(json.choices[0].delta.reasoning_content);
                } else if (json?.text !== undefined) {
                    token = String(json.text);
                }

                if (token) {
                    accumulated += token;
                    view.webview.postMessage({
                        type: 'streamToken',
                        token,
                        model: targetModel,
                        tabId
                    });
                }
            } catch { /* skip malformed SSE chunks */ }
        }
    }

    lastBotResponse.text = accumulated;
}

// ─── Ollama /api/generate (legacy, streaming response field) ──────────────────

export async function streamFromOllamaLegacy(
    ctx: StreamContext,
    ollamaUrl: string,
    fullPrompt: string,
    targetModel: string,
    tabId?: string
): Promise<void> {
    const { view, abortController, lastBotResponse } = ctx;
    const url = `${ollamaUrl.replace(/\/$/, '')}/api/generate`;

    const numCtx = Math.min(getModelMaxContextWindow(targetModel), 32768);
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: targetModel,
            prompt: fullPrompt,
            stream: true,
            keep_alive: '10m',
            options: {
                num_ctx: numCtx,
                num_predict: 8192,
                temperature: 0.7
            }
        }),
        signal: abortController.signal
    });

    if (!response.ok || !response.body) {
        throw new Error(`Ollama local respondió HTTP ${response.status}`);
    }

    view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const json = JSON.parse(trimmed);
                let token = '';
                if (json.response !== undefined) {
                    token = json.response;
                } else if (json.message?.content) {
                    token = json.message.content;
                } else if (json.thinking) {
                    token = json.thinking;
                } else if (json.message?.reasoning_content) {
                    token = json.message.reasoning_content;
                }

                if (token) {
                    accumulated += token;
                    view.webview.postMessage({
                        type: 'streamToken',
                        token,
                        model: targetModel,
                        tabId
                    });
                }
            } catch { /* skip malformed lines */ }
        }
    }

    lastBotResponse.text = accumulated;
}

// ─── Ollama /api/chat (structured message history) ────────────────────────────

export async function streamOllamaChat(
    ctx: StreamContext,
    messages: { role: string; content: string }[],
    model: string,
    ollamaUrl: string,
    tabId?: string
): Promise<string> {
    const { view, abortController } = ctx;
    const url = `${ollamaUrl.replace(/\/$/, '')}/api/chat`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            keep_alive: '10m',
            options: {
                num_ctx: Math.min(getModelMaxContextWindow(model), 32768),
                num_predict: 8192,
                temperature: 0.7
            }
        }),
        signal: abortController.signal
    });

    if (!response.ok || !response.body) {
        throw new Error(`Ollama /api/chat respondió HTTP ${response.status}`);
    }

    view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: true, tabId });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const json = JSON.parse(trimmed);
                let token = '';
                if (json.message && json.message.content) token = json.message.content;
                else if (json.message && json.message.reasoning_content) token = json.message.reasoning_content;
                else if (json.thinking) token = json.thinking;

                if (token) {
                    accumulated += token;
                    view.webview.postMessage({
                        type: 'streamToken',
                        token,
                        model,
                        tabId
                    });
                }
            } catch { /* skip */ }
        }
    }

    return accumulated;
}

// ─── Remote Provider API (OpenAI-compatible SSE) ──────────────────────────────

export async function streamFromRemoteApi(
    ctx: StreamContext,
    remoteUrl: string,
    apiKey: string,
    model: string,
    fullPrompt: string,
    tabId?: string
): Promise<void> {
    const { view, abortController, lastBotResponse } = ctx;
    const cleanUrl = remoteUrl.replace(/\/$/, '');
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'X-Client-Id': getClientId()
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: fullPrompt }],
            stream: true,
            temperature: 0.7
        }),
        signal: abortController.signal
    });

    if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`API remota respondió HTTP ${response.status}: ${errText}`);
    }

    view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: false, tabId });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const raw = trimmed.slice(6);
            if (raw === '[DONE]') break;

            try {
                const json = JSON.parse(raw);
                const content = json?.choices?.[0]?.delta?.content;
                if (content !== undefined && content !== null) {
                    const token = String(content);
                    accumulated += token;
                    view.webview.postMessage({
                        type: 'streamToken',
                        token,
                        model,
                        tabId
                    });
                }
            } catch { /* skip */ }
        }
    }

    lastBotResponse.text = accumulated;
}

// ─── Giskard-Sys Ollama URL resolution (cached 60s) ───────────────────────────

let _giskardSysOllamaCache: { url: string; value: string | null; at: number } | null = null;

export function clearOllamaCache(): void {
    _giskardSysOllamaCache = null;
}

export async function resolveGiskardSysOllama(connectorUrl: string): Promise<string | null> {
    const now = Date.now();
    const cache = _giskardSysOllamaCache;
    if (cache && cache.url === connectorUrl && now - cache.at < 60_000) {
        return cache.value;
    }
    let result: string | null = null;
    try {
        const res = await fetchWithTimeout(`${connectorUrl}/policy`, {}, 5000);
        if (res && res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data && data.success && data.data) {
                const provider = String(data.data.active_provider || '').toLowerCase();
                const url = String(data.data.ollama_url || '').trim();
                if (provider === 'ollama' && url) {
                    result = url;
                }
            }
        }
    } catch { /* sin conectividad con giskard-sys */ }

    _giskardSysOllamaCache = { url: connectorUrl, value: result, at: now };
    return result;
}