/**
 * Giskard Assistant VSCode Extension — Master Provider Router & Registry
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchNvidiaModels } from './nvidiaProvider';
import { fetchDeepseekModels } from './deepseekProvider';
import { fetchKimiModels } from './kimiProvider';
import { fetchQwenModels } from './qwenProvider';
import { fetchGiskardSysModels } from './giskardSysProvider';
import { fetchOllamaModels } from './ollamaProvider';

export * from './nvidiaProvider';
export * from './deepseekProvider';
export * from './kimiProvider';
export * from './qwenProvider';
export * from './giskardSysProvider';
export * from './ollamaProvider';

/** Unified Model Fetcher Router dispatching requests to provider-specific client modules.
 * @param url   Base URL of the connection.
 * @param tag   Connection tag (e.g. 'nvidia', 'deepseek', 'ollama').
 * @param apiKey Optional API key for authenticated remote providers.
 * @param connType Connection.type: 'local' or 'remote' — primary dispatch signal.
 */
export async function fetchModelsForProvider(
    url: string,
    tag?: string,
    apiKey?: string,
    connType?: 'local' | 'remote'
): Promise<string[]> {
    const cleanUrl = (url || '').toLowerCase().trim();
    const cleanTag = (tag || '').toLowerCase().trim();

    // 1. NVIDIA NIM API
    if (cleanTag.includes('nvidia')) {
        return await fetchNvidiaModels(url, apiKey);
    }

    // 2. DeepSeek API
    if (cleanTag.includes('deepseek')) {
        return await fetchDeepseekModels(url, apiKey);
    }

    // 3. Moonshot Kimi API
    if (cleanTag.includes('kimi') || cleanUrl.includes('moonshot')) {
        return await fetchKimiModels(url, apiKey);
    }

    // 4. Qwen / DashScope API
    if (cleanTag.includes('qwen') || cleanUrl.includes('dashscope')) {
        return await fetchQwenModels(url, apiKey);
    }

    // 5. Local backends: dispatch by Connection.type first, then tag heuristics
    if (connType === 'local') {
        if (cleanTag.includes('giskard')) {
            return await fetchGiskardSysModels(url);
        }
        // Ollama is the default local backend
        return await fetchOllamaModels(url);
    }

    // 6. Remote connections: try the provider API directly
    if (connType === 'remote') {
        let models = await fetchNvidiaModels(url, apiKey);
        if (models.length === 0) models = await fetchDeepseekModels(url, apiKey);
        if (models.length === 0) models = await fetchKimiModels(url, apiKey);
        if (models.length === 0) models = await fetchQwenModels(url, apiKey);
        return models;
    }

    // 7. Legacy fallback (no connType — backward compatible heuristics)
    if (cleanUrl.includes(':3500') || cleanTag.includes('giskard')) {
        return await fetchGiskardSysModels(url);
    }
    if (cleanUrl.includes(':11434') || cleanTag.includes('ollama')) {
        return await fetchOllamaModels(url);
    }

    // Default Fallback Router
    let models = await fetchNvidiaModels(url, apiKey);
    if (models.length === 0) models = await fetchOllamaModels(url);
    if (models.length === 0) models = await fetchGiskardSysModels(url);

    return models;
}
