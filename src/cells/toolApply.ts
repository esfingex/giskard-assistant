/**
 * Giskard Assistant VSCode Extension — Célula: Aplicación de Código & Parseo de Bloques
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de toolHandlers.ts (wave B): smart-apply de código a documentos,
 * comparación difusa de líneas, limpieza de fences y extracción de bloques.
 * Solo depende de vscode + isLikelyFilePath (toolHandlers) — sin ciclos.
 */

import * as vscode from 'vscode';
import { isLikelyFilePath } from './toolHandlers';

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
        edit.insert(
            doc.uri,
            new vscode.Position(0, 0),
            cleanCode.endsWith('\n') ? cleanCode : cleanCode + '\n'
        );
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
    const sizeSimilar =
        Math.abs(codeLines.length - currentLines.length) <=
        Math.max(2, Math.floor(currentLines.length * 0.15));
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
        if (currentLines.some((fl) => linesMatch(fl, t))) overlap++;
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

    let firstBlockIdx = -1,
        firstFileIdx = -1;
    let lastBlockIdx = -1,
        lastFileIdx = -1;
    for (let i = 0; i < codeLines.length; i++) {
        const fi = matchPos(codeLines[i]);
        if (fi !== -1) {
            if (firstBlockIdx === -1) {
                firstBlockIdx = i;
                firstFileIdx = fi;
            }
            lastBlockIdx = i;
            lastFileIdx = fi;
        }
    }

    if (firstBlockIdx === -1 || lastBlockIdx === -1) {
        return { applied: false, mode: 'failed' };
    }

    const startPos = new vscode.Position(firstFileIdx, 0);
    const endPos =
        lastFileIdx + 1 < currentLines.length
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
    const match = clean.match(/^```[a-zA-Z0-9_\-+#]*\n([\s\S]*?)\n?```$/);
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
    const regex = /```([a-zA-Z0-9_\-+#]*)\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const lang = m[1] || '';
        const raw = m[2] || '';
        if (!raw.trim()) continue;
        const firstLines = raw.trim().split('\n').slice(0, 3);
        let filePath: string | undefined;
        for (const line of firstLines) {
            const pm = line.match(
                /(?:\/\/|#|\/\*|<!--)\s*(?:file\s*:\s*|filepath\s*:\s*)?([a-zA-Z0-9_\-./]+)/i
            );
            if (pm && pm[1] && isLikelyFilePath(pm[1])) {
                filePath = pm[1];
                break;
            }
        }
        blocks.push({ lang, code: cleanCodeFence(raw), filePath });
    }
    return blocks;
}
