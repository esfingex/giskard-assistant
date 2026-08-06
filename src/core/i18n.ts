/**
 * Giskard Assistant VSCode Extension — Module: i18n Localization Engine
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type LanguageCode = 'en' | 'es';

let cachedLocales: Record<LanguageCode, any> = {
    en: null,
    es: null
};

export function getActiveLanguage(): LanguageCode {
    const config = vscode.workspace.getConfiguration('giskard-assistant');
    const lang = config.get<string>('language');
    if (lang === 'es' || lang === 'en') return lang;
    return 'en'; // Default language is English
}

export function loadTranslations(extensionUri: vscode.Uri, lang?: LanguageCode): any {
    const activeLang = lang || getActiveLanguage();
    if (cachedLocales[activeLang]) return cachedLocales[activeLang];

    try {
        const localeFilePath = path.join(extensionUri.fsPath, 'resources', 'locales', `${activeLang}.json`);
        if (fs.existsSync(localeFilePath)) {
            const content = fs.readFileSync(localeFilePath, 'utf-8');
            cachedLocales[activeLang] = JSON.parse(content);
            return cachedLocales[activeLang];
        }
    } catch (err) {
        console.warn(`[Giskard i18n] Failed loading locale file for ${activeLang}:`, err);
    }

    // Fallback to embedded English dictionary if file load fails
    return {
        tabs: { local: "⚙️ Local AI", remote: "🌐 Remote API", mcp: "🔌 MCP Servers", palette: "🎨 Color Theme" },
        status: { tokens: "🔢 Tokens", clearContext: "🗑️ Clear Context", settings: "⚙️ Settings", offline: "⚡ OFFLINE MODE" },
        connections: { title: "🔌 AI Connections Management", name: "Connection Name:", type: "Type:", url: "Backend / API URL:", tag: "Tag / Category:", apiKey: "API Key / Token:", test: "🧪 Test URL", add: "➕ Save Connection", active: "★ Active", activate: "Activate", delete: "Delete" },
        mcp: { title: "🔌 Model Context Protocol (MCP) Configuration", import: "📂 Import mcp_conf.js / config.json", name: "MCP Server Name:", type: "Type:", cmd: "Command or URL:", test: "🧪 Test MCP", add: "➕ Add MCP Server", scan: "🔍 Scan MCP Services", active: "🟢 Active", inactive: "⚪ Inactive", availableServices: "🛠️ Available Services/Tools" },
        chat: { placeholder: "Ask AI assistant... (Shift+Enter for new line)", send: "Send ↵", stop: "Stop ⏹️", compress: "Compress Context", thinking: "Thinking...", applyDiff: "📝 Apply Diff", applyLastCode: "🚀 Apply last code block", copy: "📋 Copy", runShell: "⚡ Shell", openFile: "📄 Open" },
        palette: { title: "🎨 Workspace Color Customization", presets: "Presets:", white: "Minimal White", cyan: "Sovereign Cyan", emerald: "Emerald Cyber", purple: "Purple Synth", userFont: "💬 User Text Color:", headerFont: "📑 Header Title Color:", accentColor: "⚡ Accent Border Color:", userBg: "💬 User Bubble (Background):", botBg: "🤖 AI Bubble (Background):", thinkBg: "💡 Reasoning Box (Background):" }
    };
}
