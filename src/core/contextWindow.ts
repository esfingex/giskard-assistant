/**
 * Giskard Assistant VSCode Extension — Module: Context Window Management
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Fase 2: token estimation + sliding-window trimming so every request fits inside
 * the model's context window and generations never die from an overflowing context.
 */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
}

/**
 * Rough token estimate without a tokenizer.
 * Code/English ≈ 1 token / 4 chars; Spanish (more dense) ≈ 1 token / 3 chars.
 * Only used for budget trimming, so precision is not critical.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    // Count characters but give ~25% extra weight to accented/non-ASCII (Spanish is denser)
    let nonAscii = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 127) nonAscii++;
    }
    const effective = text.length + nonAscii * 0.5;
    return Math.max(1, Math.ceil(effective / 3.2));
}

/**
 * Sliding window: trim the OLDEST whole turns (user+assistant pairs) until the
 * history fits inside `budget` tokens. The system message and the FIRST user
 * message (original task) are ALWAYS kept — the model never forgets what it was
 * asked to do. Never cuts a turn in half.
 */
export function trimHistory(history: ChatMessage[], budget: number): ChatMessage[] {
    if (!history || history.length === 0) return history;
    let total = 0;
    for (const m of history) total += estimateTokens(m.content);
    if (total <= budget) return history;

    const kept: ChatMessage[] = [];
    // System message (index 0) and first user message (index 1) are never trimmed
    let start = 0;
    if (history[0] && history[0].role === 'system') {
        kept.push(history[0]);
        start = 1;
    }
    // First user message is the original task — always preserve
    const firstUser = history.slice(start).find(m => m.role === 'user');
    if (firstUser && kept.findIndex(k => k === firstUser) === -1) {
        kept.push(firstUser);
    }

    // Build from newest backwards, keeping what fits
    const newestFirst = history.slice(start).filter(m => m !== firstUser).reverse();
    const candidate: ChatMessage[] = [];
    let used = kept.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    for (const msg of newestFirst) {
        const cost = estimateTokens(msg.content);
        if (used + cost > budget) break;
        candidate.unshift(msg);
        used += cost;
    }
    return [...kept, ...candidate];
}

/**
 * Build the message list for /api/chat from a per-tab history plus the new user turn.
 * Assures the result fits `budget` tokens.
 */
export function buildChatMessages(
    history: ChatMessage[],
    system: string,
    userContent: string,
    budget: number
): ChatMessage[] {
    const base: ChatMessage[] = [
        { role: 'system', content: system },
        ...history.filter(m => m.role !== 'system')
    ];
    const withUser: ChatMessage[] = [...base, { role: 'user', content: userContent }];
    return trimHistory(withUser, budget);
}
