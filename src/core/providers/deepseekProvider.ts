/**
 * Giskard Assistant VSCode Extension — Provider: DeepSeek API Client (V3 / R1)
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const DEEPSEEK_DEFAULT_URL = 'https://api.deepseek.com/v1';

export async function fetchDeepseekModels(baseUrl: string = DEEPSEEK_DEFAULT_URL, apiKey?: string): Promise<string[]> {
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
    return ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'];
}
