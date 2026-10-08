/**
 * Giskard Assistant VSCode Extension — Célula webview: Tool Calls del Agente
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de chatUtils.js (wave E): parseo de tool calls, tarjeta de
 * aprobación, dispatch y plan. Scope global compartido (patrón wave 7b) —
 * carga DESPUÉS de chatUtils.js (usa escapeHtml y el estado del host).
 */

/**
 * Tarjeta de aprobacion para operaciones con efecto (exec, write_file).
 * Fail-closed: sin UI disponible NO se ejecuta. Timeout de 60s descarta.
 */
function showToolApprovalCard(title, detail, onApprove, onDeny) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) {
        if (onDeny) onDeny();
        return;
    }
    const div = document.createElement('div');
    div.className = 'msg bot system-tool-msg';
    div.style.cssText = 'opacity:0.95;border-left:3px solid #fbbf24;padding-left:8px;font-size:10px;';
    div.innerHTML =
        '<span style="color:#fbbf24;font-weight:bold;">🛡️ Aprobacion requerida</span><br><b>' +
        title +
        '</b><br>' +
        detail +
        '<br>';
    const btnApprove = document.createElement('button');
    btnApprove.textContent = 'Aprobar';
    btnApprove.style.cssText =
        'margin:6px 6px 0 0;padding:4px 10px;cursor:pointer;background:#34d399;color:#111;border:none;border-radius:3px;font-weight:bold;';
    const btnDeny = document.createElement('button');
    btnDeny.textContent = 'Descartar';
    btnDeny.style.cssText =
        'margin:6px 0 0 0;padding:4px 10px;cursor:pointer;background:#f87171;color:#111;border:none;border-radius:3px;font-weight:bold;';
    let decided = false;
    const finish = (approve) => {
        if (decided) return;
        decided = true;
        _pendingApproval = false;
        div.remove();
        if (approve) {
            onApprove();
        } else if (onDeny) {
            onDeny();
        }
    };
    btnApprove.onclick = () => finish(true);
    btnDeny.onclick = () => finish(false);
    div.appendChild(btnApprove);
    div.appendChild(btnDeny);
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    _pendingApproval = true;
    setTimeout(() => {
        if (!decided) finish(false);
    }, 60000);
}

function parseToolCalls(text) {
    const toolCalls = [];
    if (!text) return { cleanText: '', toolCalls: [] };

    // 1. Formato [TOOL_CALL] ... [/END_TOOL] y <tool_call> ... </tool_call>
    //    Regex SEPARADAS por formato: un cierre de otro formato NO matchea.
    const bracketRe = /\[TOOL_CALL\]\s*([\s\S]*?)\s*\[\/END_TOOL\]/gi;
    const xmlRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    for (const re of [bracketRe, xmlRe]) {
        let match;
        while ((match = re.exec(text)) !== null) {
            try {
                const call = JSON.parse(match[1].trim());
                toolCalls.push(call);
            } catch (e) {}
        }
    }

    // 2. Balanced brace JSON tool call parser for nested objects like {"tool":"read_file", "args":{"path":"..."}}
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
            const candidateStr = text.substring(idx, endIdx + 1);
            try {
                const obj = JSON.parse(candidateStr);
                if (obj && typeof obj === 'object' && (obj.tool || obj.action)) {
                    const action = obj.tool || obj.action;
                    const args = obj.args || obj;
                    const pathStr = args.path || obj.path;
                    const queryStr = args.query || obj.query;
                    const patternStr = args.pattern || obj.pattern;
                    const cmdStr = args.command || obj.command;
                    const content = args.content || obj.content;
                    if (
                        action &&
                        (pathStr || queryStr || patternStr || cmdStr) &&
                        !toolCalls.some(
                            (t) =>
                                t.action === action &&
                                (t.path === pathStr || t.query === queryStr || t.pattern === patternStr)
                        )
                    ) {
                        toolCalls.push({
                            action: action,
                            path: pathStr,
                            query: queryStr,
                            pattern: patternStr,
                            command: cmdStr,
                            args: Array.isArray(args.args) ? args.args : undefined,
                            content: content
                        });
                    }
                }
            } catch (e) {}
        }
        idx = text.indexOf('{', idx + 1);
    }

    const cleanText = text
        .replace(/\[TOOL_CALL\]\s*[\s\S]*?\s*\[\/END_TOOL\]/gi, '')
        .replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/gi, '')
        .trim();
    return { cleanText, toolCalls };
}

