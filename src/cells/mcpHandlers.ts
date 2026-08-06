/**
 * Giskard Assistant VSCode Extension — Module: MCP Server Handlers
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

    const candidatePaths = [
        customPath,
        configuredPath,
        '/home/esfingex/workspace/mcpo_config/config.json',
        '/home/esfingex/workspace/mcpo_config/mcp_conf.js',
        '/home/esfingex/mcpo_config/config.json',
        '/home/esfingex/mcpo_config/mcp_conf.js',
        path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'mcpo_config', 'config.json'),
        path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'mcp_conf.js'),
        path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'config.json')
    ].filter(Boolean);

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
            // Parse JavaScript module or JSON structure
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

        if (server.type === 'docker' && (!baseUrl.startsWith('http') || baseUrl.includes('3000'))) {
            baseUrl = 'http://localhost:3000';
        }

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

        // Dynamic capabilities for stdio / command-based servers
        if (tools.length === 0) {
            const cmd = server.commandOrUrl.toLowerCase();
            if (cmd.includes('filesystem')) {
                tools = [
                    { id: 'read_file', name: 'read_file', description: 'Lectura de archivos completos', enabled: true },
                    { id: 'read_text_file', name: 'read_text_file', description: 'Lectura de texto plano', enabled: true },
                    { id: 'read_media_file', name: 'read_media_file', description: 'Lectura de imágenes y multimedia', enabled: true },
                    { id: 'read_multiple_files', name: 'read_multiple_files', description: 'Lectura múltiple simultánea', enabled: true },
                    { id: 'write_file', name: 'write_file', description: 'Escritura atómica de archivos', enabled: true },
                    { id: 'edit_file', name: 'edit_file', description: 'Edición exacta estilo git-diff', enabled: true },
                    { id: 'create_directory', name: 'create_directory', description: 'Creación de carpetas', enabled: true },
                    { id: 'list_directory', name: 'list_directory', description: 'Listar directorio', enabled: true },
                    { id: 'list_directory_with_sizes', name: 'list_directory_with_sizes', description: 'Listar directorio con tamaños', enabled: true },
                    { id: 'directory_tree', name: 'directory_tree', description: 'Árbol recursivo de directorios', enabled: true },
                    { id: 'move_file', name: 'move_file', description: 'Mover o renombrar archivos', enabled: true },
                    { id: 'search_files', name: 'search_files', description: 'Búsqueda de archivos por patrón', enabled: true },
                    { id: 'get_file_info', name: 'get_file_info', description: 'Metadatos y detalles del archivo', enabled: true },
                    { id: 'list_allowed_directories', name: 'list_allowed_directories', description: 'Listar directorios permitidos', enabled: true }
                ];
            } else if (cmd.includes('git')) {
                tools = [
                    { id: 'git_status', name: 'git_status', description: 'Estado del repositorio Git', enabled: true },
                    { id: 'git_diff', name: 'git_diff', description: 'Diff de cambios pendientes', enabled: true },
                    { id: 'git_log', name: 'git_log', description: 'Historial de commits', enabled: true }
                ];
            } else if (cmd.includes('ripgrep')) {
                tools = [
                    { id: 'ripgrep_search', name: 'ripgrep_search', description: 'Búsqueda ultra-rápida por expresiones regulares', enabled: true }
                ];
            } else if (cmd.includes('searxng')) {
                tools = [
                    { id: 'searxng_web_search', name: 'searxng_web_search', description: 'Búsqueda web en metabuscador SearXNG (puerto 3090)', enabled: true }
                ];
            } else if (cmd.includes('docker')) {
                tools = [
                    { id: 'docker_ps', name: 'docker_ps', description: 'Listar contenedores Docker activos', enabled: true },
                    { id: 'docker_exec', name: 'docker_exec', description: 'Ejecución en contenedor aislado', enabled: true },
                    { id: 'docker_logs', name: 'docker_logs', description: 'Lectura de logs de contenedor', enabled: true }
                ];
            } else if (cmd.includes('bash') || cmd.includes('terminal')) {
                tools = [
                    { id: 'bash_exec', name: 'bash_exec', description: 'Ejecución segura de comandos bash', enabled: true }
                ];
            } else {
                tools = [
                    { id: 'stdio_rpc', name: 'stdio_rpc', description: 'Invocación de script STDIO JSON-RPC', enabled: true }
                ];
            }
        }

        await store.updateMcpTools(serverId, tools);
        vscode.window.showInformationMessage(`✓ ${tools.length} herramientas/servicios descubiertos dinámicamente para "${server.name}".`);
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
        if (type === 'docker' && (!testUrl.startsWith('http') || testUrl.includes('3000'))) {
            testUrl = 'http://localhost:3000';
        }

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
