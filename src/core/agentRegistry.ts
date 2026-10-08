/**
 * Giskard Assistant VSCode Extension — Agent Registry (Agent Manager)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Registro puro de runs del Agent Manager: agregar, actualizar, listar y
 * eliminar. Sin vscode — opera sobre una bolsa de estado inyectable
 * (testable con fakes; el host usa context.globalState).
 */

export type AgentRunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface AgentRun {
    id: string;
    name: string;
    task: string;
    model: string;
    status: AgentRunStatus;
    createdAt: string;
    endedAt?: string;
    error?: string;
}

export interface AgentRunState {
    get(): AgentRun[];
    set(runs: AgentRun[]): void;
}

/** Listado para el TreeView — más recientes primero */
export function listRuns(state: AgentRunState): AgentRun[] {
    return state
        .get()
        .slice()
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

export function addRun(
    state: AgentRunState,
    input: { name: string; task: string; model: string }
): AgentRun {
    const run: AgentRun = {
        id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        task: input.task,
        model: input.model,
        status: 'queued',
        createdAt: new Date().toISOString()
    };
    state.set([...state.get(), run]);
    return run;
}

export function updateRun(
    state: AgentRunState,
    id: string,
    patch: Partial<AgentRun>
): AgentRun | null {
    const runs = state.get();
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const updated: AgentRun = { ...runs[idx], ...patch };
    runs[idx] = updated;
    state.set(runs);
    return updated;
}

export function getRun(state: AgentRunState, id: string): AgentRun | null {
    return state.get().find((r) => r.id === id) || null;
}

export function removeRun(state: AgentRunState, id: string): void {
    state.set(state.get().filter((r) => r.id !== id));
}

/** Prompt de sistema de los runs del Agent Manager */
export const AGENT_SYSTEM_PROMPT =
    'Eres un agente autónomo de código del Giskard Agent Manager. Ejecuta la ' +
    'tarea de forma completa, concisa y verificable: explica brevemente el ' +
    'plan, entrega el resultado final y cierra con qué verificaste y qué no. ' +
    'No inventes archivos ni APIs que no conozcas.';
