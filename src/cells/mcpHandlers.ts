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

/** Dynamically reads and imports MCP servers from user's configured mcpConfigPath (.json or .js) */
export async function handleImportMcpConfigFile(
    view: vscode.WebviewView | undefined,
    store: ConnectionStore,
    customPath?: string
) {
    if (!view) return;

    const config = vscode.workspace.getConfiguration('giskard-assistant');
    const configuredPath = config.get<string>('mcpConfigPath');
    const homedir = os.homedir();
    const activeWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const expandPath = (p?: string | null) => {
        if (!p) return null;
        if (p.startsWith('~')) return path.join(homedir, p.substring(1));
        return p;
    };

    const candidatePaths = [
        expandPath(customPath),
        expandPath(configuredPath),
        activeWorkspace ? path.join(activeWorkspace, 'mcpo_config', 'config.json') : null,
        activeWorkspace ? path.join(activeWorkspace, 'mcpo_config', 'mcp_conf.js') : null,
        activeWorkspace ? path.join(activeWorkspace, 'mcp_conf.js') : null,
        activeWorkspace ? path.join(activeWorkspace, 'config.json') : null,
        path.join(homedir, 'workspace', 'mcpo_config', 'config.json'),
        path.join(homedir, 'workspace', 'mcpo_config', 'mcp_conf.js'),
        path.join(homedir, 'mcpo_config', 'config.json'),
        path.join(homedir, '.config', 'giskard', 'config.json')
    ].filter((p): p is string => Boolean(p && typeof p === 'string'));

    let targetFile: string | null = null;
    for (const p of candidatePaths) {
        if (p && fs.existsSync(p)) {
            targetFile = p;
            break;
        }
    }

    if (!targetFile) {
        vscode.window.showWarningMessage('No se encontró archivo de configuración MCP (config.json o mcp_conf.js). Revisa el ajuste giskard-assistant.mcpConfigPath');
        return;
    }

    try {
        const content = fs.readFileSync(targetFile, 'utf-8');
        let mcpServers: Record<string, any> = {};

        if (targetFile.endsWith('.js') || targetFile.endsWith('.cjs')) {
            const jsonMatch = content.match(/mcpServers\s*:\s*(\{[\s\S]*?\})\s*[,\}]/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    mcpServers = Function(`"use strict"; return (${jsonMatch[1]});`)();
                } catch {
                    mcpServers = JSON.parse(content);
                }
            } else {
                try {
                    mcpServers = Function(`"use strict"; ${content}; return (typeof mcpServers !== "undefined" ? mcpServers : (typeof module !== "undefined" && module.exports ? module.exports.mcpServers || module.exports : {}));`)();
                } catch {
                    mcpServers = JSON.parse(content);
                }
            }
        } else {
            const json = JSON.parse(content);
            mcpServers = json.mcpServers || json;
        }

        if (!mcpServers || typeof mcpServers !== 'object') {
            vscode.window.showErrorMessage(`El archivo ${targetFile} no contiene una definición válida de "mcpServers".`);
            return;
        }

        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/workspace';
        let importedCount = 0;

        for (const key of Object.keys(mcpServers)) {
            const entry = mcpServers[key];
            const command = entry.command || (typeof entry === 'string' ? entry : '');
            const rawArgs: string[] = entry.args || [];
            const processedArgs = rawArgs.map((a: string) => a.replace(/\/workspace/g, workspacePath));
            const fullCommand = `${command} ${processedArgs.join(' ')}`.trim();

            const serverType: 'docker' | 'stdio' | 'url' = command.includes('docker') ? 'docker' : (command.includes('uvx') || command.includes('npx') || command.includes('node') || command.includes('python')) ? 'stdio' : 'url';

            await store.addMcpServer(key, serverType, fullCommand);
            importedCount++;
        }

        vscode.window.showInformationMessage(`✓ Se cargaron ${importedCount} servidores MCP dinámicamente desde ${targetFile}`);
        await sendMcpServersList(view, store);

        // Run dynamic tool discovery on all imported servers
        const servers = store.getMcpServers();
        for (const s of servers) {
            await handleDiscoverMcpTools(view, store, s.id);
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error al cargar configuración MCP desde ${targetFile}: ${err.message}`);
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
            // 1. Send initialize
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

            // 2. Send initialized notification and tools/list request
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
        }

        // 100% Dynamic STDIO JSON-RPC autogeneration: Query the live running MCP process over stdin/stdout
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
            const res = await fetchWithTimeout(testUrl, {}, 5000);
            const ms = Date.now() - start;
            view.webview.postMessage({
                type: 'mcpTested',
                ok: res.ok,
                error: res.ok ? undefined : `HTTP ${res.status}`,
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

/** Formats active MCP servers into a prompt context header string for LLM */
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
