/**
 * Giskard Assistant VSCode Extension — Helper: fetch de modelos OpenAI-compatible
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Un solo cuerpo para los clients que comparten el mismo contrato REST
 * (GET {base}/models con X-Client-Id + Bearer opcional): Kimi, Qwen, DeepSeek.
 */

import { ProviderModelsResponse, fetchWithTimeout, CLIENT_ID } from '../api';

export async function fetchOpenAiCompatibleModels(
    baseUrl: string,
    apiKey?: string,
    timeoutMs: number = 5000
): Promise<string[]> {
    try {
        const cleanUrl = baseUrl.replace(/\/$/, '');
        const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetchWithTimeout(`${cleanUrl}/models`, { headers }, timeoutMs).catch(() => null);
        if (res && res.ok) {
            const data = (await res.json().catch(() => null)) as ProviderModelsResponse | null;
            if (data && Array.isArray(data.data) && data.data.length > 0) {
                return data.data.map((m) => m.id || m.name || String(m));
            }
        }
    } catch {}
    return [];
}
