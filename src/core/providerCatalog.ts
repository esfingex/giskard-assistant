/**
 * Giskard Assistant VSCode Extension — Catálogo único de proveedores IA
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Fuente única de verdad para las conexiones de proveedor: el quickpick de
 * extension.ts, la UI del webview (inyectado por htmlShell) y los clients de
 * src/core/providers/ consumen ESTE catálogo en vez de repetir URLs.
 */

import {
    NVIDIA_NIM_DEFAULT_URL,
    DEEPSEEK_DEFAULT_URL,
    KIMI_DEFAULT_URL,
    QWEN_DEFAULT_URL,
    OPENROUTER_DEFAULT_URL,
    GISKARD_SYS_DEFAULT_URL,
    OLLAMA_DEFAULT_URL
} from './providers';

export type ProviderConnType = 'local' | 'remote';

export interface ProviderCatalogEntry {
    /** Emoji del quickpick / UI */
    emoji: string;
    /** Nombre legible (sin emoji) — usado como nombre por defecto de la conexión */
    name: string;
    /** URL base por defecto — proviene de los DEFAULT_URL de cada client */
    url: string;
    /** Tag de proveedor (connectionStore / router de fetchModelsForProvider) */
    tag: string;
    type: ProviderConnType;
    detail: string;
}

/** Catálogo en el orden de presentación del quickpick. 'custom' va al final. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
    {
        emoji: '🦙',
        name: 'Ollama Local',
        url: OLLAMA_DEFAULT_URL,
        tag: 'ollama',
        type: 'local',
        detail: 'Local Ollama instance on http://127.0.0.1:11434'
    },
    {
        emoji: '🦀',
        name: 'Giskard-Sys Backend',
        url: GISKARD_SYS_DEFAULT_URL,
        tag: 'giskard-sys',
        type: 'local',
        detail: 'Local Rust Axum server on http://localhost:3500'
    },
    {
        emoji: '🐳',
        name: 'DeepSeek V3 / R1 API',
        url: DEEPSEEK_DEFAULT_URL,
        tag: 'deepseek',
        type: 'remote',
        detail: 'DeepSeek Chat & Reasoner API'
    },
    {
        emoji: '🟢',
        name: 'NVIDIA NIM API',
        url: NVIDIA_NIM_DEFAULT_URL,
        tag: 'nvidia',
        type: 'remote',
        detail: 'NVIDIA NIM API microservices'
    },
    {
        emoji: '🌐',
        name: 'OpenRouter API',
        url: OPENROUTER_DEFAULT_URL,
        tag: 'openrouter',
        type: 'remote',
        detail: 'Agregador multi-proveedor: 400+ modelos (Claude, GPT, Gemini, Qwen, DeepSeek, gratis :free)'
    },
    {
        emoji: '⚡',
        name: 'OpenAI API',
        url: 'https://api.openai.com/v1',
        tag: 'openai',
        type: 'remote',
        detail: 'OpenAI GPT-4o / o1 / o3 models'
    },
    {
        emoji: '🧠',
        name: 'Anthropic Claude API',
        url: 'https://api.anthropic.com/v1',
        tag: 'anthropic',
        type: 'remote',
        detail: 'Claude 3.5 Sonnet / Haiku / Opus'
    },
    {
        emoji: '✨',
        name: 'Google Gemini API',
        url: 'https://generativelanguage.googleapis.com/v1beta',
        tag: 'gemini',
        type: 'remote',
        detail: 'Gemini 1.5 Pro / Flash models'
    },
    {
        emoji: '🌙',
        name: 'Moonshot Kimi API',
        url: KIMI_DEFAULT_URL,
        tag: 'kimi',
        type: 'remote',
        detail: 'Moonshot Kimi LLM API'
    },
    {
        emoji: '☁️',
        name: 'Qwen DashScope API',
        url: QWEN_DEFAULT_URL,
        tag: 'qwen',
        type: 'remote',
        detail: 'Alibaba Qwen LLM models'
    }
];

/** Entrada 'custom' (endpoint OpenAI-compatible arbitrario) — nunca en el catálogo base */
export const CUSTOM_PROVIDER_ENTRY: ProviderCatalogEntry = {
    emoji: '✅',
    name: 'Custom AI Endpoint',
    url: '',
    tag: 'custom',
    type: 'remote',
    detail: 'Configure any OpenAI-compatible API endpoint'
};

/** Busca una entrada por tag exacto (case-insensitive) */
export function findCatalogEntry(tag: string): ProviderCatalogEntry | undefined {
    const clean = (tag || '').toLowerCase().trim();
    return PROVIDER_CATALOG.find((e) => e.tag === clean);
}

/** Versión serializable para inyectar en el webview (htmlShell → connectionsView) */
export function serializeProviderCatalog(): Array<{ tag: string; name: string; url: string; type: ProviderConnType }> {
    return [...PROVIDER_CATALOG, CUSTOM_PROVIDER_ENTRY].map((e) => ({
        tag: e.tag,
        name: e.name,
        url: e.url,
        type: e.type
    }));
}
