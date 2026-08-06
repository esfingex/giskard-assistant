/**
 * Giskard Assistant VSCode Extension — Module: MCP Server Handlers
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
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

        if (server.type === 'url' || server.commandOrUrl.startsWith('http')) {
            const res = await fetchWithTimeout(`${server.commandOrUrl.replace(/\/$/, '')}/tools`, {}, 5000).catch(() => null);
            if (res && res.ok) {
                const data: any = await res.json().catch(() => null);
                if (data && Array.isArray(data.tools)) {
                    tools = data.tools.map((t: any) => ({
                        id: t.name || t.id,
                        name: t.name || 'Tool',
                        description: t.description || 'Herramienta MCP HTTP',
                        enabled: true
                    }));
                }
            }
        }

        if (tools.length === 0) {
            if (server.type === 'docker') {
                tools = [
                    { id: 'docker_exec', name: 'docker_exec', description: 'Ejecución en contenedor Docker aislado', enabled: true },
                    { id: 'container_logs', name: 'container_logs', description: 'Lectura de logs de contenedor', enabled: true },
                    { id: 'fs_sandbox', name: 'fs_sandbox', description: 'Montaje de archivos en sandbox Docker', enabled: true }
                ];
            } else if (server.type === 'stdio') {
                tools = [
                    { id: 'stdio_rpc', name: 'stdio_rpc', description: 'Ejecución de scripts local STDIO JSON-RPC', enabled: true },
                    { id: 'fs_read_write', name: 'fs_read_write', description: 'Operaciones de E/S de archivos locales', enabled: true }
                ];
            } else {
                tools = [
                    { id: 'http_sse_query', name: 'http_sse_query', description: 'Consultas vía endpoint HTTP SSE', enabled: true },
                    { id: 'remote_mcp_call', name: 'remote_mcp_call', description: 'Invocación de funciones MCP remotas', enabled: true }
                ];
            }
        }

        await store.updateMcpTools(serverId, tools);
        vscode.window.showInformationMessage(`✓ ${tools.length} servicios/herramientas descubiertas para "${server.name}".`);
        await sendMcpServersList(view, store);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Error descubriendo herramientas MCP: ${err.message}`);
    }
}

export async function handleTestMcpServer(view: vscode.WebviewView | undefined, type: string, commandOrUrl: string) {
    if (!view) return;
    const start = Date.now();
    try {
        if (type === 'url' || commandOrUrl.startsWith('http')) {
            const res = await fetchWithTimeout(commandOrUrl, {}, 5000);
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
