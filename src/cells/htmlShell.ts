/**
 * Giskard Assistant VSCode Extension — Module: HTML Shell & CSS Styling
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { loadTranslations } from '../core/i18n';

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'marked.min.js'));
    const highlightUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'highlight.min.js'));
    const chatUtilsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chatUtils.js'));
    const connectionsViewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'connectionsView.js'));
    const mcpViewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mcpView.js'));
    const chatViewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chatView.js'));

    const i18n = loadTranslations(extensionUri);

    return `<!DOCTYPE html>
<html lang="en" style="height: 100%;">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource}; connect-src *;">
    <style>
        html, body { height: 100%; margin: 0; padding: 0; box-sizing: border-box; overflow: hidden; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: transparent; }
        .chat-container { display: flex; flex-direction: column; height: 100%; padding: 8px; box-sizing: border-box; }
        .header { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; flex-shrink: 0; }
        .status-bar { display: flex; justify-content: space-between; align-items: center; font-size: 10px; opacity: 0.8; margin-bottom: 6px; padding: 2px 4px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; }
        .offline-badge { display: none; font-size: 9px; font-weight: bold; background: rgba(251,146,60,0.2); color: #fb923c; border: 1px solid rgba(251,146,60,0.4); padding: 1px 5px; border-radius: 3px; }
        .offline-badge.visible { display: inline-block; }
        select, button, input, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; border-radius: 4px; font-size: 11px; }
        select { flex: 1; }
        .messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; padding-right: 4px; }
        .msg { padding: 8px 12px; border-radius: 8px; font-size: 11px; word-break: break-word; line-height: 1.5; }
        .msg.user { background: var(--user-msg-bg); color: #ffffff; align-self: flex-end; white-space: pre-wrap; }
        .msg.bot { background: var(--bot-msg-bg); align-self: flex-start; width: 96%; box-sizing: border-box; }
        .msg.error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; align-self: flex-start; width: 96%; font-family: monospace; font-size: 10px; white-space: pre-wrap; }
        .msg.context-block { background: rgba(56,189,248,0.08); border: 1px dashed rgba(56,189,248,0.35); align-self: flex-start; width: 96%; font-size: 10px; }
        .model-tag { display: inline-block; font-size: 9px; font-weight: bold; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 6px; border-radius: 4px; margin-bottom: 6px; }
        details.think-box { background: var(--think-box-bg); border: 1px dashed var(--vscode-input-border); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; font-size: 10px; }
        details.think-box summary { cursor: pointer; font-weight: bold; opacity: 0.85; user-select: none; }
        details.think-box summary:hover { opacity: 1; }
        .think-content { font-style: italic; opacity: 0.85; border-left: 2px solid var(--vscode-button-background); padding: 4px 8px; margin-top: 6px; font-size: 10px; line-height: 1.5; max-height: 200px; overflow-y: auto; word-break: break-word; }
        .code-block-wrapper { position: relative; margin: 8px 0; }
        .code-actions { display: flex; gap: 4px; position: absolute; top: 6px; right: 6px; opacity: 0; transition: opacity 0.15s; }
        .code-block-wrapper:hover .code-actions { opacity: 1; }
        .code-action-btn { font-size: 9px; padding: 2px 6px; background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.1)); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-input-border); border-radius: 3px; cursor: pointer; font-weight: bold; }
        .file-link { color: #38bdf8; cursor: pointer; text-decoration: underline; font-family: monospace; font-size: 10px; }
        :root { --user-font-color: #f8fafc; --user-header-color: #ffffff; --user-header-border: rgba(255,255,255,0.15); --user-msg-bg: var(--vscode-button-background); --bot-msg-bg: var(--vscode-editor-inactiveSelectionBackground); --think-box-bg: rgba(0,0,0,0.25); }
        .answer-content { font-size: 11px; line-height: 1.6; word-break: break-word; margin-top: 4px; color: var(--user-font-color); }
        .answer-content p { margin: 6px 0; }
        .answer-content h1, .answer-content h2, .answer-content h3, .answer-content h4 { color: var(--user-header-color); font-weight: bold; margin: 12px 0 6px 0; border-bottom: 1px solid var(--user-header-border); padding-bottom: 3px; }
        .answer-content h1 { font-size: 14px; } .answer-content h2 { font-size: 13px; } .answer-content h3 { font-size: 12px; }
        .answer-content pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 10px; overflow: auto; margin: 0; font-family: var(--vscode-editor-font-family, monospace); white-space: pre; word-break: normal; }
        .answer-content code { background: rgba(255,255,255,0.08); color: #f8fafc; padding: 2px 5px; border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 10.5px; }
        .answer-content pre code { background: transparent; padding: 0; color: inherit; }
        .answer-content table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; }
        .answer-content th, .answer-content td { border: 1px solid var(--vscode-input-border); padding: 6px 10px; text-align: left; }
        .answer-content th { background: rgba(255,255,255,0.06); color: var(--user-header-color); font-weight: bold; }
        .answer-content tr:nth-child(even) { background: rgba(255,255,255,0.03); }
        .answer-content ul, .answer-content ol { margin: 6px 0; padding-left: 20px; }
        .answer-content li { margin: 3px 0; }
        .answer-content blockquote { border-left: 3px solid var(--user-header-color); margin: 8px 0; padding-left: 10px; opacity: 0.9; font-style: italic; }
        .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-input-border); margin-bottom: 8px; padding-bottom: 4px; }
        .tab-btn { flex: 1; background: transparent; border: none; padding: 6px 4px; font-size: 10px; font-weight: bold; cursor: pointer; opacity: 0.6; border-radius: 4px; color: var(--vscode-foreground); }
        .tab-btn.active { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .tab-content { display: none !important; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
        .tab-content.active { display: flex !important; }
        .filter-tag { font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; }
        .filter-tag.ollama { background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); }
        .cmd-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; background: rgba(255,255,255,0.08); border: 1px solid var(--vscode-input-border); padding: 1px 5px; border-radius: 4px; }
        .cmd-badge button { background: transparent; border: none; color: #f87171; font-weight: bold; cursor: pointer; padding: 0 2px; }
        .input-box { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; background: transparent; position: relative; }
        textarea { resize: none; width: 100%; box-sizing: border-box; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
        .menu-dropdown { position: absolute; bottom: 35px; left: 0; background: var(--vscode-menu-background); border: 1px solid var(--vscode-menu-border); border-radius: 6px; display: none; flex-direction: column; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.5); width: 220px; }
        .menu-item { padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-menu-foreground); }
        .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        .btn-add, .btn-compress, .btn-clear { background: transparent; border: 1px solid var(--vscode-input-border); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 10px; }
        .btn-clear { color: #f87171; border-color: rgba(248,113,113,0.4); }
        .btn-send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; padding: 5px 12px; font-weight: bold; }
        .btn-settings { background: transparent; border: none; cursor: pointer; font-size: 14px; padding: 2px 4px; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 200; justify-content: center; align-items: center; }
        .modal-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); padding: 14px; border-radius: 8px; width: 94%; max-width: 520px; max-height: 88vh; resize: both; overflow: auto; min-width: 280px; min-height: 320px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.7); }
        .modal-card h4 { margin: 0; font-size: 12px; }
        .field { display: flex; flex-direction: column; gap: 3px; font-size: 10px; }
        .model-picker-wrapper {
            position: relative;
            display: inline-block;
        }
        .model-picker-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            background: var(--vscode-input-background, #1e293b);
            color: #38bdf8;
            border: 1px solid var(--vscode-input-border, #334155);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            outline: none;
            transition: all 0.2s ease;
        }
        .model-picker-btn:hover {
            border-color: #38bdf8;
        }
        .model-popover-card {
            display: none;
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            width: 270px;
            max-height: 340px;
            background: var(--vscode-editor-background, #111827);
            border: 1px solid var(--vscode-input-border, #374151);
            border-radius: 8px;
            box-shadow: 0 -10px 30px rgba(0,0,0,0.8);
            z-index: 999;
            padding: 8px;
            flex-direction: column;
            gap: 6px;
            user-select: none;
        }
        .model-popover-card.open {
            display: flex;
        }
        .popover-search-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-input-border, #1f2937);
        }
        .popover-search-row input {
            flex: 1;
            background: var(--vscode-input-background, #1f2937);
            color: var(--vscode-input-foreground, #f9fafb);
            border: 1px solid var(--vscode-input-border, #374151);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 11px;
            outline: none;
        }
        .popover-gear-btn {
            background: transparent;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            font-size: 13px;
        }
        .popover-gear-btn:hover {
            color: #ffffff;
        }
        .popover-model-list {
            display: flex;
            flex-direction: column;
            gap: 2px;
            max-height: 180px;
            overflow-y: auto;
        }
        .popover-model-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            color: var(--vscode-foreground, #e5e7eb);
            transition: background 0.15s ease;
        }
        .popover-model-item:hover {
            background: rgba(56, 189, 248, 0.15);
        }
        .popover-model-item.selected {
            background: rgba(56, 189, 248, 0.25);
            color: #38bdf8;
            font-weight: bold;
        }
        .popover-model-badge {
            font-size: 9px;
            color: #9ca3af;
        }
        .popover-accordion-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 8px;
            background: var(--vscode-input-background, #1f2937);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            color: #9ca3af;
            margin-top: 4px;
        }
        .popover-accordion-header:hover {
            color: #ffffff;
        }
        .popover-accordion-content {
            display: none;
            flex-direction: column;
            gap: 2px;
            margin-top: 4px;
            max-height: 120px;
            overflow-y: auto;
        }
        .popover-accordion-content.open {
            display: flex;
        }
    </style>
</head>
<body>
        <div class="header">
            <div style="font-size: 11px; font-weight: 600; color: #38bdf8; display:flex; align-items:center; gap:8px;">
                <span>🤖 Giskard Assistant</span>
                <button class="btn-new-chat" id="new-chat-btn" title="Nuevo Chat (Nueva conversación)" style="background:rgba(56, 189, 248, 0.15); border:1px solid rgba(56, 189, 248, 0.4); color:#38bdf8; border-radius:4px; cursor:pointer; font-size:10px; font-weight:bold; padding:2px 8px; display:flex; align-items:center; gap:4px;">
                    <span>➕ Nuevo Chat</span>
                </button>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
                <button class="btn-clear" id="clear-ctx-btn" title="Limpiar Conversación Activa" style="background:transparent;border:none;cursor:pointer;font-size:13px;padding:2px 4px;">🗑️</button>
            </div>
        </div>

        <div class="status-bar">
            <span id="token-counter">${i18n.status.tokens}: 0</span>
            <span class="offline-badge" id="offline-badge">${i18n.status.offline}</span>
            <button class="btn-compress" id="compress-btn" title="${i18n.chat.compress}">${i18n.chat.compress}</button>
        </div>

        <div class="messages" id="messages"></div>

        <div class="input-box">
            <div class="menu-dropdown" id="context-menu">
                <div class="menu-item" id="ctx-mentions">@ Mentions (@file, @git)</div>
                <div class="menu-item" id="ctx-graphify">🕸️ Indexar Grafo LTM (Graphify)</div>
                <div class="menu-item" id="ctx-skills">🎯 Agent Skills (Habilidades)</div>
            </div>
            <textarea id="prompt" rows="2" placeholder="${i18n.chat.placeholder}"></textarea>
            <div class="toolbar">
                <button class="btn-add" id="add-ctx-btn">+ Context</button>

                <!-- OPilot Model Picker next to + Context -->
                <div class="model-picker-wrapper">
                    <button class="model-picker-btn" id="model-picker-btn" type="button">
                        <span id="active-model-name">🤖 Modelo</span>
                        <span style="font-size:9px;">▾</span>
                    </button>

                    <!-- OPilot Popover Popup Card -->
                    <div class="model-popover-card" id="model-popover-card">
                        <div class="popover-search-row">
                            <input type="text" id="popover-search-input" placeholder="Search models...">
                        </div>

                        <div class="popover-model-list" id="popover-model-list">
                            <!-- Populated with active models -->
                        </div>

                        <div class="popover-accordion-header" id="popover-other-toggle">
                            <span id="accordion-arrow">›</span>
                            <span>Other Models</span>
                        </div>
                        <div class="popover-accordion-content" id="popover-other-list">
                            <!-- All other models -->
                        </div>
                    </div>
                </div>

                <button id="send-btn" class="btn-send">${i18n.chat.send}</button>
                <button id="stop-btn" class="btn-send" style="display: none; background: #ef4444; border-color: #ef4444; color: #ffffff;">${i18n.chat.stop}</button>
            </div>
        </div>
    </div>

    <script src="${markedUri}"></script>
    <script src="${highlightUri}"></script>
    <script src="${chatUtilsUri}"></script>
    <script src="${connectionsViewUri}"></script>
    <script src="${mcpViewUri}"></script>
    <script src="${chatViewUri}"></script>
</body>
</html>`;
}
