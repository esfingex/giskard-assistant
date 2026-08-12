/**
 * Giskard Assistant VSCode Extension — Provider: Qwen / Alibaba DashScope API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const QWEN_DEFAULT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export async function fetchQwenModels(baseUrl: string = QWEN_DEFAULT_URL, apiKey?: string): Promise<string[]> {
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
