/**
 * Giskard Assistant VSCode Extension — Module: Chat Utilities & Markdown Formatting
 * Copyright (C) 2025-2026 Giskard Project
 */

const vscode = acquireVsCodeApi();

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let _lastUserPrompt = '';   // saved to allow re-injection after file reads
let _toolCallDepth = 0;     // anti-loop: limit re-injection to 1 level

function parseToolCalls(text) {
    const toolCalls = [];
    if (!text) return { cleanText: '', toolCalls: [] };
    
    // 1. Standard [TOOL_CALL] ... [/END_TOOL]
    const regex1 = /\[TOOL_CALL\]\s*([\s\S]*?)\s*\[\/END_TOOL\]/g;
    let match;
    while ((match = regex1.exec(text)) !== null) {
        try {
            const call = JSON.parse(match[1].trim());
            toolCalls.push(call);
        } catch (e) {}
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
                    const pathStr = obj.path || (obj.args ? obj.args.path : null);
                    if (action && pathStr && !toolCalls.some(t => t.path === pathStr && t.action === action)) {
                        toolCalls.push({
                            action: action,
                            path: pathStr,
                            content: obj.content || (obj.args ? obj.args.content : undefined)
                        });
                    }
                }
            } catch (e) {}
        }
        idx = text.indexOf('{', idx + 1);
    }

    const cleanText = text.replace(/\[TOOL_CALL\]\s*[\s\S]*?\s*\[\/END_TOOL\]/g, '').trim();
    return { cleanText, toolCalls };
}

function appendSystemMessage(html, icon) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    const div = document.createElement('div');
    div.className = 'msg bot system-tool-msg';
    div.style.cssText = 'opacity:0.85;border-left:3px solid #38bdf8;padding-left:8px;font-size:10px;';
    div.innerHTML = '<span style="color:#38bdf8;font-weight:bold;">' + (icon || '🔧') + ' Sistema</span><br>' + html;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function dispatchToolCalls(toolCalls) {
    for (const call of toolCalls) {
        switch (call.action) {
            case 'read_file':
                appendSystemMessage('📖 Leyendo <code>' + escapeHtml(call.path) + '</code>...', '📂');
                vscode.postMessage({ type: 'toolReadFile', path: call.path, id: Date.now() });
                break;
            case 'write_file':
                appendSystemMessage('✏️ Preparando diff para <code>' + escapeHtml(call.path) + '</code>...', '📝');
                vscode.postMessage({ type: 'toolWriteFile', path: call.path, content: call.content, id: Date.now() });
                break;
            case 'exec':
                var cmdStr = call.command + ' ' + (call.args || []).join(' ');
                appendSystemMessage('⚡ Ejecutando: <code>' + escapeHtml(cmdStr) + '</code>', '💻');
                vscode.postMessage({ type: 'toolExec', command: call.command, args: call.args || [], id: Date.now() });
                break;
            default:
                appendSystemMessage('⚠️ Acción desconocida: <code>' + escapeHtml(call.action) + '</code>', '⚠️');
        }
    }
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'cyan_accent') {
        root.style.setProperty('--user-font-color', '#e0f2fe');
        root.style.setProperty('--user-header-color', '#38bdf8');
        root.style.setProperty('--user-header-border', 'rgba(56, 189, 248, 0.25)');
    } else {
        root.style.setProperty('--user-font-color', '#f8fafc');
        root.style.setProperty('--user-header-color', '#ffffff');
        root.style.setProperty('--user-header-border', 'rgba(255, 255, 255, 0.15)');
    }
    try { localStorage.setItem('giskard_theme', theme); } catch {}
}

