/**
 * Giskard Assistant VSCode Extension — Prompt Builder (secciones extraídas de handlePrompt)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Funciones puras de contexto explícito — cero `this`. Extraídas de
 * promptHandlers.ts (wave B) para mantener cada célula ≤500 líneas.
 */

import * as vscode from 'vscode';
import { ConnectionModelsGroup } from '../core/api';
import { ConnectionStore } from '../core/connectionStore';
import { fetchProjectMemory } from './agentLoop';
import { extractCodeBlocks } from './toolApply';
import { openDiff } from './diffHandlers';
import type { PromptHost } from './promptHandlers';

/** Regex de apertura de archivo dentro del prompt (ej: "abre src/api.ts"). */
export function extractOpenFileTarget(prompt: string): string | undefined {
    const fileMatch = prompt.match(
        /(?:abre|open|edita|modifica)\s+(?:el\s+archivo\s+|file\s+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i
    );
    return fileMatch && fileMatch[1] ? fileMatch[1] : undefined;
}

/** Flujo conversacional de apply ("aplícala", "hazlo", "sí"...) sobre la última respuesta. */
export async function maybeApplyLastResponse(
    host: PromptHost,
    prompt: string,
    model: string,
    tabId: string | undefined,
    targetPathMatch?: string
): Promise<boolean> {
    const view = host.getView();
    if (!view) return false;
    const APPLY_LAST_REGEX =
        /^\s*(?:hazla|hazlo|ap[lí]ca(?:la|lo|r)?|s[ií]|yes|do it|ejecuta(?:lo|la)?|a[pú]ntalo|aplica|perfecto!?|ok!?|dale!?|listo!?|excelente!?|procede|proceed|apply(?:\s+it)?|use(?:\s+it)?|use\s+that|implement(?:\s+it)?)\s*$/i;
    if (!APPLY_LAST_REGEX.test(prompt.trim()) || !host.agentState.lastBotResponse.trim()) return false;

    const blocks = extractCodeBlocks(host.agentState.lastBotResponse);
    if (blocks.length === 0) return false;

    view.webview.postMessage({
        type: 'streamToken',
        token: '📦 Aplicando código propuesto en el editor...',
        model,
        tabId
    });
    view.webview.postMessage({ type: 'streamComplete', model, tabId });

    let best = blocks[0];
    for (const b of blocks) {
        if (b.filePath) {
            best = b;
            break;
        }
        if (b.code.length > best.code.length) best = b;
    }
    await openDiff(host.diffCtx(), best.code, best.filePath || targetPathMatch);
    return true;
}

/** Header de capacidades del agente (contrato de salida esperado del modelo). */
export const SYSTEM_CAPABILITIES_HEADER = `[VS CODE AGENT CAPABILITIES]: You are an integrated coding agent in VS Code.
• REASONING & THINKING: Put step-by-step internal reasoning inside <thinking>...</thinking> tags before providing your answer.
• TOOL EXECUTION: Emit tool calls as <tool_call>{"action": "read_file", "path": "src/extension.ts"} or [TOOL_CALL] {"tool": "read_file", "args": {"path": "src/extension.ts"}} [/END_TOOL].
• TO WRITE OR EDIT A FILE: Place a comment with the relative file path on line 1 of your code block (e.g. // src/extension.ts).
• TO LIST A DIRECTORY: Emit [TOOL_CALL] {"tool": "list_dir", "args": {"path": "src"}} [/END_TOOL].
• TO SEARCH FILE CONTENTS: Emit [TOOL_CALL] {"tool": "search", "args": {"query": "functionName"}} [/END_TOOL].
• TO GLOB FILES: Emit [TOOL_CALL] {"tool": "glob", "args": {"pattern": "src/**/*.ts"}} [/END_TOOL].
• TO PROPOSE A PLAN BEFORE EDITING: Wrap your plan in [PLAN] ... [/END_PLAN] and WAIT for the user to approve it before emitting tool calls or code blocks.
• RICH OUTPUT FORMATTING: Use structured GitHub Markdown, fenced code blocks with language tags, diff code blocks for changes, tables, and callouts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING]).
• IGNORED DIRECTORIES: Do NOT attempt to read non-source files or build output directories like node_modules, out/, dist/, target/, build/, or .git/. Focus exclusively on source code files (src/, package.json, README.md, etc.).\n\n`;

/** Nombres de display por tag de proveedor (antes inline en handlePrompt). */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    NVIDIA: 'NVIDIA NIM API',
    OPENAI: 'OpenAI API',
    DEEPSEEK: 'DeepSeek API',
    KIMI: 'Kimi API',
    OPENROUTER: 'OpenRouter API',
    ANTHROPIC: 'Anthropic API',
    GROQ: 'Groq API',
    MISTRAL: 'Mistral API',
    COHERE: 'Cohere API',
    HF: 'Hugging Face API'
};

export interface SystemHeaderInputs {
    projectRules: string | null;
    isGiskardActive: boolean;
    giskardUrl: string;
    mcpContext: string | null;
}

/** Construye el system header completo: reglas + capacidades + memoria + MCP/seguridad. */
export async function buildSystemHeader(inputs: SystemHeaderInputs): Promise<string> {
    const { projectRules, isGiskardActive, giskardUrl, mcpContext } = inputs;
    let header = projectRules
        ? `[PROJECT RULES — sigue estas reglas del proyecto]\n${projectRules}\n\n`
        : '';
    header += SYSTEM_CAPABILITIES_HEADER;

    // Req 5 (wave 012): handoff comun — inyecta la memoria del proyecto
    // (memorias y decisiones recientes) desde giskard-sys cuando esta activo.
    if (isGiskardActive) {
        const projectMemory = await fetchProjectMemory();
        if (projectMemory) {
            header += `[PROJECT MEMORY (giskard-sys) — decisiones y recuerdos recientes del proyecto, respetalos]\n${projectMemory}\n`;
        }
        header += `[Capa de Seguridad Giskard-Sys (${giskardUrl}): ACTIVA | Sandbox Jail + Grafo LTM + Auditoría RTK]\n`;
    }

    if (mcpContext) {
        header += `${mcpContext}\n`;
    } else if (!isGiskardActive) {
        header += `[Modo Chat Estándar: Sin herramientas MCP ni servidor Giskard-Sys activos]\n`;
    }

    return header;
}

