/**
 * Giskard Assistant VSCode Extension — Module: Inline Code Completions (FIM / Ghost Text)
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { ConnectionStore } from '../core/connectionStore';
import { fetchWithTimeout, CLIENT_ID } from '../core/api';

export class GiskardInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private readonly store: ConnectionStore) { }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        if (token.isCancellationRequested || position.line < 0) return null;

        const prefix = document.getText(new vscode.Range(new vscode.Position(Math.max(0, position.line - 15), 0), position));
        if (!prefix.trim()) return null;

        try {
            const activeConn = this.store.getActive();
            const baseUrl = activeConn ? activeConn.url : 'http://localhost:11434';
            const apiKeyRes = activeConn ? await this.store.getAnyRemoteApiKey(activeConn.tag) : null;
            const apiKey = apiKeyRes ? apiKeyRes.apiKey : undefined;

            const cleanUrl = baseUrl.replace(/\/$/, '');
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Client-Id': CLIENT_ID
            };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

            const res = await fetchWithTimeout(`${cleanUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'qwen2.5-coder:1.5b',
                    messages: [{ role: 'user', content: `Complete code inline:\n${prefix}` }],
                    max_tokens: 48,
                    temperature: 0.2
                })
            }, 2500).catch(() => null);

            if (res && res.ok) {
                const data: any = await res.json().catch(() => null);
                const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
                if (text && text.trim()) {
                    const cleanText = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
                    return [new vscode.InlineCompletionItem(cleanText, new vscode.Range(position, position))];
                }
            }
        } catch { }

        return null;
    }
}
