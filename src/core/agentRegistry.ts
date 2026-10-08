/**
 * Giskard Assistant VSCode Extension — Agent Registry (Agent Manager)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Registro puro de runs del Agent Manager: agregar, actualizar, listar y
 * eliminar. Sin vscode — opera sobre una bolsa de estado inyectable
 * (testable con fakes; el host usa context.globalState).
 */

export type AgentRunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

/** Roles del ciclo de revisión (revisar → planear → implementar → re-revisar) */
export const AGENT_ROLES = {
    revisor: {
        emoji: '🔍',
        label: 'Revisor (solo revisa y reporta, no cambia nada)',
        prompt:
            'Eres un REVISOR de código estricto. Tu única tarea es revisar y reportar: ' +
            'NO propongas implementaciones completas ni cambios ejecutables. Salida: hallazgos ' +
            'numerados por severidad (crítico/importante/menor), cada uno con archivo+lugar, ' +
            'por qué importa y una sugerencia en una línea. Cierra con un veredicto: APROBADO o CAMBIOS NECESARIOS.'
    },
    planificador: {
        emoji: '🧭',
        label: 'Planificador (propone ideas y plan, no ejecuta)',
        prompt:
            'Eres un PLANIFICADOR. Analizas el contexto y propones un plan de trabajo concreto: ' +
            'objetivo, pasos ordenados, riesgos y qué tests harían falta. NO implementes código ' +
            'completo: pseudocódigo y decisiones. Termina con la lista de pasos lista para un ejecutor.'
    },
    ejecutor: {
        emoji: '🛠️',
        label: 'Ejecutor (implementa y verifica)',
        prompt:
            'Eres un EJECUTOR. Implementas la tarea de forma completa, concisa y verificable: ' +
            'explica brevemente el plan, entrega el resultado final y cierra con qué verificaste ' +
            'y qué no. No inventes archivos ni APIs que no conozcas.'
    }
} as const;

export type AgentRunRole = keyof typeof AGENT_ROLES;

export interface AgentRun {
    id: string;
    name: string;
    task: string;
    model: string;
    role: AgentRunRole;
    status: AgentRunStatus;
    createdAt: string;
    endedAt?: string;
    error?: string;
    /** Salida final (recortada) para encadenar el siguiente paso del ciclo */
    output?: string;
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
    input: { name: string; task: string; model: string; role?: AgentRunRole }
): AgentRun {
    const run: AgentRun = {
        id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        task: input.task,
        model: input.model,
        role: input.role && input.role in AGENT_ROLES ? input.role : 'ejecutor',
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

/** Output máximo guardado por run para el encadenamiento del ciclo (8k chars) */
export const AGENT_OUTPUT_CAP = 8_000;
