/**
 * Giskard Assistant VSCode Extension — Provider: Moonshot Kimi API Client
 * Copyright (C) 2025-2026 Giskard Project
 */

import { fetchOpenAiCompatibleModels } from './openAiCompat';

export const KIMI_DEFAULT_URL = 'https://api.moonshot.cn/v1';

export async function fetchKimiModels(
    baseUrl: string = KIMI_DEFAULT_URL,
    apiKey?: string
): Promise<string[]> {
    return await fetchOpenAiCompatibleModels(baseUrl, apiKey);
}
