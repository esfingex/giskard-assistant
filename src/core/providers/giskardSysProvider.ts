/**
 * Giskard Assistant VSCode Extension — Provider: Giskard-Sys Rust Axum Connector
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchWithTimeout, CLIENT_ID } from '../api';

export const GISKARD_SYS_DEFAULT_URL = 'http://localhost:3500';

export async function fetchGiskardSysModels(baseUrl: string = GISKARD_SYS_DEFAULT_URL): Promise<string[]> {
    try {
        const cleanUrl = baseUrl.replace(/\/$/, '');
        const res = await fetchWithTimeout(`${cleanUrl}/llm/models`, {
            headers: { 'X-Client-Id': CLIENT_ID }
        }, 5000).catch(() => null);

        if (res && res.ok) {
            const data: any = await res.json().catch(() => null);
            if (data && data.success && Array.isArray(data.data) && data.data.length > 0) {
                return data.data.map((m: any) => m.name || m.id || String(m));
            }
        }
    } catch { }
    return [];
}
