/**
 * Giskard Assistant VSCode Extension — Provider: NVIDIA NIM API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const NVIDIA_NIM_DEFAULT_URL = 'https://integrate.api.nvidia.com/v1';

export async function fetchNvidiaModels(baseUrl: string = NVIDIA_NIM_DEFAULT_URL, apiKey?: string): Promise<string[]> {
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
    return [
        'openai/gpt-oss-120b',
        'meta/llama-3.3-70b-instruct',
        'nvidia/llama-3.1-nemotron-70b-instruct',
        'mistralai/codestral-22b-instruct-v0.1',
        'ibm/granite-34b-code-instruct'
    ];
}
