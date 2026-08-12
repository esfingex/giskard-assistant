/**
 * Giskard Assistant VSCode Extension — Provider: Moonshot Kimi API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const KIMI_DEFAULT_URL = 'https://api.moonshot.cn/v1';

export async function fetchKimiModels(baseUrl: string = KIMI_DEFAULT_URL, apiKey?: string): Promise<string[]> {
    try {
        const cleanUrl = baseUrl.replace(/\/$/, '');
        const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetchWithTimeout(`${cleanUrl}/models`, { headers }, 5000).catch(() => null);
        if (res && res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data && Array.isArray(data.data) && data.data.length > 0) {
                return data.data.map((m: any) => m.id || m.name || String(m));
            }
        }
    } catch { }
    return [];
}