/** Inyección pasiva del contexto de workspace (carpeta activa). */
export function injectWorkspacePrefix(fullPrompt: string): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const activeFolder = folders[0];
        return `[Proyecto Activo VSCode: ${activeFolder.name} (${activeFolder.uri.fsPath})]\n${fullPrompt}`;
    }
    return fullPrompt;
}

/** Adjunta el archivo activo al prompt (si includeActiveFile y hay editor válido). */
export function includeActiveFileContext(
    fullPrompt: string,
    maxContext: number,
    targetModel: string
): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return fullPrompt;

    let docText = editor.document.getText();
    const fileName = editor.document.fileName;
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);

    const maxFileChars = Math.max(4000, (maxContext - 3000) * 3.5);
    if (docText.length > maxFileChars) {
        docText =
            docText.substring(0, maxFileChars) +
            `\n\n... [Contenido truncado para no exceder la ventana de contexto de ${maxContext.toLocaleString()} tokens del modelo ${targetModel}]`;
    }

    let out = `[Archivo Activo: ${fileName}]\n\`\`\`\n${docText}\n\`\`\`\n\n${fullPrompt}`;
    out += `\n\n[INSTRUCCION PARA LA IA]: Cuando propongas cambios de codigo, incluye SIEMPRE en la primera linea del bloque de codigo un comentario con la ruta relativa del archivo, por ejemplo: // ${relPath}`;
    return out;
}

// ─── Resolución de proveedor destino ────────────────────────────────────────

export interface PromptTarget {
    isRemoteConnection: boolean;
    resolvedRemoteUrl: string;
    apiKey: string;
    targetTag: string;
    targetConnId: number | undefined;
}

/** Intelligent Connection-Aware Provider Resolution (antes inline en handlePrompt). */
export async function resolvePromptTarget(
    store: ConnectionStore,
    targetModel: string,
    connGroup: ConnectionModelsGroup | undefined
): Promise<PromptTarget> {
    let isRemoteConnection: boolean;
    let resolvedRemoteUrl = '';
    let apiKey = '';
    let targetTag: string;
    let targetConnId: number | undefined = undefined;

    const isExplicitLocal =
        targetModel.startsWith('local:') ||
        targetModel.startsWith('hf.co/') ||
        targetModel.endsWith('.gguf');

    if (targetModel.startsWith('local:')) {
        isRemoteConnection = false;
        targetTag = 'ollama';
    } else if (targetModel.startsWith('remote:')) {
        isRemoteConnection = true;
        targetTag = 'remote';
    } else if (connGroup) {
        const targetConn = store.getAll().find((c) => c.id === connGroup.connectionId);
        const isLocalGroup =
            connGroup.connectionTag === 'giskard-sys' ||
            connGroup.connectionTag === 'ollama' ||
            targetConn?.type === 'local';
        isRemoteConnection = !isLocalGroup;
        targetTag = connGroup.connectionTag;
        targetConnId = connGroup.connectionId;
        resolvedRemoteUrl = connGroup.connectionUrl;
    } else if (!isExplicitLocal) {
        const vendorTag = targetModel.includes('/') ? targetModel.split('/')[0].toLowerCase() : 'remote';
        const tagMatchConn = store.getConnectionByTag(vendorTag);
        const anyRemoteConn =
            tagMatchConn || store.getActiveRemote() || store.getAll().find((c) => c.type === 'remote');

        if (anyRemoteConn) {
            isRemoteConnection = true;
            targetTag = anyRemoteConn.tag;
            targetConnId = anyRemoteConn.id;
            resolvedRemoteUrl = anyRemoteConn.url;
        } else {
            isRemoteConnection = false;
            targetTag = 'giskard-sys';
        }
    } else {
        isRemoteConnection = false;
        targetTag = targetModel.startsWith('local:') ? 'ollama' : 'giskard-sys';
    }

    if (isRemoteConnection) {
        if (targetConnId) {
            apiKey = (await store.getApiKey(targetConnId)) || '';
        }
        if (!apiKey) {
            const resolved = await store.getAnyRemoteApiKey(targetTag);
            if (resolved) {
                apiKey = resolved.apiKey;
                if (resolved.url) resolvedRemoteUrl = resolved.url;
            }
        }
    } else if (targetConnId) {
        apiKey = (await store.getApiKey(targetConnId)) || '';
    }

    return { isRemoteConnection, resolvedRemoteUrl, apiKey, targetTag, targetConnId };
}

// ─── Parseo de tokens SSE (formatos multi-proveedor) ────────────────────────

/** Extrae el token de contenido de un chunk SSE JSON — cubre los formatos
 * OpenAI (delta/message), reasoning_content/thinking, Ollama (response) y strings. */
export function extractSseContentToken(json: unknown): string {
    const j = json as any;
    if (typeof j === 'string') return j;
    const choice = j?.choices && j.choices[0];
    const delta = choice?.delta;
    const msg = choice?.message;
    return (
        delta?.content ||
        delta?.reasoning_content ||
        delta?.thinking ||
        msg?.content ||
        msg?.reasoning_content ||
        j?.content ||
        j?.response ||
        j?.thinking ||
        ''
    );
}
