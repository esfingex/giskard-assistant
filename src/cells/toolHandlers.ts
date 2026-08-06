/**
 * Giskard Assistant VSCode Extension — Module: Tool Call Handlers & Workspace Resolution
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { getConnectorUrl, getClientId, fetchWithTimeout } from '../core/api';

export async function resolveWorkspaceFile(targetPath: string): Promise<vscode.TextDocument | null> {
    if (!targetPath || !targetPath.trim()) return null;
    let cleanPath = targetPath.trim();

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

    // 3. Fallback search via findFiles
    try {
        const fileName = cleanPath.split('/').pop() || cleanPath;
        const matches = await vscode.workspace.findFiles(`**/${fileName}`, '**/node_modules/**', 5);
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
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
            edit.replace(doc.uri, fullRange, content);
            await vscode.workspace.applyEdit(edit);
            await doc.save();
            await vscode.window.showTextDocument(doc, { preview: false });
            view.webview.postMessage({ type: 'toolWriteFileResult', id, success: true, path: targetPath });
        } else {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) throw new Error('No hay workspace abierto');
            const cleanRel = targetPath.replace(/^\.\//, '').replace(/^\//, '');
            const newUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
            const enc = new TextEncoder();
            await vscode.workspace.fs.writeFile(newUri, enc.encode(content));
            const newDoc = await vscode.workspace.openTextDocument(newUri);
            await vscode.window.showTextDocument(newDoc, { preview: false });
            view.webview.postMessage({ type: 'toolWriteFileResult', id, success: true, path: targetPath });
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
            const pm = line.match(/(?:\/\/|#|\/\*|<!--|\/\/ file:|\/\/ filepath:)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i);
            if (pm && pm[1]) { filePath = pm[1]; break; }
        }
        blocks.push({ lang, code: cleanCodeFence(raw), filePath });
    }
    return blocks;
}
