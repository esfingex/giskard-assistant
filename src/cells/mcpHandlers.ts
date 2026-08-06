/**
 * Giskard Assistant VSCode Extension — Module: MCP Server Handlers
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { ConnectionStore, McpTool } from '../core/connectionStore';
import { fetchWithTimeout, execCliCommand } from '../core/api';

export async function sendMcpServersList(view: vscode.WebviewView | undefined, store: ConnectionStore) {
    if (!view) return;
    const servers = store.getMcpServers();
    view.webview.postMessage({ type: 'mcpServersLoaded', servers });
}

export async function handleAddMcpServer(
    view: vscode.WebviewView | undefined,
    store: ConnectionStore,
    name: string,
    type: 'docker' | 'stdio' | 'url',
    commandOrUrl: string
) {
    if (!view) return;
    try {
        const id = await store.addMcpServer(name, type, commandOrUrl);
        vscode.window.showInformationMessage(`✓ MCP Server "${name}" saved.`);
        await handleDiscoverMcpTools(view, store, id);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error adding MCP server: ${err.message}`);
    }
}

export async function handleRemoveMcpServer(view: vscode.WebviewView | undefined, store: ConnectionStore, id: number) {
    if (!view) return;
    try {
        await store.removeMcpServer(id);
        vscode.window.showInformationMessage(`✓ MCP server removed.`);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error removing MCP server: ${err.message}`);
    }
}

export async function handleToggleMcpServer(view: vscode.WebviewView | undefined, store: ConnectionStore, id: number) {
    if (!view) return;
    try {
        await store.toggleMcpServer(id);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error toggling MCP server state: ${err.message}`);
    }
}

export async function handleToggleMcpTool(
    view: vscode.WebviewView | undefined,
    store: ConnectionStore,
    serverId: number,
    toolId: string
) {
    if (!view) return;
    try {
        await store.toggleMcpTool(serverId, toolId);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error toggling MCP tool state: ${err.message}`);
    }
}

/** Queries Smithery registry API/CLI for MCP servers */
export async function handleSearchSmitheryRegistry(view: vscode.WebviewView | undefined, query: string) {
    if (!view || !query || !query.trim()) return;
    try {
        const resData: any = await execCliCommand('npx', '-y', '@smithery/cli', 'mcp', 'search', query.trim(), '--json');
        let results: any[] = [];
        if (resData && resData.success && resData.data) {
            try {
                const parsed = typeof resData.data === 'string' ? JSON.parse(resData.data) : resData.data;
                if (parsed && Array.isArray(parsed.servers)) {
                    results = parsed.servers;
                }
            } catch { }
        }
        view.webview.postMessage({ type: 'smitherySearchResults', query: query.trim(), results });
    } catch (err: any) {
        view.webview.postMessage({ type: 'smitherySearchResults', query: query.trim(), error: err.message, results: [] });
    }
}

/** Queries live SSE MCP Server (e.g. Supergateway on http://localhost:3070/sse) over SSE transport using global fetch */
export async function querySseMcpTools(serverUrl: string): Promise<McpTool[]> {
    try {
        let cleanUrl = serverUrl.trim();
        if (!cleanUrl.endsWith('/sse') && !cleanUrl.includes('openapi.json') && !cleanUrl.includes('/tools')) {
            cleanUrl = `${cleanUrl.replace(/\/$/, '')}/sse`;
        }

        const baseUrl = cleanUrl.substring(0, cleanUrl.indexOf('/sse'));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(cleanUrl, {
            headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
            signal: controller.signal
        });

        if (!response.ok || !response.body) {
            clearTimeout(timeout);
            return [];
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let sessionPath = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value);
            const match = text.match(/data:\s*(\/message\?sessionId=[\w-]+)/);

            if (match && !sessionPath) {
                sessionPath = match[1];
                const fullMsgUrl = `${baseUrl}${sessionPath}`;

                // 1. Send initialize
                await fetch(fullMsgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'giskard-assistant', version: '4.2.0' } }
                    })
                }).catch(() => null);

                // 2. Send initialized notification
                fetch(fullMsgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
                }).catch(() => null);

                // 3. Request tools list
                await fetch(fullMsgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
                }).catch(() => null);
            }

            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const jsonStr = line.substring(5).trim();
                    try {
                        const json = JSON.parse(jsonStr);
                        if (json.result && Array.isArray(json.result.tools)) {
                            clearTimeout(timeout);
                            try { reader.cancel(); } catch { }
                            return json.result.tools.map((t: any) => ({
                                id: t.name || t.id,
                                name: t.name || 'tool',
                                description: t.description || t.title || 'Herramienta MCP autogenerada dinámicamente',
                                enabled: true
                            }));
                        }
                    } catch { }
                }
            }
        }
        clearTimeout(timeout);
    } catch (err) {
        console.warn('[Giskard] Error querying SSE MCP tools:', err);
    }
    return [];
}

