/**
 * Giskard Assistant VSCode Extension — Diff Handlers
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 4).
 * Applies AI-proposed code to workspace documents: auto-trigger after a reply,
 * smart-apply with native diff review, one-click revert snapshots.
 *
 * Functions are pure of `this` — they receive the context explicitly.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { extractCodeBlocks, resolveWorkspaceFile, applyCodeToDocument } from './toolHandlers';

/** Snapshot of a pre-edit document state, for one-click revert. */
export interface EditSnapshot {
    uri: string;
    original: string;
    timestamp: number;
}

const _editSnapshots: EditSnapshot[] = [];

/** Revert the most recent AI edit (snapshots cap at 20, oldest discarded). */
export function revertLastAiEdit(): boolean {
    const snap = _editSnapshots.pop();
    if (!snap) return false;
    const uri = vscode.Uri.parse(snap.uri);
    vscode.workspace.openTextDocument(uri).then(async (doc) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            uri,
            new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
            snap.original
        );
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(
            `↩️ Cambio de IA revertido en ${vscode.workspace.asRelativePath(uri)}`
        );
    });
    return true;
}

/** Callback fired after an edit lands, so the chat cell can run auto-verify. */
export interface DiffContext {
    onEditApplied(): void;
}

export async function maybeAutoTriggerDiff(
    ctx: DiffContext,
    userPrompt: string,
    botResponse: string,
    extractedPath?: string,
    includeActiveFile?: boolean
): Promise<void> {
    const blocks = extractCodeBlocks(botResponse);
    if (blocks.length === 0) return;

    // Only consider auto-apply when the user explicitly asked to edit a file
    // (the prompt mentions an edit verb AND we know a target file).
    const editIntent =
        /(?:aplica|aplicar|modifica|edita|reescribe|cambia|hazla|hazlo|implementa|actualiza|crea|agrega|añade|corrige|corregir|fix|write|edit|update|apply|implement|create)\b/i.test(
            userPrompt
        );
    const hasTarget = Boolean(extractedPath || includeActiveFile);
    if (!editIntent || !hasTarget) return;

    let best = blocks[0];
    for (const b of blocks) {
        if (b.filePath) {
            best = b;
            break;
        }
        if (b.code.length > best.code.length) best = b;
    }

    let targetPath = best.filePath || extractedPath;
    if (!targetPath) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document && editor.document.uri.scheme === 'file') {
            targetPath = vscode.workspace.asRelativePath(editor.document.uri);
        }
    }
    if (!targetPath || !best || !best.code || best.code.trim().length <= 10) return;

    // Never apply silently: ask the user first
    const choice = await vscode.window.showInformationMessage(
        `Giskard: el modelo propuso cambios para «${targetPath}». ¿Los aplico?`,
        { modal: false },
        '✅ Aplicar',
        '❌ Descartar'
    );
    if (choice === '✅ Aplicar') {
        await openDiff(ctx, best.code, targetPath);
    }
}

export async function openDiff(ctx: DiffContext, code: string, filePath?: string): Promise<void> {
    let doc: vscode.TextDocument | null = null;
    if (filePath) doc = await resolveWorkspaceFile(filePath);
    if (!doc) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme === 'file') doc = editor.document;
    }

    if (!doc && filePath) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const cleanRel = filePath.replace(/^\.\//, '').replace(/^\//, '');
            const newUri = vscode.Uri.joinPath(folders[0].uri, cleanRel);
            try {
                await vscode.workspace.fs.writeFile(newUri, new Uint8Array());
                doc = await vscode.workspace.openTextDocument(newUri);
            } catch {
                /* creación falla → fallback a documento sin título */
            }
        }
    }

    if (!doc) {
        const newDoc = await vscode.workspace.openTextDocument({ content: code, language: 'typescript' });
        await vscode.window.showTextDocument(newDoc, { preview: false });
        return;
    }

    // Open target file in the editor and apply changes safely (smart-apply, no destructive full-file overwrite)
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
    const originalContent = doc.getText();
    const result = await applyCodeToDocument(doc, code);
    const relPath = vscode.workspace.asRelativePath(doc.uri);
    switch (result.mode) {
        case 'noop':
            vscode.window.showInformationMessage(`✓ Los cambios ya estaban aplicados en ${relPath}`);
            break;
        case 'new':
            vscode.window.showInformationMessage(`✓ Archivo creado: ${relPath} — revisa y guarda`);
            break;
        case 'full':
        case 'partial':
            // Fase 3c: snapshot for one-click revert + native diff review
            _editSnapshots.push({
                uri: doc.uri.toString(),
                original: originalContent,
                timestamp: Date.now()
            });
            if (_editSnapshots.length > 20) _editSnapshots.shift();
            try {
                const proposedContent = doc.getText();
                const stamp = Date.now();
                const origTmp = vscode.Uri.file(path.join(os.tmpdir(), `giskard-orig-${stamp}.tmp`));
                const propTmp = vscode.Uri.file(path.join(os.tmpdir(), `giskard-prop-${stamp}.tmp`));
                await vscode.workspace.fs.writeFile(origTmp, Buffer.from(originalContent, 'utf8'));
                await vscode.workspace.fs.writeFile(propTmp, Buffer.from(proposedContent, 'utf8'));
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    origTmp,
                    propTmp,
                    `Giskard: ${relPath} — original → propuesto (guarda en el archivo para aceptar)`
                );
            } catch {
                /* diff view is best-effort */
            }
            vscode.window.showInformationMessage(
                `✓ Cambios aplicados (${result.mode === 'partial' ? 'edición parcial' : 'archivo completo'}) en ${relPath} — revisa el diff, guarda para aceptar o usa "Revert AI Change" para descartar`
            );
            break;
        case 'failed':
        default:
            vscode.window.showWarningMessage(
                `⚠️ ${result.message || `No se pudieron aplicar los cambios en ${relPath}`}`
            );
            break;
    }

    // Wave A: verificación automática con tests (cargo/npm) tras aplicar cambios
    ctx.onEditApplied();
}
