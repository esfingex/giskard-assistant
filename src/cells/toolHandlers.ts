/**
 * Giskard Assistant VSCode Extension — Module: Tool Call Handlers & Workspace Resolution
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { getConnectorUrl, getClientId, fetchWithTimeout } from '../core/api';

export const DEFAULT_EXCLUDE_GLOB = '**/{node_modules,out,dist,target,build,coverage,.git,.gemini,.cache,venv,.venv}/**';

/** Real source/editor file extensions — used to avoid treating version strings or package names as file paths */
const SOURCE_FILE_EXT_RE = /\.(?:ts|tsx|js|jsx|json|py|rs|md|mdx|html|css|scss|sass|less|c|cpp|cc|h|hpp|go|yaml|yml|toml|sh|bash|zsh|fish|sql|vue|svelte|astro|java|kt|kts|rb|php|env|ini|cfg|conf|xml|svg|txt|lock|gradle|properties|nix|tf|proto|mjs|cjs|mts|cts)$/i;

/** Heuristic: is this string a plausible relative/absolute file path (and not a version or package name)? */
export function isLikelyFilePath(candidate: string): boolean {
    if (!candidate || candidate.length < 4 || candidate.includes(' ')) return false;
    if (/^v?\d+(\.\d+)+$/.test(candidate)) return false; // v1.0.0 / 1.2.3
    return SOURCE_FILE_EXT_RE.test(candidate);
}

export async function resolveWorkspaceFile(targetPath: string): Promise<vscode.TextDocument | null> {
    if (!targetPath || !targetPath.trim()) return null;
    let cleanPath = targetPath.trim();

    // Ignore requests to read build output / node_modules / git directories
    const lower = cleanPath.toLowerCase();
    if (lower.includes('node_modules/') || lower.includes('dist/') || lower.includes('out/') || lower.includes('target/') || lower.includes('.git/')) {
        return null;
    }

    // 1. Absolute path check
    if (cleanPath.startsWith('/')) {
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
            vscode.window.showErrorMessage(`Giskard: No se encontró el archivo '${relativePath}' en el workspace.`);
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Giskard: Error al abrir '${relativePath}': ${err.message}`);
    }
}

export async function handleToolReadFile(view: vscode.WebviewView | undefined, targetPath: string, id: number) {
    if (!view) return;
    try {
        const doc = await resolveWorkspaceFile(targetPath);
        if (!doc) throw new Error(`Archivo no encontrado en el workspace: ${targetPath}`);
        let content = doc.getText();
        const MAX_READ_CHARS = 14000;
        if (content.length > MAX_READ_CHARS) {
            content = content.substring(0, MAX_READ_CHARS) + `\n\n... [Contenido optimizado a los primeros 14,000 caracteres de ${content.length.toLocaleString()} caracteres totales para máxima velocidad de inferencia]`;
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
                view.webview.postMessage({ type: 'toolWriteFileResult', id, success: true, path: targetPath, mode: result.mode });
            } else if (result.mode === 'noop') {
                view.webview.postMessage({ type: 'toolWriteFileResult', id, success: true, path: targetPath, mode: 'noop' });
            } else {
                view.webview.postMessage({ type: 'toolWriteFileResult', id, error: result.message || 'No se pudieron aplicar los cambios', path: targetPath });
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
            view.webview.postMessage({ type: 'toolWriteFileResult', id, success: true, path: targetPath, mode: 'new' });
        }
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolWriteFileResult', id, error: err.message, path: targetPath });
    }
}

export async function handleToolExec(view: vscode.WebviewView | undefined, command: string, args: string[], id: number) {
    if (!view) return;
    try {
        const res = await fetchWithTimeout(`${getConnectorUrl()}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
            body: JSON.stringify({ command, args })
        });
        const data: any = await res.json();
        if (!data.success) throw new Error(data.error || 'Error ejecutando comando');
        view.webview.postMessage({ type: 'toolExecResult', id, output: data.data });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolExecResult', id, error: err.message });
    }
}