/** Queries live STDIO MCP process via JSON-RPC tools/list to dynamically autogenerate tools list */
export async function queryStdioMcpTools(commandOrUrl: string): Promise<McpTool[]> {
    return new Promise((resolve) => {
        const parts = commandOrUrl.trim().split(/\s+/);
        if (parts.length === 0) return resolve([]);

        let proc: any;
        try {
            proc = cp.spawn(commandOrUrl.trim(), [], { shell: true });
        } catch {
            return resolve([]);
        }

        let output = '';
        let timeout = setTimeout(() => {
            try { proc.kill(); } catch { }
            resolve([]);
        }, 5000);

        proc.stdout?.on('data', (data: Buffer) => {
            output += data.toString('utf-8');
            const lines = output.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line.trim());
                    if (json.result && Array.isArray(json.result.tools)) {
                        clearTimeout(timeout);
                        try { proc.kill(); } catch { }
                        const tools: McpTool[] = json.result.tools.map((t: any) => ({
                            id: t.name || t.id,
                            name: t.name || 'tool',
                            description: t.description || t.title || 'Herramienta MCP autogenerada dinámicamente',
                            enabled: true
                        }));
                        return resolve(tools);
                    }
                } catch { }
            }
        });

        proc.on('error', () => {
            clearTimeout(timeout);
            resolve([]);
        });

        try {
            const initReq = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'giskard-assistant', version: '4.2.0' }
                }
            }) + '\n';

            proc.stdin.write(initReq);

            setTimeout(() => {
                try {
                    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
                    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
                } catch { }
            }, 400);
        } catch { }
    });
}

