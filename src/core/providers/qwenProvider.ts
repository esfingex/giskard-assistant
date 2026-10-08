/**
 * Giskard Assistant VSCode Extension — Provider: Qwen / Alibaba DashScope API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchOpenAiCompatibleModels } from './openAiCompat';

export const QWEN_DEFAULT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export async function fetchQwenModels(
    baseUrl: string = QWEN_DEFAULT_URL,
    apiKey?: string
): Promise<string[]> {
    return await fetchOpenAiCompatibleModels(baseUrl, apiKey);
}
