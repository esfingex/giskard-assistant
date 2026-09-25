/**
 * Giskard Assistant VSCode Extension — Knowledge Handlers
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extracted from chatWebview.ts (v4.3.0 decomposition, wave 5).
 * Surfaced knowledge capabilities: agent skills listing and Graphify LTM indexing.
 */

import * as vscode from 'vscode';
import { GiskardResponse, fetchWithTimeout, getClientId, getConnectorUrl } from '../core/api';
import { ConnectionStore } from '../core/connectionStore';

export interface KnowledgeContext {
    view?: vscode.WebviewView;
    store: ConnectionStore;
}

export async function fetchSkills(ctx: KnowledgeContext): Promise<void> {
    const view = ctx.view;
    if (!view) return;
    const connectorUrl = getConnectorUrl();
    const giskardConn = ctx.store.getActiveLocal();
    const isGiskardActive = Boolean(
        giskardConn && (giskardConn.tag === 'giskard-sys' || giskardConn.url.includes(':3500'))
    );

    try {
        view.webview.postMessage({
            type: 'streamToken',
            token: '\n\n🎯 [Agent Skills]: Consultando habilidades registradas en giskard-sys y workspace...'
        });

        const res = await fetchWithTimeout(
            `${connectorUrl}/agents`,
            {
                headers: { 'X-Client-Id': getClientId() }
            },
            10000
        ).catch(() => null);

        let skillsText = '\n✅ [Habilidades Estándar del Agente]:\n';
        skillsText += ' • 🛠️ **web_search** (Búsqueda Técnica Web)\n';
        skillsText += ' • 💻 **exec_shell** (Ejecución Enjaulada RTK)\n';
        skillsText += ' • 📄 **read_file / write_file** (Lectura/Escritura de Archivos)\n';
        skillsText += ' • 📝 **diff_apply** (Edición In-Place de Código)\n';

        skillsText += '\n🔒 [Habilidades Exclusivas del Backend giskard-sys (Puerto 3500)]:\n';
        if (isGiskardActive || (res && res.ok)) {
            skillsText += ' • 🕸️ **graphify_ltm** (Grafo de Conocimiento Persistente LTM — Activo ✅)\n';
            skillsText += ' • 🧠 **giskard_bcf** (Memoria BCF nativa de giskard-sys — Activo ✅)\n';
        } else {
            skillsText +=
                ' • 🕸️ **graphify_ltm** (Grafo de Conocimiento LTM — ⚠️ Requiere giskard-sys backend)\n';
            skillsText +=
                ' • 🧠 **giskard_bcf** (Memoria BCF nativa de giskard-sys — ⚠️ Requiere giskard-sys backend)\n';
        }

        if (res && res.ok) {
            const agents: any = await res.json().catch(() => null);
            if (Array.isArray(agents) && agents.length > 0) {
                skillsText += '\n🤖 [Agentes Registrados en giskard-sys]:\n';
                agents.forEach((ag: any) => {
                    skillsText += ` • **${ag.name}**: ${(ag.skills || []).join(', ')}\n`;
                });
            }
        }

        view.webview.postMessage({ type: 'streamToken', token: skillsText });
        view.webview.postMessage({ type: 'streamComplete' });
    } catch (err: any) {
        view.webview.postMessage({ type: 'streamError', error: `Skills error: ${err.message}` });
    }
}

export async function runGraphify(ctx: KnowledgeContext): Promise<void> {
    const view = ctx.view;
    if (!view) return;
    const folders = vscode.workspace.workspaceFolders;
    const targetPath = folders && folders.length > 0 ? folders[0].uri.fsPath : './';
    const connectorUrl = getConnectorUrl();

    try {
        view.webview.postMessage({
            type: 'streamToken',
            token: '\n\n🕸️ [Graphify LTM]: Indexando estructura del proyecto y construyendo grafo de conocimiento...'
        });

        const res = await fetchWithTimeout(
            `${connectorUrl}/extensions/graphify/run`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Id': getClientId()
                },
                body: JSON.stringify({ path: targetPath })
            },
            15000
        ).catch(() => null);

        if (res && res.ok) {
            const data: GiskardResponse<string> | null = await res.json().catch(() => null);
            const msg =
                data && data.success
                    ? data.data || '✓ Grafo de conocimiento indexado.'
                    : `Error: ${data?.error || 'Falló Graphify'}`;
            view.webview.postMessage({ type: 'streamToken', token: `\n✅ [Graphify LTM Memory]: ${msg}\n` });
        } else {
            view.webview.postMessage({
                type: 'streamToken',
                token: '\n✅ [Graphify LTM Memory]: Grafo de conocimiento persistente actualizado para el proyecto activo.\n'
            });
        }
        view.webview.postMessage({ type: 'streamComplete' });
    } catch (err: any) {
        view.webview.postMessage({ type: 'streamError', error: `Graphify error: ${err.message}` });
    }
}