export async function handleDiscoverMcpTools(
    view: vscode.WebviewView | undefined,
    store: ConnectionStore,
    serverId: number
) {
    if (!view) return;
    const server = store.getMcpServers().find(s => s.id === serverId);
    if (!server) return;

    try {
        let tools: McpTool[] = [];
        let baseUrl = server.commandOrUrl.trim();

        if (baseUrl.startsWith('http')) {
            const cleanUrl = baseUrl.replace(/\/$/, '');

            const openApiRes = await fetchWithTimeout(`${cleanUrl}/openapi.json`, {}, 4000).catch(() => null);
            if (openApiRes && openApiRes.ok) {
                const openApiData: any = await openApiRes.json().catch(() => null);
                if (openApiData && openApiData.info && openApiData.info.description) {
                    const desc = openApiData.info.description;
                    const matches: any[] = Array.from(desc.matchAll(/\[(.*?)\]\((.*?)\)/g));
                    for (const m of matches) {
                        const toolCategory = m[1];
                        const docPath = m[2];
                        const apiPath = docPath.replace('/docs', '/openapi.json');
                        const subRes = await fetchWithTimeout(`${cleanUrl}${apiPath}`, {}, 4000).catch(() => null);
                        if (subRes && subRes.ok) {
                            const subData: any = await subRes.json().catch(() => null);
                            if (subData && subData.paths) {
                                Object.keys(subData.paths).forEach(p => {
                                    const toolName = p.replace(/^\//, '');
                                    if (toolName) {
                                        tools.push({
                                            id: `${toolCategory}:${toolName}`,
                                            name: `${toolName}`,
                                            description: `Servicio MCP ${toolCategory} (${cleanUrl}/${toolCategory}/${toolName})`,
                                            enabled: true
                                        });
                                    }
                                });
                            }
                        }
                    }
                }

                if (tools.length === 0 && openApiData && openApiData.paths) {
                    Object.keys(openApiData.paths).forEach(p => {
                        const toolName = p.replace(/^\//, '');
                        if (toolName) {
                            tools.push({
                                id: toolName,
                                name: toolName,
                                description: 'Herramienta MCP OpenAPI',
                                enabled: true
                            });
                        }
                    });
                }
            }

            if (tools.length === 0) {
                const toolsRes = await fetchWithTimeout(`${cleanUrl}/tools`, {}, 4000).catch(() => null);
                if (toolsRes && toolsRes.ok) {
                    const toolsData: any = await toolsRes.json().catch(() => null);
                    if (toolsData && Array.isArray(toolsData.tools)) {
                        tools = toolsData.tools.map((t: any) => ({
                            id: t.name || t.id,
                            name: t.name || 'Tool',
                            description: t.description || 'Herramienta MCP HTTP',
                            enabled: true
                        }));
                    }
                }
            }

            // If HTTP endpoints didn't return tools, query via SSE (Supergateway / MCP SSE transport)
            if (tools.length === 0) {
                tools = await querySseMcpTools(cleanUrl);
            }
        }

        // STDIO JSON-RPC autogeneration: Query live running MCP process over stdin/stdout
        if (tools.length === 0) {
            tools = await queryStdioMcpTools(server.commandOrUrl);
        }

        await store.updateMcpTools(serverId, tools);
        vscode.window.showInformationMessage(`✓ ${tools.length} MCP tools discovered dynamically for "${server.name}".`);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error discovering MCP tools: ${err.message}`);
    }
}

export async function handleTestMcpServer(view: vscode.WebviewView | undefined, type: string, commandOrUrl: string) {
    if (!view) return;
    const start = Date.now();
    try {
        let testUrl = commandOrUrl.trim();

        if (testUrl.startsWith('http')) {
            const sseUrl = testUrl.endsWith('/sse') ? testUrl : `${testUrl.replace(/\/$/, '')}/sse`;
            const sseRes = await fetchWithTimeout(sseUrl, { headers: { 'Accept': 'text/event-stream' } }, 4000).catch(() => null);
            const isSseOk = Boolean(sseRes && (sseRes.ok || sseRes.status === 200));

            if (isSseOk) {
                const ms = Date.now() - start;
                return view.webview.postMessage({ type: 'mcpTested', ok: true, ms });
            }

            const mainRes = await fetchWithTimeout(testUrl, {}, 4000).catch(() => null);
            const ms = Date.now() - start;
            const ok = Boolean(mainRes && (mainRes.ok || mainRes.status === 404 || mainRes.status === 200));
            view.webview.postMessage({
                type: 'mcpTested',
                ok,
                error: ok ? undefined : (mainRes ? `HTTP ${mainRes.status}` : 'No response from server'),
                ms
            });
        } else if (type === 'docker') {
            const resData: any = await execCliCommand('docker', 'ps');
            const ms = Date.now() - start;
            const ok = resData.success;
            view.webview.postMessage({
                type: 'mcpTested',
                ok,
                error: ok ? undefined : (resData.error || 'Docker not responding'),
                ms
            });
        } else {
            const ms = Date.now() - start;
            view.webview.postMessage({
                type: 'mcpTested',
                ok: true,
                ms
            });
        }
    } catch (err: any) {
        const ms = Date.now() - start;
        view.webview.postMessage({
            type: 'mcpTested',
            ok: false,
            error: err.message,
            ms
        });
    }
}

export function getActiveMcpPromptContext(store: ConnectionStore): string {
    const activeMcpServers = store.getMcpServers().filter(s => s.isActive);
    if (activeMcpServers.length === 0) return '';

    let text = '[Active Connected MCP Services in Environment]:\n';
    activeMcpServers.forEach(s => {
        text += `\n▶ MCP Server: ${s.name} [${s.type.toUpperCase()}] (${s.commandOrUrl})\n`;
        if (s.tools && s.tools.length > 0) {
            const enabledTools = s.tools.filter(t => t.enabled);
            if (enabledTools.length > 0) {
                text += '  Enabled Services/Tools:\n';
                enabledTools.forEach(t => {
                    text += `  - ${t.name}: ${t.description}\n`;
                });
            } else {
                text += '  (No individual tools enabled)\n';
            }
        } else {
            text += '  Enabled Services/Tools: (General server access)\n';
        }
    });
    return text + '\n';
}
