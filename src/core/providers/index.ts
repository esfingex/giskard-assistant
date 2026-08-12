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

/** Unified Model Fetcher Router dispatching requests to provider-specific client modules */
export async function fetchModelsForProvider(
    url: string,
    tag?: string,
    apiKey?: string
): Promise<string[]> {
    const cleanUrl = (url || '').toLowerCase().trim();
    const cleanTag = (tag || '').toLowerCase().trim();

    // 1. NVIDIA NIM API
    if (cleanUrl.includes('nvidia') || cleanTag.includes('nvidia')) {
        return await fetchNvidiaModels(url, apiKey);
    }

    // 2. DeepSeek API
    if (cleanUrl.includes('deepseek') || cleanTag.includes('deepseek')) {
        return await fetchDeepseekModels(url, apiKey);
    }

    // 3. Moonshot Kimi API
    if (cleanUrl.includes('moonshot') || cleanUrl.includes('kimi') || cleanTag.includes('kimi')) {
        return await fetchKimiModels(url, apiKey);
    }

    // 4. Qwen / DashScope API
    if (cleanUrl.includes('dashscope') || cleanUrl.includes('qwen') || cleanTag.includes('qwen')) {
        return await fetchQwenModels(url, apiKey);
    }

    // 5. Giskard-Sys Axum Connector (Port 3500)
    if (cleanUrl.includes(':3500') || cleanTag.includes('giskard')) {
        return await fetchGiskardSysModels(url);
    }

    // 6. Local Ollama Server (Port 11434)
    if (cleanUrl.includes(':11434') || cleanTag.includes('ollama')) {
        return await fetchOllamaModels(url);
    }

    // Default Fallback Router
    let models = await fetchNvidiaModels(url, apiKey);
    if (models.length === 0) models = await fetchOllamaModels(url);
    if (models.length === 0) models = await fetchGiskardSysModels(url);

    return models;
}
