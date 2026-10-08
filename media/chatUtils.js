/**
 * Giskard Assistant VSCode Extension — Module: Chat Utilities & Markdown Formatting
 * Copyright (C) 2025-2026 Giskard Project
 */

const vscode = acquireVsCodeApi();

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let _lastUserPrompt = ''; // saved to allow re-injection after file reads
let _toolCallDepth = 0; // anti-loop: limit re-injection to 1 level
let _pendingApproval = false;


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
    try {
        localStorage.setItem('giskard_theme', theme);
    } catch {}
}


/** Real source/editor file extensions — avoids mistaking versions (v1.0.0) or package names for paths */
const SOURCE_FILE_EXT_RE =
    /\.(ts|tsx|js|jsx|json|py|rs|md|mdx|html|css|scss|sass|less|c|cpp|cc|h|hpp|go|yaml|yml|toml|sh|bash|zsh|fish|sql|vue|svelte|astro|java|kt|kts|rb|php|env|ini|cfg|conf|xml|svg|txt|lock|gradle|properties|nix|tf|proto|mjs|cjs|mts|cts)$/i;

function isLikelyFilePath(candidate) {
    if (!candidate || candidate.length < 4 || candidate.indexOf(' ') !== -1) return false;
    if (/^v?\d+(\.\d+)+$/.test(candidate)) return false; // v1.0.0 / 1.2.3
    return SOURCE_FILE_EXT_RE.test(candidate);
}

