/**
 * Giskard Assistant VSCode Extension — Provider: DeepSeek API Client (V3 / R1)
 * Copyright (C) 2025-2026 Giskard Project
 */

import { ProviderModelsResponse, fetchWithTimeout, CLIENT_ID } from '../api';

export const DEEPSEEK_DEFAULT_URL = 'https://api.deepseek.com/v1';

export interface PeakInfo {
    isPeak: boolean;
    label: string;
    nextTransitionUtc: string;
}

/**
 * Regla del usuario (2026-09-09): trabajo pagado contra la API oficial de
 * DeepSeek SOLO en off-peak. Ventanas peak UTC (lun-vie): 01:00-04:00 y
 * 06:00-10:00. Devuelve estado actual y proxima transicion UTC.
 */
export function getPeakInfo(now: Date = new Date()): PeakInfo {
    const day = now.getUTCDay();
    const h = now.getUTCHours();
    const weekday = day >= 1 && day <= 5;
    const isPeak = weekday && ((h >= 1 && h < 4) || (h >= 6 && h < 10));

    // Proxima transicion: barrer fronteras (inicio/fin de ventana) hasta 8 dias.
    const boundaries = [1, 4, 6, 10];
    let next: Date | null = null;
    for (let d = 0; d < 8 && !next; d++) {
        for (const b of boundaries) {
            const cand = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, b, 0, 0)
            );
            if (cand <= now) {
                continue;
            }
            const cd = cand.getUTCDay();
            if (cd >= 1 && cd <= 5) {
                next = cand;
                break;
            }
        }
    }

    return {
        isPeak,
        label: isPeak ? 'PEAK' : 'OFF-PEAK',
        nextTransitionUtc: next ? next.toISOString().slice(0, 16).replace('T', ' ') : 'n/a'
    };
}

export async function fetchDeepseekModels(
    baseUrl: string = DEEPSEEK_DEFAULT_URL,
    apiKey?: string
): Promise<string[]> {
    try {
        const cleanUrl = baseUrl.replace(/\/$/, '');
        const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetchWithTimeout(`${cleanUrl}/models`, { headers }, 5000).catch(() => null);
        if (res && res.ok) {
            const data = (await res.json().catch(() => null)) as ProviderModelsResponse | null;
            if (data && Array.isArray(data.data) && data.data.length > 0) {
                return data.data.map((m) => m.id || m.name || String(m));
            }
        }
    } catch {}
    return [];
}