/** List directory entries (names only, bounded) so the model can explore the project structure */
export async function handleToolListDir(view: vscode.WebviewView | undefined, targetPath: string, id: number) {
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
            } catch { /* skip unreadable/binary */ }
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
        const files = matches.map(u => vscode.workspace.asRelativePath(u)).slice(0, 100);
        view.webview.postMessage({ type: 'toolGlobResult', id, pattern: pattern || '**/*', files });
    } catch (err: any) {
        view.webview.postMessage({ type: 'toolGlobResult', id, error: err.message, pattern });
    }
}

/** Fuzzy line comparison: exact trimmed match, or containment for signature-like lines */
function linesMatch(a: string, b: string): boolean {
    const ta = a.trim();
    const tb = b.trim();
    if (!ta || !tb) return false;
    if (ta === tb) return true;
    if (ta.length >= 8 && (ta.includes(tb) || tb.includes(ta))) return true;
    return false;
}

async function replaceWholeFile(doc: vscode.TextDocument, code: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(doc.uri, fullRange, code.endsWith('\n') ? code : code + '\n');
    await vscode.workspace.applyEdit(edit);
}

/**
 * Smart-apply: writes `code` into `doc` WITHOUT destroying the rest of the file.
 *
 * Strategy:
 *  1. Block already contained in the file → no-op (nothing to change).
 *  2. Empty file → write block as the new content.
 *  3. Block looks like a complete rewrite (similar line count, low overlap) → full replace.
 *  4. Block overlaps the file (modified function/section) → anchor-based partial edit:
 *     locate the first and last block lines that already exist in the file and replace
 *     only that region with the whole block.
 *  5. No anchors → fail gracefully. NEVER overwrite the file silently with a fragment.
 */
export async function applyCodeToDocument(
    doc: vscode.TextDocument,
    code: string,
    opts?: { forceFullReplace?: boolean }
): Promise<{ applied: boolean; mode: 'noop' | 'full' | 'partial' | 'new' | 'failed'; message?: string }> {
    const current = doc.getText();
    const cleanCode = (code || '').trim();
    if (!cleanCode) return { applied: false, mode: 'failed', message: 'Bloque de código vacío.' };

    // 1. Already applied → no-op
    if (current.includes(cleanCode) || current.includes(cleanCode + '\n')) {
        return { applied: false, mode: 'noop' };
    }

    // 2. Empty file → write content
    if (!current.trim()) {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), cleanCode.endsWith('\n') ? cleanCode : cleanCode + '\n');
        await vscode.workspace.applyEdit(edit);
        return { applied: true, mode: 'new' };
    }

    // 3. Complete rewrite: similar size and low overlap → the model returned the whole file
    if (opts?.forceFullReplace) {
        await replaceWholeFile(doc, cleanCode);
        return { applied: true, mode: 'full' };
    }
    const currentLines = current.split('\n');
    const codeLines = cleanCode.split('\n');
    const sizeSimilar = Math.abs(codeLines.length - currentLines.length) <= Math.max(2, Math.floor(currentLines.length * 0.15));
    const overlap = countOverlappingLines(codeLines, currentLines);
    const overlapRatio = codeLines.length > 0 ? overlap / codeLines.length : 0;
    if (sizeSimilar && overlapRatio < 0.5) {
        await replaceWholeFile(doc, cleanCode);
        return { applied: true, mode: 'full' };
    }

    // 4. Anchor-based partial edit
    if (overlapRatio >= 0.15) {
        const partial = await applyPartialEdit(doc, cleanCode, currentLines, codeLines);
        if (partial.applied) return partial;
    }

    // 5. Failed — never destroy the file with a misplaced fragment
    return {
        applied: false,
        mode: 'failed',
        message: `No pude ubicar el bloque de código dentro de ${vscode.workspace.asRelativePath(doc.uri)}. No se aplicó nada para evitar sobreescribir el archivo. Puedes pegar el bloque manualmente o pedir el archivo completo.`
    };
}

function countOverlappingLines(codeLines: string[], currentLines: string[]): number {
    let overlap = 0;
    const maxCheck = Math.min(codeLines.length, 300);
    for (let i = 0; i < maxCheck; i++) {
        const t = codeLines[i].trim();
        if (t.length < 2) continue;
        if (currentLines.some(fl => linesMatch(fl, t))) overlap++;
    }
    return overlap;
}

