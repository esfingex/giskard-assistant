/**
 * Giskard Assistant VSCode Extension — Module: HTML Shell & CSS Styling
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { loadTranslations } from '../core/i18n';

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'marked.min.js'));
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
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="header">
            <button class="btn-settings" id="open-settings-btn" title="${i18n.status.settings}">⚙️</button>
            <select id="model-select">
                <optgroup label="Local Swarm (Ollama)">
                    <option value="">— Select AI model —</option>
                </optgroup>
            </select>
            <button class="btn-clear" id="clear-ctx-btn" title="${i18n.status.clearContext}">🗑️</button>
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
            </div>
            <textarea id="prompt" rows="2" placeholder="${i18n.chat.placeholder}"></textarea>
            <div class="toolbar">
                <button class="btn-add" id="add-ctx-btn">+ Context</button>
                <label><input type="checkbox" id="inc-file"> Active File</label>
                <button id="send-btn" class="btn-send">${i18n.chat.send}</button>
                <button id="stop-btn" class="btn-send" style="display: none; background: #ef4444; border-color: #ef4444; color: #ffffff;">${i18n.chat.stop}</button>
            </div>
        </div>
    </div>

    <!-- Connector & MCP Settings Modal -->
    <div class="modal" id="settings-modal">
        <div class="modal-card">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--vscode-input-border); padding-bottom:6px; margin-bottom:2px;">
                <h4 style="margin:0; font-size:12px; font-weight:bold; color:var(--vscode-foreground);">⚙️ ${i18n.connections.title}</h4>
                <button type="button" id="close-modal-btn" style="background:transparent; border:none; color:#f87171; font-weight:bold; font-size:14px; cursor:pointer; padding:0 4px;" title="Close (Esc)">✖</button>
            </div>
            <div class="tab-nav">
                <button type="button" class="tab-btn active" id="tab-btn-local">${i18n.tabs.local}</button>
                <button type="button" class="tab-btn" id="tab-btn-remote">${i18n.tabs.remote}</button>
                <button type="button" class="tab-btn" id="tab-btn-mcp">${i18n.tabs.mcp}</button>
                <button type="button" class="tab-btn" id="tab-btn-palette">${i18n.tabs.palette}</button>
            </div>

            <!-- Tab 1: Local AI -->
            <div class="tab-content active" id="tab-content-local">
                <div class="field" style="flex:1; display:flex; flex-direction:column; min-height:0;">
                    <label style="font-weight:bold; font-size:11px; margin-bottom:4px;">🎯 Models Visible in Dropdown:</label>
                    <div id="model-filter-list" style="flex:1; min-height:180px; max-height:100%; overflow-y:auto; border: 1px solid var(--vscode-input-border); padding: 8px; border-radius: 4px; background: rgba(0,0,0,0.15);">Loading models...</div>
                </div>
            </div>

            <!-- Tab 2: Remote Connections -->
            <div class="tab-content" id="tab-content-remote">
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; gap:8px; align-items:center; font-size:10px;">
                        <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
                            <input type="radio" name="conn-type" id="conn-type-local" value="local" checked> Local URL
                        </label>
                        <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
                            <input type="radio" name="conn-type" id="conn-type-remote" value="remote"> Remote URL + Token
                        </label>
                    </div>
                    <div class="field">
                        <label>${i18n.connections.name}</label>
                        <input type="text" id="conn-name" placeholder="my-giskard-local">
                    </div>
                    <div class="field">
                        <label>${i18n.connections.url}</label>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <input type="text" id="conn-url" placeholder="http://localhost:3500" style="flex:1;">
                            <button type="button" id="test-connection-btn" style="padding:3px 7px;font-size:10px;background:transparent;border:1px solid #38bdf8;color:#38bdf8;border-radius:4px;cursor:pointer;white-space:nowrap;font-weight:bold;">${i18n.connections.test}</button>
                        </div>
                        <div id="connection-status" style="font-size:9px;margin-top:3px;min-height:14px;display:flex;align-items:center;gap:4px;"></div>
                    </div>
                    <div class="field">
                        <label>${i18n.connections.tag}</label>
                        <select id="conn-tag">
                            <option value="giskard-sys">🦀 giskard-sys (Local Rust Axum @ 3500)</option>
                            <option value="nvidia">🟢 NVIDIA NIM API (https://integrate.api.nvidia.com/v1)</option>
                            <option value="deepseek">🐳 DeepSeek API (https://api.deepseek.com/v1)</option>
                            <option value="kimi">🌙 Moonshot Kimi API (https://api.moonshot.cn/v1)</option>
                            <option value="qwen">☁️ Qwen / DashScope API (https://dashscope.aliyuncs.com/compatible-mode/v1)</option>
                            <option value="ollama">🦙 Ollama Local (http://localhost:11434)</option>
                            <option value="openai">⚡ OpenAI API (https://api.openai.com/v1)</option>
                            <option value="anthropic">🧠 Anthropic Claude API</option>
                            <option value="gemini">✨ Google Gemini API</option>
                            <option value="lm-studio">💻 LM Studio / vLLM (Local)</option>
                            <option value="custom">✅ Custom API…</option>
                        </select>
                    </div>
                    <div class="field" id="conn-token-field" style="display:none;">
                        <label>${i18n.connections.apiKey}</label>
                        <input type="password" id="conn-token" placeholder="sk-… / Bearer token">
                    </div>
                    <button type="button" id="add-connection-btn" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:bold;">${i18n.connections.add}</button>
                </div>

                <div style="margin-top:8px; flex:1; display:flex; flex-direction:column; min-height:0;">
                    <div style="font-size:9px;font-weight:bold;color:#38bdf8;margin-bottom:4px;border-bottom:1px solid rgba(56,189,248,0.2);padding-bottom:2px;">Saved AI Connections</div>
                    <div id="connections-list" style="display:flex;flex-direction:column;gap:4px;flex:1;min-height:120px;overflow-y:auto;"><span style="font-size:9px;opacity:0.5;">No saved connections</span></div>
                </div>
            </div>
            
            <!-- Tab 3: MCP Servers -->
            <div class="tab-content" id="tab-content-mcp">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:10px; font-weight:bold; color:#34d399;">${i18n.mcp.title}</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <div class="field">
                        <label>${i18n.mcp.name}</label>
                        <input type="text" id="mcp-name" placeholder="mcpo-docker / sqlite-mcp">
                    </div>
                    <div class="field">
                        <label>${i18n.mcp.type}</label>
                        <select id="mcp-type">
                            <option value="docker">🐳 Docker Container</option>
                            <option value="stdio">💻 Local STDIO Script (npx / node / python)</option>
                            <option value="url">🌐 HTTP SSE Endpoint</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>${i18n.mcp.cmd}</label>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <input type="text" id="mcp-cmd" placeholder="npx -y @modelcontextprotocol/server-filesystem ./ or python3 mcp_server.py" style="flex:1;">
                            <button type="button" id="test-mcp-btn" style="padding:3px 7px;font-size:10px;background:transparent;border:1px solid #34d399;color:#34d399;border-radius:4px;cursor:pointer;white-space:nowrap;font-weight:bold;">${i18n.mcp.test}</button>
                        </div>
                        <div id="mcp-status" style="font-size:9px;margin-top:3px;min-height:14px;display:flex;align-items:center;gap:4px;"></div>
                    </div>
                    <button type="button" id="add-mcp-btn" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:bold;">${i18n.mcp.add}</button>
                </div>

                <div style="margin-top:8px; flex:1; display:flex; flex-direction:column; min-height:0;">
                    <div style="font-size:9px;font-weight:bold;color:#34d399;margin-bottom:4px;border-bottom:1px solid rgba(52,211,153,0.2);padding-bottom:2px;">Registered MCP Servers</div>
                    <div id="mcp-servers-list" style="display:flex;flex-direction:column;gap:4px;flex:1;min-height:120px;overflow-y:auto;"><span style="font-size:9px;opacity:0.5;">No MCP servers registered</span></div>
                </div>
            </div>

            <!-- Tab 4: Color Palette -->
            <div class="tab-content" id="tab-content-palette">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 10px; font-weight: bold;">${i18n.palette.presets}</label>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
                        <button type="button" id="preset-white" style="font-size: 9px; padding: 4px 6px; background: #1e293b; color: #ffffff; border: 1px solid #475569; border-radius: 4px; cursor: pointer;">⚪ ${i18n.palette.white}</button>
                        <button type="button" id="preset-cyan" style="font-size: 9px; padding: 4px 6px; background: #0f172a; color: #38bdf8; border: 1px solid #38bdf8; border-radius: 4px; cursor: pointer;">🔵 ${i18n.palette.cyan}</button>
                        <button type="button" id="preset-emerald" style="font-size: 9px; padding: 4px 6px; background: #064e3b; color: #34d399; border: 1px solid #34d399; border-radius: 4px; cursor: pointer;">🟢 ${i18n.palette.emerald}</button>
                        <button type="button" id="preset-purple" style="font-size: 9px; padding: 4px 6px; background: #3b0764; color: #c084fc; border: 1px solid #c084fc; border-radius: 4px; cursor: pointer;">🟣 ${i18n.palette.purple}</button>
                    </div>
                    <div class="field"><label>${i18n.palette.userFont}</label><input type="color" id="palette-text-color" value="#f8fafc" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>${i18n.palette.headerFont}</label><input type="color" id="palette-header-color" value="#ffffff" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>${i18n.palette.accentColor}</label><input type="color" id="palette-accent-color" value="#38bdf8" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>${i18n.palette.userBg}</label><input type="color" id="palette-user-bg" value="#0284c7" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>${i18n.palette.botBg}</label><input type="color" id="palette-bot-bg" value="#1e293b" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                    <div class="field"><label>${i18n.palette.thinkBg}</label><input type="color" id="palette-think-bg" value="#0f172a" style="height: 24px; padding: 2px; cursor: pointer; width: 100%;"></div>
                </div>
            </div>
        </div>
    </div>

    <script src="${markedUri}"></script>
    <script src="${chatUtilsUri}"></script>
    <script src="${connectionsViewUri}"></script>
    <script src="${mcpViewUri}"></script>
    <script src="${chatViewUri}"></script>
</body>
</html>`;
}
