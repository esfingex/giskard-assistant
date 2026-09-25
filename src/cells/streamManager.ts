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
import { clearAgentActivity } from './statusBar';
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
            Accept: 'text/event-stream',
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
            } catch {
                /* skip malformed SSE chunks */
            }
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
            } catch {
                /* skip malformed lines */
            }
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
                else if (json.message && json.message.reasoning_content)
                    token = json.message.reasoning_content;
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
            } catch {
                /* skip */
            }
        }
    }

    return accumulated;
}

// ─── Remote Provider API (OpenAI-compatible SSE) ──────────────────────────────

/** Contexto extendido para el streaming remoto (callback de diff + estado del host) */
export interface RemoteStreamContext {
    view: vscode.WebviewView;
    abortController: AbortController;
    lastBotResponse: { text: string };
    maybeAutoTriggerDiff(
        userPrompt: string,
        reply: string,
        extractedPath?: string,
        includeActiveFile?: boolean
    ): Promise<void>;
    clearAbort(): void;
}

export async function streamFromRemoteApi(
    ctx: RemoteStreamContext,
    baseUrl: string,
    apiKey: string,
    model: string,
    fullPrompt: string,
    userPrompt?: string,
    extractedPath?: string,
    includeActiveFile?: boolean,
    tabId?: string
): Promise<void> {
    const view = ctx.view;
    if (!view) return;

    const signal = ctx.abortController.signal;

    let cleanUrl = baseUrl.trim().replace(/\/$/, '');
    if (!cleanUrl.endsWith('/chat/completions')) {
        if (cleanUrl.endsWith('/v1')) cleanUrl = `${cleanUrl}/chat/completions`;
        else cleanUrl = `${cleanUrl}/v1/chat/completions`;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
    };
    if (apiKey && apiKey.trim()) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    let safePrompt = fullPrompt;
    if (safePrompt.length > 100000) {
        safePrompt =
            safePrompt.substring(0, 100000) +
            '\n\n... [Prompt contextual truncado para no exceder los límites del servidor remoto]';
    }
    const maxResponseTokens = 4096;

    // Larger models (550B+) need more time to queue and start streaming on free tier
    const modelLower = model.toLowerCase();
    const isLargeModel =
        modelLower.includes('550b') ||
        modelLower.includes('405b') ||
        modelLower.includes('671b') ||
        modelLower.includes('ultra') ||
        modelLower.includes('235b') ||
        modelLower.includes('200b');
    const timeoutMs = isLargeModel ? 180000 : 90000;

    const timeoutId = setTimeout(() => {
        if (ctx.abortController) {
            ctx.abortController.abort();
        }
    }, timeoutMs);

    try {
        const response = await fetch(cleanUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: safePrompt }],
                stream: true,
                temperature: 0.7,
                max_tokens: maxResponseTokens
            }),
            signal
        });

        clearTimeout(timeoutId);

        if (!response.ok || !response.body) {
            const errText = await response.text().catch(() => response.statusText);
            throw new Error(`API Remota (${cleanUrl}) respondió HTTP ${response.status}: ${errText}`);
        }

        view.webview.postMessage({ type: 'streamStatus', phase: 'connected', isLocal: false, tabId });
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulated = '';
        let buffer = '';
        let cachedExtractor: ((j: any) => string) | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line || line.startsWith(':')) continue;

                if (line.startsWith('data:')) {
                    const rawData = line.substring(line.indexOf(':') + 1);
                    if (rawData.trim() === '[DONE]') continue;

                    const tokenStr = rawData.startsWith(' ') ? rawData.substring(1) : rawData;
                    if (!tokenStr) continue;

                    try {
                        const json = JSON.parse(tokenStr.trim());
                        let contentToken = '';

                        if (cachedExtractor) {
                            contentToken = cachedExtractor(json);
                        }

                        if (!contentToken) {
                            const choice = json.choices && json.choices[0];
                            const delta = choice?.delta;
                            const msg = choice?.message;

                            if (delta?.content) {
                                cachedExtractor = (j) => j.choices?.[0]?.delta?.content || '';
                                contentToken = delta.content;
                            } else if (delta?.text) {
                                cachedExtractor = (j) => j.choices?.[0]?.delta?.text || '';
                                contentToken = delta.text;
                            } else if (delta?.reasoning_content) {
                                cachedExtractor = (j) => j.choices?.[0]?.delta?.reasoning_content || '';
                                contentToken = delta.reasoning_content;
                            } else if (delta?.reasoning) {
                                cachedExtractor = (j) => j.choices?.[0]?.delta?.reasoning || '';
                                contentToken = delta.reasoning;
                            } else if (choice?.text) {
                                cachedExtractor = (j) => j.choices?.[0]?.text || '';
                                contentToken = choice.text;
                            } else if (msg?.content) {
                                cachedExtractor = (j) => j.choices?.[0]?.message?.content || '';
                                contentToken = msg.content;
                            } else if (msg?.reasoning_content) {
                                cachedExtractor = (j) => j.choices?.[0]?.message?.reasoning_content || '';
                                contentToken = msg.reasoning_content;
                            } else if (json.content) {
                                cachedExtractor = (j) => j.content || '';
                                contentToken = json.content;
                            } else if (json.text) {
                                cachedExtractor = (j) => j.text || '';
                                contentToken = json.text;
                            }
                        }

                        if (contentToken) {
                            accumulated += contentToken;
                            view.webview.postMessage({
                                type: 'streamToken',
                                token: contentToken,
                                model,
                                tabId
                            });
                        }
                    } catch {}
                }
            }
        }

        ctx.lastBotResponse.text = accumulated;
        clearAgentActivity();
        view.webview.postMessage({ type: 'streamComplete', model, tabId });
        await ctx.maybeAutoTriggerDiff(
            userPrompt || fullPrompt,
            accumulated,
            extractedPath,
            includeActiveFile
        );
    } catch (err: any) {
        if (err.name === 'AbortError') {
            view.webview.postMessage({
                type: 'streamError',
                model,
                tabId,
                error: `⚠️ Timeout de conexión (60s) para '${model}'.\n\n💡 Verifica tu conexión de red o tu API Key en Settings ⚙️.`
            });
            return;
        }
        view.webview.postMessage({
            type: 'streamError',
            model,
            tabId,
            error: `Error de API Remota (${model}): ${err.message}`
        });
    } finally {
        ctx.clearAbort();
    }
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
    } catch {
        /* sin conectividad con giskard-sys */
    }

    _giskardSysOllamaCache = { url: connectorUrl, value: result, at: now };
    return result;
}
