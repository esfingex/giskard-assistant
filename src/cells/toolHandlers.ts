/**
 * Giskard Assistant VSCode Extension — Module: Tool Call Handlers & Workspace Resolution
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { GiskardResponse, getConnectorUrl, getClientId, fetchWithTimeout } from '../core/api';
// Ciclo ESM seguro: function declarations hoisted, sin uso a nivel de evaluación de módulo.
import { applyCodeToDocument } from './toolApply';

export const DEFAULT_EXCLUDE_GLOB =
    '**/{node_modules,out,dist,target,build,coverage,.git,.gemini,.cache,venv,.venv}/**';

/** Real source/editor file extensions — used to avoid treating version strings or package names as file paths */
const SOURCE_FILE_EXT_RE =
    /\.(?:ts|tsx|js|jsx|json|py|rs|md|mdx|html|css|scss|sass|less|c|cpp|cc|h|hpp|go|yaml|yml|toml|sh|bash|zsh|fish|sql|vue|svelte|astro|java|kt|kts|rb|php|env|ini|cfg|conf|xml|svg|txt|lock|gradle|properties|nix|tf|proto|mjs|cjs|mts|cts)$/i;

/** Heuristic: is this string a plausible relative/absolute file path (and not a version or package name)? */
export function isLikelyFilePath(candidate: string): boolean {
    if (!candidate || candidate.length < 4 || candidate.includes(' ')) return false;
    if (/^v?\d+(\.\d+)+$/.test(candidate)) return false; // v1.0.0 / 1.2.3
    return SOURCE_FILE_EXT_RE.test(candidate);
}

export async function resolveWorkspaceFile(targetPath: string): Promise<vscode.TextDocument | null> {
    if (!targetPath || !targetPath.trim()) return null;
    let cleanPath = targetPath.trim();

    // Sandbox del workspace (default ON): las tools del agente solo tocan
    // archivos dentro del directorio del workspace — ni rutas absolutas
    // externas ni traversal con '../'. Se desactiva con la setting
    // giskard-assistant.workspaceSandbox = false.
    const sandbox = vscode.workspace
        .getConfiguration('giskard-assistant')
        .get<boolean>('workspaceSandbox', true);

    // Ignore requests to read build output / node_modules / git directories
    const lower = cleanPath.toLowerCase();
    if (
        lower.includes('node_modules/') ||
        lower.includes('dist/') ||
        lower.includes('out/') ||
        lower.includes('target/') ||
        lower.includes('.git/')
    ) {
        return null;
    }

    if (sandbox && cleanPath.split(/[\\/]/).includes('..')) {
        return null; // traversal fuera del workspace bloqueado
    }

    const insideWorkspace = (absPath: string): boolean => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return false;
        const root = folders[0].uri.fsPath.replace(/[\\/]$/, '');
        return absPath === root || absPath.startsWith(root + '/');
    };

    // 1. Absolute path check
    if (cleanPath.startsWith('/')) {
        if (sandbox && !insideWorkspace(vscode.Uri.file(cleanPath).fsPath)) {
            return null; // ruta absoluta fuera del workspace bloqueada
        }
        try {
            const uri = vscode.Uri.file(cleanPath);
            return await vscode.workspace.openTextDocument(uri);
        } catch {}
    }

    cleanPath = cleanPath.replace(/^\.\//, '').replace(/^\//, '');

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    // 2. Direct joinPath relative to workspace root
    try {
        const uri = vscode.Uri.joinPath(folders[0].uri, cleanPath);
        return await vscode.workspace.openTextDocument(uri);
    } catch {}

    // 3. Fallback search via findFiles excluding build/dependency dirs
    try {
        const fileName = cleanPath.split('/').pop() || cleanPath;
        const matches = await vscode.workspace.findFiles(`**/${fileName}`, DEFAULT_EXCLUDE_GLOB, 5);
        if (matches && matches.length > 0) {
            return await vscode.workspace.openTextDocument(matches[0]);
        }
    } catch {}

    return null;
}

