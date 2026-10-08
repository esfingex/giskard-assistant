/**
 * Giskard Assistant VSCode Extension — Utils compartidos de comandos TreeView
 * Copyright (C) 2025-2026 Giskard Project
 */

/** Extrae un id numérico de un argumento de TreeItem (número, string o {rawData|id}).
 * Los TreeViews pasan shapes distintos según el nodo: normalizamos en un solo lugar. */
export function parseItemId(arg: unknown, preferConnectionId = false): number | null {
    let raw: unknown;
    if (typeof arg === 'number') {
        raw = arg;
    } else if (typeof arg === 'string') {
        raw = Number(arg);
    } else if (preferConnectionId) {
        raw = (arg as any)?.rawData?.connectionId ?? (arg as any)?.rawData?.id ?? (arg as any)?.id;
    } else {
        raw = (arg as any)?.rawData?.id || (arg as any)?.id;
    }
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === '' || Number.isNaN(n)) return null;
    return n;
}
