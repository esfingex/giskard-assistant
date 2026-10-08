/**
 * Giskard Assistant VSCode Extension — Provider: OpenRouter API Client
 * Copyright (C) 2025-2026 Giskard Project
 *
 * OpenRouter es un agregador OpenAI-compatible: /models es público (sin auth)
 * y devuelve el catálogo activo completo. El chat fluye por /chat/completions
 * con streaming SSE estándar vía streamManager.ts.
 */

import { ProviderModelsResponse, fetchWithTimeout, CLIENT_ID } from '../api';

export const OPENROUTER_DEFAULT_URL = 'https://openrouter.ai/api/v1';

/** Session-level cache — el catálogo activo es grande (~470 modelos), se pide una vez */
let _cachedOpenRouterModels: string[] | null = null;

export function clearOpenRouterModelCache() {
    _cachedOpenRouterModels = null;
}

/**
 * Filtra variantes no-chat del catálogo activo: embeddings, batch/duplicate
 * slugs de pipeline y endpoints especializados. Mantiene `:free` (sí es chat).
 */
function filterModel(id: string): boolean {
    const l = id.toLowerCase();
    return (
        id.includes('/') &&
        !l.includes('embed') &&
        !l.includes('rerank') &&
        !l.includes('guard') &&
        !l.includes('moderation') &&
        !l.endsWith(':batch') &&
        !l.endsWith(':nitro') &&
        !l.endsWith(':floor') &&
        !l.endsWith(':extended') &&
        !l.endsWith(':online') &&
        !l.endsWith(':thinking') &&
        !l.endsWith('-arxiv') &&
        !l.endsWith('-search')
    );
}

export async function fetchOpenRouterModels(
    baseUrl: string = OPENROUTER_DEFAULT_URL,
    apiKey?: string
): Promise<string[]> {
    if (_cachedOpenRouterModels && _cachedOpenRouterModels.length > 0) {
        return _cachedOpenRouterModels;
    }

    const cleanUrl = (baseUrl || OPENROUTER_DEFAULT_URL).replace(/\/$/, '');

    try {
        const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
        if (apiKey && apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

        const res = await fetchWithTimeout(`${cleanUrl}/models`, { headers }, 10000).catch(() => null);
        if (res && res.ok) {
            const data = (await res.json().catch(() => null)) as ProviderModelsResponse | null;
            if (data && Array.isArray(data.data) && data.data.length > 0) {
                const models = data.data
                    .map((m) => (m.id || '').trim())
                    .filter(filterModel)
                    .sort();
                if (models.length > 0) {
                    _cachedOpenRouterModels = models;
                    return models;
                }
            }
        }
    } catch {}
    return [];
}

/**
 * Subconjunto de modelos gratuitos del catálogo activo (ids con sufijo `:free`).
 * Útil para probar sin gastar crédito — no interfiere con la conexión principal.
 */
export async function fetchOpenRouterFreeModels(
    baseUrl: string = OPENROUTER_DEFAULT_URL
): Promise<string[]> {
    const all = await fetchOpenRouterModels(baseUrl);
    return all.filter((id) => id.toLowerCase().endsWith(':free'));
}