async function applyPartialEdit(
    doc: vscode.TextDocument,
    cleanCode: string,
    currentLines: string[],
    codeLines: string[]
): Promise<{ applied: boolean; mode: 'partial' | 'failed'; message?: string }> {
    const matchPos = (bl: string): number => {
        const t = bl.trim();
        if (t.length < 2) return -1;
        for (let i = 0; i < currentLines.length; i++) {
            if (linesMatch(bl, currentLines[i])) return i;
        }
        return -1;
    };

    let firstBlockIdx = -1, firstFileIdx = -1;
    let lastBlockIdx = -1, lastFileIdx = -1;
    for (let i = 0; i < codeLines.length; i++) {
        const fi = matchPos(codeLines[i]);
        if (fi !== -1) {
            if (firstBlockIdx === -1) { firstBlockIdx = i; firstFileIdx = fi; }
            lastBlockIdx = i; lastFileIdx = fi;
        }
    }

    if (firstBlockIdx === -1 || lastBlockIdx === -1) {
        return { applied: false, mode: 'failed' };
    }

    const startPos = new vscode.Position(firstFileIdx, 0);
    const endPos = lastFileIdx + 1 < currentLines.length
        ? new vscode.Position(lastFileIdx + 1, 0)
        : doc.positionAt(doc.getText().length);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(startPos, endPos), cleanCode + '\n');
    await vscode.workspace.applyEdit(edit);
    return { applied: true, mode: 'partial' };
}

/** Utility to clean code fences ```lang\n...``` */
export function cleanCodeFence(code: string): string {
    if (!code) return '';
    let clean = code.trim();
    const match = clean.match(/^```[a-zA-Z0-9_\-\+\.#]*\n([\s\S]*?)\n?```$/);
    if (match && match[1]) {
        return match[1].trim();
    }
    if (clean.startsWith('```')) {
        const firstNL = clean.indexOf('\n');
        if (firstNL !== -1) clean = clean.substring(firstNL + 1);
    }
    if (clean.endsWith('```')) {
        clean = clean.substring(0, clean.length - 3);
    }
    return clean.trim();
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
        } catch { /* ignore malformed */ }
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
                    if (depth === 0) { endIdx = i; break; }
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
                } catch { /* ignore */ }
            }
            idx = text.indexOf('{', idx + 1);
        }
    }

    // De-duplicate
    const seen = new Set<string>();
    return calls.filter(c => {
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
                .sort().slice(0, 200).join('\n');
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
                        if (lines[i].toLowerCase().includes(q)) results.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}`);
                    }
                } catch { /* skip */ }
                if (results.length >= 50) break;
            }
            return { ok: true, output: `Search "${call.query}":\n${results.join('\n') || '(sin resultados)'}` };
        }
        if (action === 'glob') {
            const matches = await vscode.workspace.findFiles(call.pattern || '**/*', DEFAULT_EXCLUDE_GLOB, 100);
            const files = matches.map(u => vscode.workspace.asRelativePath(u)).slice(0, 100);
            return { ok: true, output: `Glob "${call.pattern}":\n${files.join('\n') || '(sin resultados)'}` };
        }
        return { ok: false, output: `Herramienta no soportada en el bucle agente: ${action}` };
    } catch (err: any) {
        return { ok: false, output: `Error ejecutando ${call.action}: ${err?.message || err}` };
    }
}

/** Extract code blocks from markdown */
export function extractCodeBlocks(text: string): { lang: string; code: string; filePath?: string }[] {
    const blocks: { lang: string; code: string; filePath?: string }[] = [];
    const regex = /```([a-zA-Z0-9_\-\+\.#]*)\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const lang = m[1] || '';
        const raw = m[2] || '';
        if (!raw.trim()) continue;
        const firstLines = raw.trim().split('\n').slice(0, 3);
        let filePath: string | undefined;
        for (const line of firstLines) {
            const pm = line.match(/(?:\/\/|#|\/\*|<!--)\s*(?:file\s*:\s*|filepath\s*:\s*)?([a-zA-Z0-9_\-\.\/]+)/i);
            if (pm && pm[1] && isLikelyFilePath(pm[1])) { filePath = pm[1]; break; }
        }
        blocks.push({ lang, code: cleanCodeFence(raw), filePath });
    }
    return blocks;
}