export async function handleOpenFile(relativePath: string) {
    try {
        const doc = await resolveWorkspaceFile(relativePath);
        if (doc) {
            await vscode.window.showTextDocument(doc, { preview: false });
        } else {
            vscode.window.showErrorMessage(
                `Giskard: No se encontró el archivo '${relativePath}' en el workspace.`
            );
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Giskard: Error al abrir '${relativePath}': ${err.message}`);
    }
}

export async function handleToolReadFile(
    view: vscode.WebviewView | undefined,
    targetPath: string,
    id: number
) {
    if (!view) return;
    try {
        const doc = await resolveWorkspaceFile(targetPath);
        if (!doc) throw new Error(`Archivo no encontrado en el workspace: ${targetPath}`);
        let content = doc.getText();
        const MAX_READ_CHARS = 14000;
        if (content.length > MAX_READ_CHARS) {
            content =
                content.substring(0, MAX_READ_CHARS) +
                `\n\n... [Contenido optimizado a los primeros 14,000 caracteres de ${content.length.toLocaleString()} caracteres totales para máxima velocidad de inferencia]`;
        }
        view.webview.postMessage({ type: 'toolReadFileResult', id, content, path: targetPath });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolReadFileResult', id, error: err.message, path: targetPath });
    }
}

export async function handleToolWriteFile(
    view: vscode.WebviewView | undefined,
    targetPath: string,
    content: string,
    id: number
) {
    if (!view) return;
    try {
        const doc = await resolveWorkspaceFile(targetPath);
        if (doc) {
            // Smart-apply: partial edits with anchors; never silently destroy the file
            const result = await applyCodeToDocument(doc, content);
            await doc.save();
            await vscode.window.showTextDocument(doc, { preview: false });
            if (result.applied) {
                view.webview.postMessage({
                    type: 'toolWriteFileResult',
                    id,
                    success: true,
                    path: targetPath,
                    mode: result.mode
                });
            } else if (result.mode === 'noop') {
                view.webview.postMessage({
                    type: 'toolWriteFileResult',
                    id,
                    success: true,
                    path: targetPath,
                    mode: 'noop'
                });
            } else {
                view.webview.postMessage({
                    type: 'toolWriteFileResult',
                    id,
                    error: result.message || 'No se pudieron aplicar los cambios',
                    path: targetPath
                });
            }
        } else {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) throw new Error('No hay workspace abierto');
            const cleanRel = targetPath.replace(/^\.\//, '').replace(/^\//, '');
            const newUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
            const enc = new TextEncoder();
            await vscode.workspace.fs.writeFile(newUri, enc.encode(content));
            const newDoc = await vscode.workspace.openTextDocument(newUri);
            await vscode.window.showTextDocument(newDoc, { preview: false });
            view.webview.postMessage({
                type: 'toolWriteFileResult',
                id,
                success: true,
                path: targetPath,
                mode: 'new'
            });
        }
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolWriteFileResult', id, error: err.message, path: targetPath });
    }
}

export async function handleToolExec(
    view: vscode.WebviewView | undefined,
    command: string,
    args: string[],
    id: number
) {
    if (!view) return;
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
            body: JSON.stringify({ command, args })
        });
        const data: GiskardResponse<string> = await res.json();
        if (!data.success) throw new Error(data.error || 'Error ejecutando comando');
        view.webview.postMessage({ type: 'toolExecResult', id, output: data.data });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolExecResult', id, error: err.message });
    }
}

/** List directory entries (names only, bounded) so the model can explore the project structure */
export async function handleToolListDir(
    view: vscode.WebviewView | undefined,
    targetPath: string,
    id: number
) {
    if (!view) return;
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) throw new Error('No hay workspace abierto');
        const cleanRel = (targetPath || '').replace(/^\.\//, '').replace(/^\//, '');
        const dirUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        const sorted = entries
            .map(([name, type]) => (type === vscode.FileType.Directory ? '📁 ' : '📄 ') + name)
            .sort();
        const listing = sorted.slice(0, 200).join('\n');
        view.webview.postMessage({ type: 'toolListDirResult', id, path: targetPath || '.', listing });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolListDirResult', id, error: err.message, path: targetPath });
    }
}

/** Content grep across the workspace (bounded). Manual scan because @types/vscode lacks findTextInFiles */
export async function handleToolSearch(view: vscode.WebviewView | undefined, query: string, id: number) {
    if (!view) return;
    try {
        if (!query || !query.trim()) throw new Error('Query de búsqueda vacía');
        const q = query.trim().toLowerCase();
        const candidates = await vscode.workspace.findFiles('**/*', DEFAULT_EXCLUDE_GLOB, 400);
        const results: string[] = [];
        for (const uri of candidates.slice(0, 200)) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText();
                if (text.length > 200000) continue; // skip huge/binary files
                const lines = text.split('\n');
                for (let i = 0; i < lines.length && results.length < 50; i++) {
                    if (lines[i].toLowerCase().includes(q)) {
                        results.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}`);
                    }
                }
            } catch {
                /* skip unreadable/binary */
            }
            if (results.length >= 50) break;
        }
        view.webview.postMessage({ type: 'toolSearchResult', id, query: q, files: results });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolSearchResult', id, error: err.message, query });
    }
}

/** Glob files by pattern (bounded) */
export async function handleToolGlob(view: vscode.WebviewView | undefined, pattern: string, id: number) {
    if (!view) return;
    try {
        const matches = await vscode.workspace.findFiles(pattern || '**/*', DEFAULT_EXCLUDE_GLOB, 100);
        const files = matches.map((u) => vscode.workspace.asRelativePath(u)).slice(0, 100);
        view.webview.postMessage({ type: 'toolGlobResult', id, pattern: pattern || '**/*', files });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolGlobResult', id, error: err.message, pattern });
    }
}



/** Host-side tool call parser — mirrors media/chatUtils.js parseToolCalls for the agent loop */
export interface HostToolCall {
    action: string;
    path?: string;
    query?: string;
    pattern?: string;
    command?: string;
    args?: string[];
    content?: string;
}