function preprocessMarkdown(text) {
    if (!text) return '';
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map(part => {
        if (part.startsWith('```')) return part;
        let clean = part;
        clean = clean.replace(/([^\n])(\s*##+\s)/g, '$1\n\n$2');
        clean = clean.replace(/([:\.\wáéíóúñA-Z])\s*(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');
        clean = clean.replace(/([^\n])(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');
        clean = clean.replace(/([^\n])(-\s+[\*\*\wáéíóúñA-Z✔️✅❌💡▶])/g, '$1\n$2');
        if (clean.includes('├──') || clean.includes('└──')) {
            clean = clean.replace(/((?:^[ \t]*(?:├──|└──|│|\/)[^\n]*\n?)+)/gm, '\n```text\n$1```\n');
        }
        return clean;
    }).join('');
}

function formatMarkdown(text) {
    if (!text) return '';
    const preprocessed = preprocessMarkdown(text);
    let htmlText = preprocessed;
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        try {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({ breaks: true, gfm: true });
            }
            htmlText = marked.parse(preprocessed);
        } catch (e) {
            console.error('Markdown error:', e);
            htmlText = escapeHtml(preprocessed);
        }
    } else {
        htmlText = escapeHtml(preprocessed);
    }
    return htmlText;
}

function extractFilePathFromCode(codeText, pre) {
    if (!codeText) return null;
    const lines = codeText.split('\n').slice(0, 4);
    for (const line of lines) {
        const match = line.match(/(?:\/\/|#|\/\*|<!--)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        if (match && match[1]) return match[1];
    }
    if (pre && pre.previousElementSibling) {
        const text = pre.previousElementSibling.innerText || '';
        const match = text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        if (match && match[1]) return match[1];
    }
    return null;
}

function attachFileClickHandlers(container) {
    if (!container) return;
    const codeEls = container.querySelectorAll('code');
    codeEls.forEach(el => {
        if (el.parentNode && el.parentNode.tagName && el.parentNode.tagName.toLowerCase() === 'pre') return;
        const text = el.innerText ? el.innerText.trim() : '';
        const isFilePath = /^(\.|\/|[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(ts|js|json|py|rs|md|html|css|tsx|jsx|c|cpp|h|go|yaml|yml|toml|sh)$/i.test(text);

        if (isFilePath) {
            el.classList.add('file-link');
            el.title = `📄 Clic para abrir ${text} en VSCode`;
            el.style.cssText = 'color: #38bdf8; cursor: pointer; text-decoration: underline; background: rgba(56, 189, 248, 0.12); padding: 2px 6px; border-radius: 4px; font-weight: bold; display: inline-flex; align-items: center; gap: 3px;';
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'openFile', relativePath: text });
            };
        }
    });
}

function attachCodeBlockActions(container) {
    if (!container) return;
    const pres = container.querySelectorAll('pre');
    let codeBlockCount = 0;
    let lastCodeText = '';
    let lastDetectedPath = null;

    pres.forEach(pre => {
        if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('code-box')) return;

        const codeEl = pre.querySelector('code');
        const codeText = codeEl ? codeEl.innerText : pre.innerText;

        if (!codeText || !codeText.trim()) {
            pre.style.display = 'none';
            return;
        }
        pre.style.display = 'block';

        const detectedPath = extractFilePathFromCode(codeText, pre);
        const lineCount = codeText.trim().split('\n').length;

        if (lineCount >= 3) {
            codeBlockCount++;
            lastCodeText = codeText;
            lastDetectedPath = detectedPath;
        }

        const details = document.createElement('details');
        details.className = 'code-box';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'code-toolbar';
        summary.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.35); padding: 4px 8px; border: 1px solid var(--vscode-input-border); border-bottom: none; border-top-left-radius: 6px; border-top-right-radius: 6px; font-size: 10px; cursor: pointer; user-select: none; opacity: 0.95;';

        const langLabel = document.createElement('span');
        langLabel.style.color = '#38bdf8';
        langLabel.style.fontWeight = 'bold';
        langLabel.textContent = detectedPath ? `▶ 📄 ${detectedPath}` : '▶ 💻 Código / Shell';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '6px';
        btnGroup.style.alignItems = 'center';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋';
        copyBtn.title = 'Copiar código';
        copyBtn.style.cssText = 'background: transparent; border: 1px solid var(--vscode-input-border); padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer;';
        copyBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            navigator.clipboard.writeText(codeText);
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
        };

        const runBtn = document.createElement('button');
        runBtn.textContent = '⚡ Shell';
        runBtn.title = 'Ejecutar en terminal';
        runBtn.style.cssText = 'background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid #38bdf8; padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer;';
        runBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            vscode.postMessage({ type: 'executeShellCommand', command: codeText.trim() });
        };

        const diffBtn = document.createElement('button');
        diffBtn.textContent = '📝 Aplicar Diff';
        diffBtn.title = detectedPath ? `Abrir diff y aplicar a ${detectedPath}` : 'Seleccionar archivo y aplicar diff';
        diffBtn.style.cssText = 'background: #16a34a; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold; box-shadow: 0 0 6px rgba(22,163,74,0.5);';
        diffBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (detectedPath) {
                vscode.postMessage({ type: 'openDiff', code: codeText, filePath: detectedPath });
            } else {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.placeholder = 'ruta/al/archivo.ts';
                inp.style.cssText = 'font-size:9px;padding:2px 4px;border-radius:3px;border:1px solid #16a34a;background:#0f172a;color:#f8fafc;width:140px;';
                const okBtn = document.createElement('button');
                okBtn.textContent = '→';
                okBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;padding:2px 5px;border-radius:3px;font-size:9px;cursor:pointer;margin-left:3px;';
                okBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    const p = inp.value.trim();
                    vscode.postMessage({ type: 'openDiff', code: codeText, filePath: p || undefined });
                    inp.remove(); okBtn.remove();
                };
                inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') okBtn.click(); });
                btnGroup.appendChild(inp);
                btnGroup.appendChild(okBtn);
                inp.focus();
            }
        };

        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(runBtn);
        btnGroup.appendChild(diffBtn);

        if (detectedPath) {
            const openBtn = document.createElement('button');
            openBtn.textContent = '📄';
            openBtn.title = `Abrir ${detectedPath}`;
            openBtn.style.cssText = 'background: transparent; border: 1px solid #38bdf8; color: #38bdf8; padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer;';
            openBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                vscode.postMessage({ type: 'openFile', relativePath: detectedPath });
            };
            btnGroup.appendChild(openBtn);
        }

        summary.appendChild(langLabel);
        summary.appendChild(btnGroup);

        pre.style.marginTop = '0';
        pre.style.borderTopLeftRadius = '0';
        pre.style.borderTopRightRadius = '0';
        pre.style.maxHeight = '320px';
        pre.style.overflowY = 'auto';
        pre.style.overflowX = 'auto';

        pre.parentNode.insertBefore(details, pre);
        details.appendChild(summary);
        details.appendChild(pre);
    });

    if (codeBlockCount > 0) {
        const applyBar = document.createElement('div');
        applyBar.style.cssText = 'margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = '🚀 Aplicar último bloque de código';
        applyBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;padding:5px 12px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:bold;box-shadow:0 0 8px rgba(22,163,74,0.6);flex-shrink:0;';
        applyBtn.onclick = () => {
            vscode.postMessage({ type: 'openDiff', code: lastCodeText, filePath: lastDetectedPath || undefined });
        };

        const hint = document.createElement('span');
        hint.style.cssText = 'opacity:0.5;font-size:9px;';
        hint.textContent = lastDetectedPath ? `→ ${lastDetectedPath}` : '(selecciona archivo en el picker)';

        applyBar.appendChild(applyBtn);
        applyBar.appendChild(hint);
        container.appendChild(applyBar);
    }
}
