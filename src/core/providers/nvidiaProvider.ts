/**
 * Giskard Assistant VSCode Extension — Provider: NVIDIA NIM API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const NVIDIA_NIM_DEFAULT_URL = 'https://integrate.api.nvidia.com/v1';

/** Session-level cache — populated on first successful fetch */
let _cachedNvidiaModels: string[] | null = null;

export function clearNvidiaModelCache() {
    _cachedNvidiaModels = null;
}

export async function fetchNvidiaModels(baseUrl: string = NVIDIA_NIM_DEFAULT_URL, apiKey?: string): Promise<string[]> {
    if (_cachedNvidiaModels && _cachedNvidiaModels.length > 0) {
        return _cachedNvidiaModels;
    }

    const cleanUrl = baseUrl.replace(/\/$/, '');
    const modelsUrl = `${cleanUrl}/models`;

    const filterModel = (id: string): boolean => {
        const l = id.toLowerCase();
        return id.includes('/') &&
            !l.includes('embed') &&
            !l.includes('detector') &&
            !l.includes('translate') &&
            !l.includes('clip') &&
            !l.includes('guard') &&
            !l.includes('rerank') &&
            !l.includes('retrieve') &&
            !l.includes('parse') &&
            !l.includes('reward') &&
            !l.includes('safety') &&
            !l.includes('riva') &&
            !l.includes('neva') &&
            !l.includes('nvclip');
    };

    // 1. Try with API key (user-authenticated)
    if (apiKey && apiKey.trim()) {
        try {
            const res = await fetchWithTimeout(modelsUrl, {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'X-Client-Id': CLIENT_ID
                }
            }, 8000).catch(() => null);

            if (res && res.ok) {
                const data: any = await res.json().catch(() => null);
                if (data?.data && Array.isArray(data.data)) {
                    const models = data.data
                        .map((m: any) => (m.id || '').trim())
                        .filter(filterModel)
                        .sort();
                    if (models.length > 0) {
                        _cachedNvidiaModels = models;
                        return models;
                    }
                }
            }
        } catch { }
    }

    // 2. Fetch without API key (public endpoint)
    try {
        const res = await fetchWithTimeout(modelsUrl, {
            headers: { 'X-Client-Id': CLIENT_ID }
        }, 8000).catch(() => null);

        if (res && res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data?.data && Array.isArray(data.data)) {
                const models = data.data
                    .map((m: any) => (m.id || '').trim())
                    .filter(filterModel)
                    .sort();
                if (models.length > 0) {
                    _cachedNvidiaModels = models;
                    return models;
                }
            }
        }
    } catch { }

    // If fetch fails / no connection -> return empty list (no hardcoding)
    return [];
}