export function extractToolCalls(text: string): HostToolCall[] {
    const calls: HostToolCall[] = [];
    if (!text) return calls;

    // 1. Standard [TOOL_CALL] ... [/END_TOOL]
    const regex1 = /\[TOOL_CALL\]\s*([\s\S]*?)\s*\[\/END_TOOL\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex1.exec(text)) !== null) {
        try {
            const obj = JSON.parse(m[1].trim());
            if (obj && typeof obj === 'object' && (obj.tool || obj.action)) {
                const args = obj.args || obj;
                calls.push({
                    action: obj.tool || obj.action,
                    path: args.path || obj.path,
                    query: args.query || obj.query,
                    pattern: args.pattern || obj.pattern,
                    command: args.command || obj.command,
                    args: Array.isArray(args.args) ? args.args : undefined,
                    content: args.content || obj.content
                });
            }
        } catch {
            /* ignore malformed */
        }
    }

    // 2. Balanced-brace JSON tool calls {"tool":"read_file","args":{"path":"..."}}
    if (calls.length === 0) {
        let idx = text.indexOf('{');
        while (idx !== -1) {
            let depth = 0;
            let endIdx = -1;
            for (let i = idx; i < text.length; i++) {
                if (text[i] === '{') depth++;
                else if (text[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        endIdx = i;
                        break;
                    }
                }
            }
            if (endIdx !== -1) {
                try {
                    const obj = JSON.parse(text.substring(idx, endIdx + 1));
                    if (obj && typeof obj === 'object' && (obj.tool || obj.action)) {
                        const args = obj.args || obj;
                        const call: HostToolCall = {
                            action: obj.tool || obj.action,
                            path: args.path || obj.path,
                            query: args.query || obj.query,
                            pattern: args.pattern || obj.pattern,
                            command: args.command || obj.command,
                            args: Array.isArray(args.args) ? args.args : undefined,
                            content: args.content || obj.content
                        };
                        if (call.path || call.query || call.pattern || call.command) {
                            calls.push(call);
                            break;
                        }
                    }
                } catch {
                    /* ignore */
                }
            }
            idx = text.indexOf('{', idx + 1);
        }
    }

    // De-duplicate
    const seen = new Set<string>();
    return calls.filter((c) => {
        const key = `${c.action}|${c.path || c.query || c.pattern || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Fase 2: execute a READ-ONLY tool and return its text result (host-side agent loop) */
export async function executeReadOnlyTool(call: HostToolCall): Promise<{ ok: boolean; output: string }> {
    try {
        const action = (call.action || '').toLowerCase();
        if (action === 'read_file') {
            const doc = await resolveWorkspaceFile(call.path || '');
            if (!doc) return { ok: false, output: `Archivo no encontrado en el workspace: ${call.path}` };
            let content = doc.getText();
            if (content.length > 6000) {
                content = content.substring(0, 6000) + '\n... [truncado a 6000 caracteres]';
            }
            return { ok: true, output: `File \`${call.path}\`:\n\`\`\`\n${content}\n\`\`\`` };
        }
        if (action === 'list_dir') {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) return { ok: false, output: 'No hay workspace abierto' };
            const cleanRel = (call.path || '').replace(/^\.\//, '').replace(/^\//, '');
            const dirUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            const listing = entries
                .map(([name, type]) => (type === vscode.FileType.Directory ? '📁 ' : '📄 ') + name)
                .sort()
                .slice(0, 200)
                .join('\n');
            return { ok: true, output: `Directory \`${call.path || '.'}\`:\n${listing}` };
        }
        if (action === 'search') {
            const q = (call.query || '').toLowerCase();
            const candidates = await vscode.workspace.findFiles('**/*', DEFAULT_EXCLUDE_GLOB, 400);
            const results: string[] = [];
            for (const uri of candidates.slice(0, 200)) {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const text = doc.getText();
                    if (text.length > 200000) continue;
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length && results.length < 50; i++) {
                        if (lines[i].toLowerCase().includes(q))
                            results.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}`);
                    }
                } catch {
                    /* skip */
                }
                if (results.length >= 50) break;
            }
            return {
                ok: true,
                output: `Search "${call.query}":\n${results.join('\n') || '(sin resultados)'}`
            };
        }
        if (action === 'glob') {
            const matches = await vscode.workspace.findFiles(
                call.pattern || '**/*',
                DEFAULT_EXCLUDE_GLOB,
                100
            );
            const files = matches.map((u) => vscode.workspace.asRelativePath(u)).slice(0, 100);
            return { ok: true, output: `Glob "${call.pattern}":\n${files.join('\n') || '(sin resultados)'}` };
        }
        return { ok: false, output: `Herramienta no soportada en el bucle agente: ${action}` };
    } catch (err: any) {
        return { ok: false, output: `Error ejecutando ${call.action}: ${err?.message || err}` };
    }
}
