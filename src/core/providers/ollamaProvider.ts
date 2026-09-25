/**
 * Giskard Assistant VSCode Extension — Provider: Ollama Local API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { ProviderModelsResponse, fetchWithTimeout } from '../api';

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

export async function fetchOllamaModels(baseUrl: string = OLLAMA_DEFAULT_URL): Promise<string[]> {
    try {
        const cleanUrl = baseUrl.replace(/\/$/, '');
        const res = await fetchWithTimeout(`${cleanUrl}/api/tags`, {}, 5000).catch(() => null);
        if (res && res.ok) {
            const data = (await res.json().catch(() => null)) as ProviderModelsResponse | null;
            if (data && Array.isArray(data.models) && data.models.length > 0) {
                return data.models.map((m) => m.name || m.id || String(m));
            }
        }
    } catch {}
    return [];
}
