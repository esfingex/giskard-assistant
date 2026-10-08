/**
 * Giskard Assistant VSCode Extension — Capacidades y Settings de Modelos
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de connectionStore.ts (wave D): settings por defecto y heurística
 * pura de capacidades por nombre de modelo. Sin estado, sin `this`.
 */

export interface ModelSettings {
    temperature: number; // 0.0 - 1.0
    topP: number; // 0.0 - 1.0
    topK: number; // 1 - 100
    numCtx: number; // 2048 - 128000
    numPredict: number; // 512 - 4096
    think?: boolean;
    thinkBudget?: number;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    numCtx: 32768,
    numPredict: 4096,
    think: false,
    thinkBudget: 2048
};

export interface ModelCapabilities {
    thinking: boolean;
    tools: boolean;
    vision: boolean;
    embedding: boolean;
}

export function getModelCapabilities(modelName: string): ModelCapabilities {
    const l = (modelName || '').toLowerCase();
    const thinking =
        l.includes('r1') ||
        l.includes('reasoner') ||
        l.includes('qwq') ||
        l.includes('nemotron-3') ||
        l.includes('thinking');
    const tools =
        l.includes('instruct') ||
        l.includes('coder') ||
        l.includes('gpt') ||
        l.includes('claude') ||
        l.includes('gemini') ||
        l.includes('llama-3');
    const vision =
        l.includes('vision') ||
        l.includes('vl') ||
        l.includes('gpt-4o') ||
        l.includes('gemini-1.5') ||
        l.includes('gemini-2') ||
        l.includes('claude-3');
    const embedding = l.includes('embed') || l.includes('bge') || l.includes('nomic');
    return { thinking, tools, vision, embedding };
}
