/**
 * Giskard Assistant VSCode Extension — Module: MCP Server Handlers
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import * as urlModule from 'url';
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
        vscode.window.showInformationMessage(`✓ Servidor MCP "${name}" guardado.`);
        await handleDiscoverMcpTools(view, store, id);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error añadiendo servidor MCP: ${err.message}`);
    }
}

export async function handleRemoveMcpServer(view: vscode.WebviewView | undefined, store: ConnectionStore, id: number) {
    if (!view) return;
    try {
        await store.removeMcpServer(id);
        vscode.window.showInformationMessage(`✓ Servidor MCP eliminado.`);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error eliminando servidor MCP: ${err.message}`);
    }
}

export async function handleToggleMcpServer(view: vscode.WebviewView | undefined, store: ConnectionStore, id: number) {
    if (!view) return;
    try {
        await store.toggleMcpServer(id);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error cambiando estado de MCP: ${err.message}`);
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
        vscode.window.showErrorMessage(`Error cambiando estado de herramienta MCP: ${err.message}`);
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

/** Queries live SSE MCP Server (e.g. Supergateway on http://localhost:3070/sse) over SSE transport */
export async function querySseMcpTools(serverUrl: string): Promise<McpTool[]> {
    return new Promise((resolve) => {
        let cleanUrl = serverUrl.trim();
        if (!cleanUrl.endsWith('/sse') && !cleanUrl.includes('openapi.json') && !cleanUrl.includes('/tools')) {
            cleanUrl = `${cleanUrl.replace(/\/$/, '')}/sse`;
        }

        let parsed: any;
        try {
            parsed = urlModule.parse(cleanUrl);
        } catch {
            return resolve([]);
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        let sessionPath = '';
        let resolvedTools: McpTool[] = [];
        let req: any;

        const timeout = setTimeout(() => {
            if (req) { try { req.destroy(); } catch { } }
            resolve(resolvedTools);
        }, 5000);

        try {
            req = transport.get(cleanUrl, { headers: { 'Accept': 'text/event-stream' } }, (res: any) => {
                let sseBuffer = '';
                res.on('data', (chunk: Buffer) => {
                    sseBuffer += chunk.toString('utf-8');
                    const match = sseBuffer.match(/data:\s*(\/message\?sessionId=[\w-]+)/);
                    if (match && !sessionPath) {
                        sessionPath = match[1];

                        const sendJson = (obj: any) => {
                            const data = JSON.stringify(obj);
                            const pReq = transport.request({
                                hostname: parsed.hostname,
                                port: parsed.port,
                                path: sessionPath,
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                            }, () => { });
                            pReq.on('error', () => { });
                            pReq.write(data);
                            pReq.end();
                        };

                        sendJson({
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'initialize',
                            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'giskard-assistant', version: '4.2.0' } }
                        });

                        setTimeout(() => {
                            sendJson({ jsonrpc: '2.0', method: 'notifications/initialized' });
                            sendJson({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
                        }, 300);
                    }

                    const lines = sseBuffer.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const jsonStr = line.substring(5).trim();
                            try {
                                const json = JSON.parse(jsonStr);
                                if (json.result && Array.isArray(json.result.tools)) {
                                    clearTimeout(timeout);
                                    if (req) { try { req.destroy(); } catch { } }
                                    resolvedTools = json.result.tools.map((t: any) => ({
                                        id: t.name || t.id,
                                        name: t.name || 'tool',
                                        description: t.description || t.title || 'Herramienta MCP autogenerada dinámicamente',
                                        enabled: true
                                    }));
                                    return resolve(resolvedTools);
                                }
                            } catch { }
                        }
                    }
                });

                res.on('error', () => {
                    clearTimeout(timeout);
                    resolve(resolvedTools);
                });
            });

            req.on('error', () => {
                clearTimeout(timeout);
                resolve(resolvedTools);
            });
        } catch {
            clearTimeout(timeout);
            resolve(resolvedTools);
        }
    });
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
        vscode.window.showInformationMessage(`✓ ${tools.length} herramientas/servicios descubiertos dinámicamente en tiempo real para "${server.name}".`);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error descubriendo herramientas MCP: ${err.message}`);
    }
}

export async function handleTestMcpServer(view: vscode.WebviewView | undefined, type: string, commandOrUrl: string) {
    if (!view) return;
    const start = Date.now();
    try {
        let testUrl = commandOrUrl.trim();

        if (testUrl.startsWith('http')) {
            const sseUrl = testUrl.endsWith('/sse') ? testUrl : `${testUrl.replace(/\/$/, '')}/sse`;
            const sseRes = await fetchWithTimeout(sseUrl, {}, 4000).catch(() => null);
            const isSseOk = sseRes && (sseRes.ok || sseRes.status === 200);

            if (isSseOk) {
                const ms = Date.now() - start;
                return view.webview.postMessage({ type: 'mcpTested', ok: true, ms });
            }

            const mainRes = await fetchWithTimeout(testUrl, {}, 4000).catch(() => null);
            const ms = Date.now() - start;
            const ok = mainRes && (mainRes.ok || mainRes.status === 404 || mainRes.status === 200);
            view.webview.postMessage({
                type: 'mcpTested',
                ok: Boolean(ok),
                error: ok ? undefined : `HTTP ${mainRes?.status || 'Error'}`,
                ms
            });
        } else if (type === 'docker') {
            const resData: any = await execCliCommand('docker', 'ps');
            const ms = Date.now() - start;
            const ok = resData.success;
            view.webview.postMessage({
                type: 'mcpTested',
                ok,
                error: ok ? undefined : (resData.error || 'Docker no responde'),
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

    let text = '[Servicios MCP Activos Conectados en el Entorno]:\n';
    activeMcpServers.forEach(s => {
        text += `\n▶ Servidor MCP: ${s.name} [${s.type.toUpperCase()}] (${s.commandOrUrl})\n`;
        if (s.tools && s.tools.length > 0) {
            const enabledTools = s.tools.filter(t => t.enabled);
            if (enabledTools.length > 0) {
                text += '  Herramientas/Servicios Habilitados:\n';
                enabledTools.forEach(t => {
                    text += `  - ${t.name}: ${t.description}\n`;
                });
            } else {
                text += '  (Sin herramientas individuales habilitadas)\n';
            }
        } else {
            text += '  Herramientas/Servicios Habilitados: (Acceso general al servidor)\n';
        }
    });
    return text + '\n';
}