function appendSystemMessage(html, icon) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    const div = document.createElement('div');
    div.className = 'msg bot system-tool-msg';
    div.style.cssText = 'opacity:0.85;border-left:3px solid #38bdf8;padding-left:8px;font-size:10px;';
    div.innerHTML =
        '<span style="color:#38bdf8;font-weight:bold;">' + (icon || '🔧') + ' Sistema</span><br>' + html;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function dispatchToolCalls(toolCalls) {
    for (const call of toolCalls) {
        const args = call.args || call;
        switch (call.action) {
            case 'read_file':
                appendSystemMessage('📖 Leyendo <code>' + escapeHtml(call.path) + '</code>...', '📂');
                vscode.postMessage({ type: 'toolReadFile', path: call.path, id: Date.now() });
                break;
            case 'write_file': {
                // Gate real (wave 012): sin aprobacion NO se escribe.
                const previewLen = String(call.content || '').length;
                const preview = String(call.content || '').slice(0, 200);
                showToolApprovalCard(
                    'Escribir archivo: <code>' + escapeHtml(call.path) + '</code>',
                    'Contenido: <pre style="white-space:pre-wrap;max-height:80px;overflow:auto;margin:4px 0;">' +
                        escapeHtml(preview) +
                        (previewLen > 200 ? '…' : '') +
                        '</pre>',
                    () => {
                        appendSystemMessage(
                            '✅ Aprobado: escribiendo <code>' + escapeHtml(call.path) + '</code>...',
                            '📝'
                        );
                        vscode.postMessage({
                            type: 'toolWriteFile',
                            path: call.path,
                            content: call.content,
                            id: Date.now()
                        });
                    },
                    () =>
                        appendSystemMessage(
                            '⛔ Escritura descartada por el usuario para <code>' +
                                escapeHtml(call.path) +
                                '</code>.',
                            '🛡️'
                        )
                );
                break;
            }
            case 'list_dir':
                appendSystemMessage('📂 Listando <code>' + escapeHtml(call.path || '.') + '</code>...', '📂');
                vscode.postMessage({ type: 'toolListDir', path: call.path || '.', id: Date.now() });
                break;
            case 'search':
                appendSystemMessage('🔍 Buscando <code>' + escapeHtml(call.query || '') + '</code>...', '🔍');
                vscode.postMessage({ type: 'toolSearch', query: call.query || '', id: Date.now() });
                break;
            case 'glob':
                appendSystemMessage(
                    '🗂️ Glob <code>' + escapeHtml(call.pattern || '**/*') + '</code>...',
                    '🗂️'
                );
                vscode.postMessage({ type: 'toolGlob', pattern: call.pattern || '**/*', id: Date.now() });
                break;
            case 'exec': {
                var cmdArgs = Array.isArray(call.args)
                    ? call.args
                    : Array.isArray(args.args)
                      ? args.args
                      : [];
                var cmdStr = (call.command || '') + ' ' + cmdArgs.join(' ');
                // Gate real (wave 012): sin aprobacion NO se ejecuta.
                showToolApprovalCard(
                    'Ejecutar comando: <code>' + escapeHtml(cmdStr) + '</code>',
                    'Se ejecutara en el sandbox de giskard-sys (jail de rutas y whitelist).',
                    () => {
                        appendSystemMessage(
                            '✅ Aprobado: ejecutando <code>' + escapeHtml(cmdStr) + '</code>',
                            '💻'
                        );
                        vscode.postMessage({
                            type: 'toolExec',
                            command: call.command,
                            args: cmdArgs,
                            id: Date.now()
                        });
                    },
                    () =>
                        appendSystemMessage(
                            '⛔ Comando descartado por el usuario: <code>' + escapeHtml(cmdStr) + '</code>.',
                            '🛡️'
                        )
                );
                break;
            }
            default:
                appendSystemMessage(
                    '⚠️ Acción desconocida: <code>' + escapeHtml(call.action) + '</code>',
                    '⚠️'
                );
        }
    }
}

function extractPlan(text) {
    if (!text) return null;
    const m = text.match(/\[PLAN\]([\s\S]*?)\[\/END_PLAN\]/);
    if (m && m[1] && m[1].trim()) return m[1].trim();
    return null;
}
