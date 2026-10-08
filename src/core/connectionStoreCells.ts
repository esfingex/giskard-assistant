/**
 * Giskard Assistant VSCode Extension — Célula: Resolución de API Keys del Store
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de ConnectionStore.getAnyRemoteApiKey (wave D): búsqueda robusta
 * de API key con caché de sesión — por tag exacto, conexión activa, luego
 * cualquier secret guardado. Función pura de contexto explícito.
 */

import type * as vscode from 'vscode';
import type { Connection } from './connectionStore';

/** Resuelve {apiKey, url} para un tag: 1) tag exacto, 2) activa, 3) cualquier secret. */
export async function resolveApiKeyForTag(
    list: Connection[],
    active: Connection | null,
    secrets: vscode.SecretStorage,
    cache: Map<string, { apiKey: string; url?: string }>,
    providerTag?: string
): Promise<{ apiKey: string; url?: string } | null> {
    const cleanTag = (providerTag || '').toLowerCase().trim();
    const cacheKey = cleanTag || '__default__';

    if (cache.has(cacheKey)) {
        return cache.get(cacheKey)!;
    }

    // 1. Exact tag match
    if (cleanTag) {
        const tagConn = list.find((c) => (c.tag || '').toLowerCase().trim() === cleanTag);
        if (tagConn && tagConn.secretRef) {
            const key = await secrets.get(tagConn.secretRef);
            if (key && key.trim()) {
                const result = { apiKey: key.trim(), url: tagConn.url };
                cache.set(cacheKey, result);
                return result;
            }
        }
    }

    // 2. Active connection
    if (active && active.secretRef) {
        const key = await secrets.get(active.secretRef);
        if (key && key.trim()) {
            const result = { apiKey: key.trim(), url: active.url };
            cache.set(cacheKey, result);
            return result;
        }
    }

    // 3. Any saved connection with a secret in SecretStorage
    for (const conn of list) {
        if (conn.secretRef) {
            const key = await secrets.get(conn.secretRef);
            if (key && key.trim()) {
                const result = { apiKey: key.trim(), url: conn.url };
                cache.set(cacheKey, result);
                return result;
            }
        }
    }

    return null;
}