function extractFilePathFromCode(codeText, pre) {
    if (!codeText) return null;
    const lines = codeText.split('\n').slice(0, 4);
    for (const line of lines) {
        const match = line.match(
            /(?:\/\/|#|\/\*|<!--)\s*(?:file\s*:\s*|filepath\s*:\s*)?([a-zA-Z0-9_\-\.\/]+)/
        );
        if (match && match[1] && isLikelyFilePath(match[1])) return match[1];
    }
    if (pre && pre.previousElementSibling) {
        const text = pre.previousElementSibling.innerText || '';
        const match = text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        if (match && match[1] && isLikelyFilePath(match[1])) return match[1];
    }
    return null;
}

function attachFileClickHandlers(container) {
    if (!container) return;
    const codeEls = container.querySelectorAll('code');
    codeEls.forEach((el) => {
        if (el.parentNode && el.parentNode.tagName && el.parentNode.tagName.toLowerCase() === 'pre') return;
        const text = el.innerText ? el.innerText.trim() : '';
        const isFilePath =
            /^(\.|\/|[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(ts|js|json|py|rs|md|html|css|tsx|jsx|c|cpp|h|go|yaml|yml|toml|sh)$/i.test(
                text
            );

        if (isFilePath) {
            el.classList.add('file-link');
            el.title = `📄 Clic para abrir ${text} en VSCode`;
            el.style.cssText =
                'color: #38bdf8; cursor: pointer; text-decoration: underline; background: rgba(56, 189, 248, 0.12); padding: 2px 6px; border-radius: 4px; font-weight: bold; display: inline-flex; align-items: center; gap: 3px;';
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

    pres.forEach((pre) => {
        if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('code-box'))
            return;

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
        summary.style.cssText =
            'display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.35); padding: 4px 8px; border: 1px solid var(--vscode-input-border); border-bottom: none; border-top-left-radius: 6px; border-top-right-radius: 6px; font-size: 10px; cursor: pointer; user-select: none; opacity: 0.95;';

        const langClass = (codeEl ? codeEl.className : '').toLowerCase();
        const isShellCommand =
            /language-(bash|sh|zsh|shell|console|powershell|cmd)\b/.test(langClass) ||
            (!detectedPath &&
                /^(?:sudo\s+|npm\s+|cargo\s+|git\s+|cd\s+|ls\s+|pip\s+|python\s+|code\s+|docker\s+|npx\s+)/i.test(
                    codeText.trim()
                ));

        const langLabel = document.createElement('span');
        langLabel.style.color = isShellCommand ? '#f59e0b' : '#38bdf8';
        langLabel.style.fontWeight = 'bold';
        langLabel.textContent = detectedPath
            ? `▶ 📄 ${detectedPath}`
            : isShellCommand
              ? '▶ ⚡ Shell Command'
              : '▶ 💻 Code';

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '6px';
        btnGroup.style.alignItems = 'center';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋';
        copyBtn.title = 'Copy code';
        copyBtn.style.cssText =
            'background: transparent; border: 1px solid var(--vscode-input-border); padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer;';
        copyBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(codeText).catch(function () {});
                }
            } catch (err) {}
            vscode.postMessage({ type: 'copyToClipboard', text: codeText });
            copyBtn.textContent = '✓ Copied';
            setTimeout(() => {
                copyBtn.textContent = '📋';
            }, 1500);
        };
        btnGroup.appendChild(copyBtn);

        if (isShellCommand) {
            const runBtn = document.createElement('button');
            runBtn.textContent = '⚡ Shell';
            runBtn.title = 'Run in terminal';
            runBtn.style.cssText =
                'background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid #f59e0b; padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold;';
            runBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({
                    type: 'toolExec',
                    command: codeText.trim(),
                    args: [],
                    id: Date.now(),
                    approved: false
                });
            };
            btnGroup.appendChild(runBtn);
        } else {
            const diffBtn = document.createElement('button');
            diffBtn.textContent = '📝 Apply Change';
            diffBtn.title = detectedPath
                ? `Open and apply changes to ${detectedPath}`
                : 'Select file and apply changes';
            diffBtn.style.cssText =
                'background: #16a34a; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold; box-shadow: 0 0 6px rgba(22,163,74,0.5);';
            diffBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (detectedPath) {
                    vscode.postMessage({ type: 'openDiff', code: codeText, filePath: detectedPath });
                } else {
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.placeholder = 'ruta/al/archivo.ts';
                    inp.style.cssText =
                        'font-size:9px;padding:2px 4px;border-radius:3px;border:1px solid #16a34a;background:#0f172a;color:#f8fafc;width:140px;';
                    const okBtn = document.createElement('button');
                    okBtn.textContent = '→';
                    okBtn.style.cssText =
                        'background:#16a34a;color:#fff;border:none;padding:2px 5px;border-radius:3px;font-size:9px;cursor:pointer;margin-left:3px;';
                    okBtn.onclick = (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (inp.value.trim()) {
                            vscode.postMessage({
                                type: 'openDiff',
                                code: codeText,
                                filePath: inp.value.trim()
                            });
                        }
                    };
                    inp.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') okBtn.click();
                    });
                    btnGroup.innerHTML = '';
                    btnGroup.appendChild(inp);
                    btnGroup.appendChild(okBtn);
                    inp.focus();
                }
            };
            btnGroup.appendChild(diffBtn);
        }

        if (detectedPath) {
            const openBtn = document.createElement('button');
            openBtn.textContent = '📄';
            openBtn.title = `Abrir ${detectedPath}`;
            openBtn.style.cssText =
                'background: transparent; border: 1px solid #38bdf8; color: #38bdf8; padding: 2px 5px; border-radius: 3px; font-size: 9px; cursor: pointer;';
            openBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
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
        applyBtn.style.cssText =
            'background:#16a34a;color:#fff;border:none;padding:5px 12px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:bold;box-shadow:0 0 8px rgba(22,163,74,0.6);flex-shrink:0;';
        applyBtn.onclick = () => {
            vscode.postMessage({
                type: 'openDiff',
                code: lastCodeText,
                filePath: lastDetectedPath || undefined
            });
        };

        const hint = document.createElement('span');
        hint.style.cssText = 'opacity:0.5;font-size:9px;';
        hint.textContent = lastDetectedPath ? `→ ${lastDetectedPath}` : '(selecciona archivo en el picker)';

        applyBar.appendChild(applyBtn);
        applyBar.appendChild(hint);
        container.appendChild(applyBar);
    }
}
