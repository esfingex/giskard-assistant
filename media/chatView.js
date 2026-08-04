(function() {
    const vscode = acquireVsCodeApi();

    const sendBtn = document.getElementById('send-btn');
    const promptInput = document.getElementById('prompt');
    const modelSelect = document.getElementById('model-select');
    const messagesDiv = document.getElementById('messages');
    const incFileCheckbox = document.getElementById('inc-file');
    const addCtxBtn = document.getElementById('add-ctx-btn');
    const compressBtn = document.getElementById('compress-btn');
    const tokenCounter = document.getElementById('token-counter');
    const ctxMenu = document.getElementById('context-menu');

    const openSettingsBtn = document.getElementById('open-settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const saveCfgBtn = document.getElementById('save-cfg-btn');
    const ctxGraphify = document.getElementById('ctx-graphify');
    const clearCtxBtn = document.getElementById('clear-ctx-btn');
    const offlineBadge = document.getElementById('offline-badge');

    const cfgConnectorUrl = document.getElementById('cfg-connector-url');
    const modelFilterList = document.getElementById('model-filter-list');

    const cmdPolicyList = document.getElementById('cmd-policy-list');
    const addCmdInput = document.getElementById('add-cmd-input');
    const addCmdBtn = document.getElementById('add-cmd-btn');

    const tabBtnLocal = document.getElementById('tab-btn-local');
    const tabBtnRemote = document.getElementById('tab-btn-remote');
    const tabContentLocal = document.getElementById('tab-content-local');
    const tabContentRemote = document.getElementById('tab-content-remote');

    let currentBotMsgDiv = null;
    let currentBotRawText = '';
    let currentActiveModel = '';
    let selectedContextType = 'none';

    let lastDetectedModels = [];

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // ─── Tool Call Interceptor ──────────────────────────────────────────────────
    // The AI emits [TOOL_CALL]{...}[/END_TOOL] blocks.
    // We parse them after stream ends, strip them from display, route to host.

    let _lastUserPrompt = '';   // saved to allow re-injection after file reads
    let _toolCallDepth = 0;     // anti-loop: limit re-injection to 1 level

    function parseToolCalls(text) {
        const toolCalls = [];
        const regex = /\[TOOL_CALL\]\s*([\s\S]*?)\s*\[\/END_TOOL\]/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            try {
                const call = JSON.parse(match[1].trim());
                toolCalls.push(call);
            } catch (e) {
                console.warn('[Giskard] Error parseando JSON de tool call:', e, match[1]);
            }
        }
        const cleanText = text.replace(/\[TOOL_CALL\]\s*[\s\S]*?\s*\[\/END_TOOL\]/g, '').trim();
        return { cleanText, toolCalls };
    }

    function appendSystemMessage(html, icon) {
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

    const savedTheme = (function() { try { return localStorage.getItem('giskard_theme') || 'minimal_white'; } catch { return 'minimal_white'; } })();
    applyTheme(savedTheme);

    const themeSelect = document.getElementById('cfg-theme-select');
    if (themeSelect) {
        themeSelect.value = savedTheme;
        themeSelect.addEventListener('change', () => {
            applyTheme(themeSelect.value);
        });
    }

    function preprocessMarkdown(text) {
        if (!text) return '';

        // Separar bloques de código (```...```) para NO alterar código ni árboles ASCII internos con expresiones regulares
        const parts = text.split(/(```[\s\S]*?```)/g);

        return parts.map(part => {
            if (part.startsWith('```')) {
                // Dejar el bloque de código 100% intacto con su formato original
                return part;
            }

            let clean = part;

            // 1. Separar títulos Markdown pegados (ej. "usbPara" -> "usb\n\n## Para")
            clean = clean.replace(/([^\n])(\s*##+\s)/g, '$1\n\n$2');

            // 2. Separar listas numeradas pegadas en texto (ej. "Pasos1. **Revisar...**2. **Analizar...**" -> "\n1. **Revisar...**\n2. **Analizar...**")
            clean = clean.replace(/([:\.\wáéíóúñA-Záéíóúñ])\s*(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');
            clean = clean.replace(/([^\n])(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');

            // 3. Separar listas de viñetas pegadas (ej. "Nota: - Elemento")
            clean = clean.replace(/([^\n])(-\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');

            // 4. Separar palabras pegadas a inicios de nombre (ej. "PrincipalesREADME" -> "Principales README")
            clean = clean.replace(/([a-z0-9áéíóúñ])([A-Z][a-z]{2,})/g, '$1 $2');

            // 5. Separar inline code pegado a palabras (ej. "sistema.gnome-extension" -> "sistema. gnome-extension")
            clean = clean.replace(/([a-z0-9áéíóúñ])(\`[a-zA-Z_\-\/]+\`)/g, '$1 $2');

            // 6. Detectar mapas de directorios ASCII sueltos (├──, └──, │) y envolverlos en bloques ```text en la extensión
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
            // Match relative or absolute file paths like src/extension.ts, ./package.json, file.py, etc.
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

            // Track for the post-message apply button
            if (lineCount >= 3) {
                codeBlockCount++;
                lastCodeText = codeText;
                lastDetectedPath = detectedPath;
            }

            // Create collapsible <details class="code-box" open>
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

            // ── DIFF BUTTON (prominent green) ──────────────────────────────
            const diffBtn = document.createElement('button');
            diffBtn.textContent = '📝 Aplicar Diff';
            diffBtn.title = detectedPath ? `Abrir diff y aplicar a ${detectedPath}` : 'Seleccionar archivo y aplicar diff';
            diffBtn.style.cssText = 'background: #16a34a; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold; box-shadow: 0 0 6px rgba(22,163,74,0.5);';
            diffBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (detectedPath) {
                    vscode.postMessage({ type: 'openDiff', code: codeText, filePath: detectedPath });
                } else {
                    // Inline file path picker
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

        // ── Post-message "Aplicar cambios" bar (if message has code blocks) ──
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



    function renderCommandPolicyList(cmds) {
        if (!cmdPolicyList) return;
        if (!cmds || cmds.length === 0) {
            cmdPolicyList.innerHTML = '<span style="opacity: 0.6; font-size: 9px;">Ningún comando permitido (Modo Solo Lectura Total)</span>';
            return;
        }
        let html = '';
        cmds.forEach(c => {
            html += `<div class="cmd-badge">
                <span>${escapeHtml(c)}</span>
                <button type="button" class="remove-cmd-btn" data-cmd="${escapeHtml(c)}" title="Bloquear / Eliminar comando">✖</button>
            </div>`;
        });
        cmdPolicyList.innerHTML = html;

        cmdPolicyList.querySelectorAll('.remove-cmd-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cmd = btn.getAttribute('data-cmd');
                if (cmd) {
                    vscode.postMessage({ type: 'removeAllowedCommand', command: cmd });
                }
            });
        });
    }

    if (addCmdBtn && addCmdInput) {
        addCmdBtn.addEventListener('click', () => {
            const val = addCmdInput.value.trim();
            if (val) {
                vscode.postMessage({ type: 'addAllowedCommand', command: val });
                addCmdInput.value = '';
            }
        });
    }

    function getEnabledModels() {
        try {
            const saved = localStorage.getItem('giskard_enabled_models');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    function setEnabledModels(enabledList) {
        try {
            localStorage.setItem('giskard_enabled_models', JSON.stringify(enabledList));
        } catch {}
    }

    function renderModelFilterList(ollamaModels) {
        if (!modelFilterList) return;
        lastDetectedModels = ollamaModels || [];
        
        const enabled = getEnabledModels();
        let html = '';

        if (lastDetectedModels.length > 0) {
            html += '<div class="filter-group-title">🚀 Enjambre Local (Ollama - ' + lastDetectedModels.length + ' detectados)</div>';
            lastDetectedModels.forEach(m => {
                const isChecked = !enabled || enabled.includes(m);
                html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 4px;">
                    <input type="checkbox" class="model-filter-cb" value="${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                    <span class="filter-tag ollama">OLLAMA</span>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
                </label>`;
            });
        }

        html += '<div class="filter-group-title" style="margin-top: 8px;">☁️ Orquestadores & CLIs</div>';
        const cliModels = [
            { id: 'cli:gemini', name: 'Gemini CLI (Google AI)' },
            { id: 'cli:claude', name: 'Claude CLI (Anthropic)' }
        ];
        cliModels.forEach(c => {
            const isChecked = !enabled || enabled.includes(c.id);
            html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 4px;">
                <input type="checkbox" class="model-filter-cb" value="${escapeHtml(c.id)}" ${isChecked ? 'checked' : ''}>
                <span class="filter-tag cli">CLI</span>
                <span>${escapeHtml(c.name)}</span>
            </label>`;
        });

        modelFilterList.innerHTML = html;
    }

    function updateModelDropdown(ollamaModels) {
        if (!modelSelect) return;
        lastDetectedModels = ollamaModels || [];
        const currentVal = modelSelect.value;
        const enabled = getEnabledModels();

        const localModels = lastDetectedModels.filter(m => !enabled || enabled.includes(m));
        const showGemini = !enabled || enabled.includes('cli:gemini');
        const showClaude = !enabled || enabled.includes('cli:claude');

        let html = '';
        if (localModels.length > 0) {
            html += '<optgroup label="🚀 Enjambre Local (Ollama - ' + localModels.length + ' activos)">';
            localModels.forEach(m => {
                let label = m;
                if (m.includes('distill') || m.includes('kimi')) label += ' (Kimi+Opus 🧠 128K)';
                else if (m.includes('coder') || m.includes('code')) label += ' (Coder ⚡ 64K)';
                else if (m.includes('phi')) label += ' (Fast ⚡ 32K)';
                else if (m.includes('aya')) label += ' (Traductor 🌐 32K)';
                html += '<option value="' + escapeHtml(m) + '">' + escapeHtml(label) + '</option>';
            });
            html += '</optgroup>';
        }

        if (showGemini || showClaude) {
            html += '<optgroup label="☁️ Orquestadores & CLIs">';
            if (showGemini) html += '<option value="cli:gemini">Gemini CLI (1M Context 🧠)</option>';
            if (showClaude) html += '<option value="cli:claude">Claude CLI (200K Context 🧠)</option>';
            html += '</optgroup>';
        }

        if (!html) {
            html = '<option value="qwimi-k2.6:distill">qwimi-k2.6:distill (128K Default)</option>';
        }
        
        modelSelect.innerHTML = html;
        
        if (currentVal) {
            for (let i = 0; i < modelSelect.options.length; i++) {
                if (modelSelect.options[i].value === currentVal) {
                    modelSelect.selectedIndex = i;
                    break;
                }
            }
        }
        updateTokenCounter();
    }

    function updateBotMessageDisplay(div, fullText, modelName, isStreaming) {
        if (!div) return;
        currentBotRawText = fullText;
        let clean = fullText.replace(/&lt;think&gt;/g, '<think>').replace(/&lt;\/think&gt;/g, '</think>');
        
        const activeModel = modelName || (modelSelect ? modelSelect.value : 'model');
        const modelTagHtml = '<div class="model-tag">🏷️ ' + escapeHtml(activeModel) + '</div>';

        if (clean.indexOf('</think>') !== -1) {
            const parts = clean.split('</think>');
            const thinkContent = parts[0].replace('<think>', '').trim();
            const answerContent = parts.slice(1).join('</think>').trim();

            const openAttr = isStreaming ? 'open' : '';
            div.innerHTML = modelTagHtml +
                            '<details class="think-box" ' + openAttr + '>' +
                            '<summary>💡 Pensamiento de la IA (Ocultar/Mostrar)</summary>' +
                            '<div class="think-content">' + formatMarkdown(thinkContent) + '</div>' +
                            '</details>' +
                            '<div class="answer-content">' + formatMarkdown(answerContent) + '</div>';
        } else if (clean.startsWith('<think>')) {
            const thinkContent = clean.replace('<think>', '').trim();
            div.innerHTML = modelTagHtml +
                            '<details class="think-box" open>' +
                            '<summary>💡 Pensamiento de la IA (Razonando...)</summary>' +
                            '<div class="think-content">' + formatMarkdown(thinkContent) + '</div>' +
                            '</details>';
        } else {
            div.innerHTML = modelTagHtml + '<div class="answer-content">' + formatMarkdown(fullText) + '</div>';
        }

        attachCodeBlockActions(div);
        attachFileClickHandlers(div);
    }

    function updateTokenCounter() {
        if (!messagesDiv || !tokenCounter) return;
        let totalChars = 0;
        messagesDiv.querySelectorAll('.msg').forEach(m => totalChars += m.textContent.length);
        const totalEstTokens = Math.ceil(totalChars / 4);

        let maxTokens = 32768;
        const currentModel = (modelSelect ? modelSelect.value : '').toLowerCase();
        if (currentModel.includes('qwimi') || currentModel.includes('distill') || currentModel.includes('kimi')) {
            maxTokens = 131072; // 128K Context Window
        } else if (currentModel.includes('coder') || currentModel.includes('code') || currentModel.includes('agent')) {
            maxTokens = 65536; // 64K Context Window
        } else if (currentModel.includes('gemini')) {
            maxTokens = 1048576; // 1M Context Window
        } else if (currentModel.includes('claude')) {
            maxTokens = 200000; // 200K Context Window
        }

        tokenCounter.textContent = '🔢 Tokens: ' + totalEstTokens.toLocaleString() + ' / ' + maxTokens.toLocaleString();
        tokenCounter.style.color = totalEstTokens > (maxTokens * 0.8) ? '#ff6b6b' : 'inherit';
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', updateTokenCounter);
    }

    const tabBtnPalette = document.getElementById('tab-btn-palette');
    const tabContentPalette = document.getElementById('tab-content-palette');

    function switchTab(activeBtn, activeContent) {
        [tabBtnLocal, tabBtnRemote, tabBtnPalette].forEach(b => { if (b) b.classList.remove('active'); });
        [tabContentLocal, tabContentRemote, tabContentPalette].forEach(c => { if (c) c.classList.remove('active'); });
        if (activeBtn) activeBtn.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }

    if (tabBtnLocal) tabBtnLocal.addEventListener('click', () => switchTab(tabBtnLocal, tabContentLocal));
    if (tabBtnRemote) tabBtnRemote.addEventListener('click', () => switchTab(tabBtnRemote, tabContentRemote));
    if (tabBtnPalette) tabBtnPalette.addEventListener('click', () => switchTab(tabBtnPalette, tabContentPalette));

    const colorTextInp = document.getElementById('palette-text-color');
    const colorHeaderInp = document.getElementById('palette-header-color');
    const colorAccentInp = document.getElementById('palette-accent-color');
    const colorUserBgInp = document.getElementById('palette-user-bg');
    const colorBotBgInp = document.getElementById('palette-bot-bg');
    const colorThinkBgInp = document.getElementById('palette-think-bg');

    function setCustomColors(textColor, headerColor, accentColor, userBg, botBg, thinkBg) {
        const root = document.documentElement;
        if (textColor) root.style.setProperty('--user-font-color', textColor);
        if (headerColor) root.style.setProperty('--user-header-color', headerColor);
        if (accentColor) root.style.setProperty('--user-header-border', accentColor);
        if (userBg) root.style.setProperty('--user-msg-bg', userBg);
        if (botBg) root.style.setProperty('--bot-msg-bg', botBg);
        if (thinkBg) root.style.setProperty('--think-box-bg', thinkBg);

        if (colorTextInp && textColor) colorTextInp.value = textColor;
        if (colorHeaderInp && headerColor) colorHeaderInp.value = headerColor;
        if (colorAccentInp && accentColor) colorAccentInp.value = accentColor;
        if (colorUserBgInp && userBg) colorUserBgInp.value = userBg;
        if (colorBotBgInp && botBg) colorBotBgInp.value = botBg;
        if (colorThinkBgInp && thinkBg) colorThinkBgInp.value = thinkBg;

        try {
            localStorage.setItem('giskard_palette', JSON.stringify({ textColor, headerColor, accentColor, userBg, botBg, thinkBg }));
        } catch {}
    }

    const presetWhite = document.getElementById('preset-white');
    const presetCyan = document.getElementById('preset-cyan');
    const presetEmerald = document.getElementById('preset-emerald');
    const presetPurple = document.getElementById('preset-purple');

    if (presetWhite) presetWhite.addEventListener('click', () => setCustomColors('#f8fafc', '#ffffff', '#475569', '#1e293b', '#0f172a', 'rgba(0,0,0,0.3)'));
    if (presetCyan) presetCyan.addEventListener('click', () => setCustomColors('#e0f2fe', '#38bdf8', '#0284c7', '#0284c7', '#0f172a', 'rgba(2,132,199,0.15)'));
    if (presetEmerald) presetEmerald.addEventListener('click', () => setCustomColors('#ecfdf5', '#34d399', '#059669', '#059669', '#064e3b', 'rgba(5,150,105,0.15)'));
    if (presetPurple) presetPurple.addEventListener('click', () => setCustomColors('#faf5ff', '#c084fc', '#9333ea', '#7e22ce', '#3b0764', 'rgba(147,51,234,0.15)'));

    function updateColorsFromInputs() {
        setCustomColors(
            colorTextInp ? colorTextInp.value : null,
            colorHeaderInp ? colorHeaderInp.value : null,
            colorAccentInp ? colorAccentInp.value : null,
            colorUserBgInp ? colorUserBgInp.value : null,
            colorBotBgInp ? colorBotBgInp.value : null,
            colorThinkBgInp ? colorThinkBgInp.value : null
        );
    }

    [colorTextInp, colorHeaderInp, colorAccentInp, colorUserBgInp, colorBotBgInp, colorThinkBgInp].forEach(inp => {
        if (inp) inp.addEventListener('input', updateColorsFromInputs);
    });

    try {
        const savedP = localStorage.getItem('giskard_palette');
        if (savedP) {
            const p = JSON.parse(savedP);
            setCustomColors(p.textColor, p.headerColor, p.accentColor, p.userBg, p.botBg, p.thinkBg);
        }
    } catch {}

    if (ctxGraphify) {
        ctxGraphify.addEventListener('click', () => {
            vscode.postMessage({ type: 'runGraphify' });
            if (ctxMenu) ctxMenu.style.display = 'none';
        });
    }

    // 🗑️ Clear Context button
    if (clearCtxBtn) {
        clearCtxBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearContext' });
        });
    }

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'flex';
            vscode.postMessage({ type: 'loadConnections' });
            vscode.postMessage({ type: 'fetchModels' });
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'none'; 
        });
    }

    // ── Connection Manager UI Bindings ─────────────────────────────────────
    const connTypeLocal = document.getElementById('conn-type-local');
    const connTypeRemote = document.getElementById('conn-type-remote');
    const connTokenField = document.getElementById('conn-token-field');
    const connNameInp = document.getElementById('conn-name');
    const connUrlInp = document.getElementById('conn-url');
    const connTagSel = document.getElementById('conn-tag');
    const connTokenInp = document.getElementById('conn-token');
    const testConnBtn = document.getElementById('test-connection-btn');
    const addConnBtn = document.getElementById('add-connection-btn');
    const connStatusDiv = document.getElementById('connection-status');
    const connectionsListDiv = document.getElementById('connections-list');

    function updateConnTypeVisibility() {
        if (!connTokenField) return;
        const isRemote = connTypeRemote && connTypeRemote.checked;
        connTokenField.style.display = isRemote ? 'flex' : 'none';
    }

    if (connTypeLocal) connTypeLocal.addEventListener('change', updateConnTypeVisibility);
    if (connTypeRemote) connTypeRemote.addEventListener('change', updateConnTypeVisibility);

    if (testConnBtn) {
        testConnBtn.addEventListener('click', () => {
            const url = connUrlInp ? connUrlInp.value.trim() : '';
            if (!url) {
                if (connStatusDiv) connStatusDiv.innerHTML = '<span style="color:#f87171;">Escribe una URL primero</span>';
                return;
            }
            if (connStatusDiv) connStatusDiv.innerHTML = '<span style="color:#38bdf8;">⏳ Probando conexión...</span>';
            vscode.postMessage({ type: 'testConnectionUrl', url });
        });
    }

    if (addConnBtn) {
        addConnBtn.addEventListener('click', () => {
            const name = connNameInp ? connNameInp.value.trim() : '';
            const url = connUrlInp ? connUrlInp.value.trim() : '';
            const tag = connTagSel ? connTagSel.value : 'custom';
            const isRemote = connTypeRemote && connTypeRemote.checked;
            const apiKey = connTokenInp ? connTokenInp.value.trim() : '';

            if (!name || !url) {
                alert('Ingresa al menos un Nombre y una URL para la conexión.');
                return;
            }

            vscode.postMessage({
                type: 'addConnection',
                name,
                connType: isRemote ? 'remote' : 'local',
                url,
                tag,
                apiKey
            });

            if (connNameInp) connNameInp.value = '';
            if (connUrlInp) connUrlInp.value = '';
            if (connTokenInp) connTokenInp.value = '';
        });
    }

    function renderConnectionsList(connections) {
        if (!connectionsListDiv) return;
        if (!connections || connections.length === 0) {
            connectionsListDiv.innerHTML = '<span style="font-size:9px;opacity:0.5;">Sin conexiones guardadas</span>';
            return;
        }

        let html = '';
        connections.forEach(c => {
            const activeBadge = c.isActive
                ? '<span style="color:#4ade80;font-weight:bold;font-size:9px;">★ Activa</span>'
                : `<button type="button" class="btn-act-conn" data-id="${c.id}" style="padding:1px 5px;font-size:9px;background:transparent;border:1px solid #38bdf8;color:#38bdf8;border-radius:3px;cursor:pointer;">Activar</button>`;

            html += `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);border:1px solid var(--vscode-input-border);padding:4px 6px;border-radius:4px;font-size:10px;">
                <div style="display:flex;flex-direction:column;gap:1px;overflow:hidden;flex:1;">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="filter-tag ${c.type === 'local' ? 'ollama' : 'cli'}">${escapeHtml(c.tag.toUpperCase())}</span>
                        <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.name)}</strong>
                    </div>
                    <span style="opacity:0.6;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.url)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-left:6px;">
                    ${activeBadge}
                    <button type="button" class="btn-del-conn" data-id="${c.id}" style="background:transparent;border:none;color:#f87171;font-weight:bold;cursor:pointer;padding:0 2px;" title="Eliminar">✖</button>
                </div>
            </div>`;
        });

        connectionsListDiv.innerHTML = html;

        connectionsListDiv.querySelectorAll('.btn-act-conn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                if (id) vscode.postMessage({ type: 'activateConnection', id });
            });
        });

        connectionsListDiv.querySelectorAll('.btn-del-conn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                if (id) vscode.postMessage({ type: 'removeConnection', id });
            });
        });
    }

    if (compressBtn) {
        compressBtn.addEventListener('click', () => {
            let historyText = '';
            messagesDiv.querySelectorAll('.msg').forEach(m => {
                const isUser = m.classList.contains('user');
                historyText += (isUser ? 'Usuario: ' : 'IA: ') + m.textContent + '\n';
            });

            if (!historyText.trim()) return;

            const bMsg = document.createElement('div');
            bMsg.className = 'msg bot';
            bMsg.textContent = '🧠 Comprimiendo contexto y guardando memoria soberana BCF...';
            messagesDiv.appendChild(bMsg);
            currentBotMsgDiv = bMsg;
            currentBotRawText = '';

            vscode.postMessage({ type: 'compressMemory', history: historyText });
        });
    }

    if (addCtxBtn) {
        addCtxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (ctxMenu) ctxMenu.style.display = ctxMenu.style.display === 'flex' ? 'none' : 'flex';
        });
    }

    document.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.style.display = 'none';
    });

    const ctxMedia = document.getElementById('ctx-media');
    if (ctxMedia) ctxMedia.addEventListener('click', () => { selectedContextType = 'media'; addCtxBtn.textContent = '✓ +media'; if (ctxMenu) ctxMenu.style.display = 'none'; });
    
    const ctxMentions = document.getElementById('ctx-mentions');
    if (ctxMentions) ctxMentions.addEventListener('click', () => { selectedContextType = 'mentions'; addCtxBtn.textContent = '✓ +mentions'; if (ctxMenu) ctxMenu.style.display = 'none'; });
    
    const ctxCheck = document.getElementById('ctx-action-check');
    if (ctxCheck) ctxCheck.addEventListener('click', () => { vscode.postMessage({ type: 'executeAction', action: 'cargo check' }); if (ctxMenu) ctxMenu.style.display = 'none'; });
    
    const ctxPython = document.getElementById('ctx-action-python');
    const stopBtn = document.getElementById('stop-btn');

    function setGenerationState(isGenerating) {
        if (sendBtn) sendBtn.style.display = isGenerating ? 'none' : 'inline-block';
        if (stopBtn) stopBtn.style.display = isGenerating ? 'inline-block' : 'none';
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'stopGeneration' });
            setGenerationState(false);
        });
    }

    if (ctxPython) ctxPython.addEventListener('click', () => { vscode.postMessage({ type: 'executeAction', action: 'python3 -m unittest' }); if (ctxMenu) ctxMenu.style.display = 'none'; });

    if (sendBtn) sendBtn.addEventListener('click', send);

    if (promptInput) {
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });
    }

    function send() {
        if (!promptInput) return;
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        // Track for tool-call re-injection flow
        _lastUserPrompt = prompt;
        _toolCallDepth = 0;

        const uMsg = document.createElement('div');
        uMsg.className = 'msg user';
        uMsg.textContent = prompt;
        messagesDiv.appendChild(uMsg);

        promptInput.value = '';

        const bMsg = document.createElement('div');
        bMsg.className = 'msg bot';
        bMsg.textContent = 'Pensando...';
        messagesDiv.appendChild(bMsg);
        currentBotMsgDiv = bMsg;
        currentBotRawText = '';
        currentActiveModel = modelSelect ? modelSelect.value : '';

        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
        updateTokenCounter();

        vscode.postMessage({
            type: 'sendPrompt',
            prompt: prompt,
            model: modelSelect ? modelSelect.value : '',
            includeActiveFile: incFileCheckbox ? incFileCheckbox.checked : true,
            contextType: selectedContextType
        });

        selectedContextType = 'none';
        if (addCtxBtn) addCtxBtn.textContent = '+ Context';
        setGenerationState(true);
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'runLiveDemo':
                // Removed: no auto-demo execution
                break;
            case 'modelsList':
                if (message.currentUrl && cfgConnectorUrl) cfgConnectorUrl.value = message.currentUrl;
                if (message.models && Array.isArray(message.models)) {
                    renderModelFilterList(message.models);
                    updateModelDropdown(message.models);
                }
                break;
            case 'policyLoaded':
                if (message.policy && Array.isArray(message.policy.allowed_commands)) {
                    renderCommandPolicyList(message.policy.allowed_commands);
                }
                break;
            case 'graphifyResult':
                if (messagesDiv) {
                    const bDiv = document.createElement('div');
                    bDiv.className = 'msg bot';
                    bDiv.innerHTML = '🕸️ <b>Grafo de Memoria Graphify Generado:</b><br><pre style="font-size:10px; max-height: 150px; overflow-y: auto;">' + escapeHtml(message.result) + '</pre>';
                    messagesDiv.appendChild(bDiv);
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
                break;
            case 'streamToken':
                if (currentBotRawText === '' && currentBotMsgDiv) {
                    currentBotMsgDiv.textContent = '';
                }

                const isNearBottom = messagesDiv ? (messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 60) : false;

                currentBotRawText += message.token;
                updateBotMessageDisplay(currentBotMsgDiv, currentBotRawText, message.model || currentActiveModel, true);

                if (messagesDiv && isNearBottom) {
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
                updateTokenCounter();
                break;
            case 'streamComplete': {
                var rawFull = currentBotRawText;
                var parsed = parseToolCalls(rawFull);
                var hadTools = parsed.toolCalls.length > 0;
                var displayText = hadTools ? parsed.cleanText : rawFull;

                // Re-render without [TOOL_CALL] blocks
                if (currentBotMsgDiv) {
                    updateBotMessageDisplay(currentBotMsgDiv, displayText, message.model || currentActiveModel, false);
                }

                currentBotMsgDiv = null;
                currentBotRawText = '';
                updateTokenCounter();
                setGenerationState(false);

                // Dispatch any tool calls after UI settles
                if (hadTools) {
                    setTimeout(function() { dispatchToolCalls(parsed.toolCalls); }, 80);
                }
                break;
            }

            case 'memoryCompressed':
                if (messagesDiv) {
                    const bDiv = document.createElement('div');
                    bDiv.className = 'msg bot';
                    bDiv.textContent = '🧠 Memoria comprimida y guardada en base soberana.\n\n' + message.summary + '\n\n✨ Ventana de contexto reiniciada.';
                    messagesDiv.appendChild(bDiv);
                }
                updateTokenCounter();
                break;
            case 'settingsSaved':
            case 'actionResult':
                if (currentBotMsgDiv) {
                    currentBotMsgDiv.textContent = message.message || message.text;
                }
                setGenerationState(false);
                break;
            case 'contextCleared':
                // Clear all messages from DOM
                if (messagesDiv) messagesDiv.innerHTML = '';
                currentBotMsgDiv = null;
                currentBotRawText = '';
                currentActiveModel = '';
                if (tokenCounter) tokenCounter.textContent = 'Tokens: 0';
                setGenerationState(false);
                break;

            case 'attachedContext':
                // Ctrl+L: show code context block above textarea and pre-fill prompt
                if (messagesDiv) {
                    const ctxDiv = document.createElement('div');
                    ctxDiv.className = 'msg context-block';
                    ctxDiv.innerHTML = `<span style="font-size:9px; color:#38bdf8; font-weight:bold;">📎 Contexto adjunto (Ctrl+L)</span><br>` +
                        `<span style="opacity:0.7; font-size:9px;">${escapeHtml(message.relativePath)} · Línea ${message.startLine}–${message.endLine}</span><br>` +
                        `<pre style="margin:4px 0 0 0; font-size:10px; max-height:80px; overflow:auto;"><code>${escapeHtml(message.code)}</code></pre>`;
                    messagesDiv.appendChild(ctxDiv);
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
                if (promptInput && message.prefillPrompt) {
                    promptInput.value = message.prefillPrompt;
                    promptInput.focus();
                }
                break;

            case 'policyError':
                // Show policy rejection details as styled error message
                if (messagesDiv) {
                    const errDiv = document.createElement('div');
                    errDiv.className = 'msg error';
                    const payload = message.payload || {};
                    const detail = payload.error || payload.message || JSON.stringify(payload, null, 2);
                    errDiv.innerHTML = `<b>⛔ Bloqueado por Política de Giskard-Sys (HTTP 403)</b>\n` +
                        `<span style="opacity:0.8; font-size:9px;">El conector rechazó esta operación.</span>\n\n` +
                        escapeHtml(detail);
                    messagesDiv.appendChild(errDiv);
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
                if (currentBotMsgDiv) {
                    currentBotMsgDiv.remove();
                    currentBotMsgDiv = null;
                }
                setGenerationState(false);
                break;

            case 'offlineMode':
                // Show/hide the offline badge in status bar
                if (offlineBadge) {
                    if (message.active) {
                        offlineBadge.classList.add('visible');
                    } else {
                        offlineBadge.classList.remove('visible');
                    }
                }
                break;

            case 'connectionsLoaded':
                renderConnectionsList(message.connections);
                break;

            case 'connectionTested':
                if (connStatusDiv) {
                    if (message.ok) {
                        connStatusDiv.innerHTML = `<span style="color:#4ade80;font-weight:bold;">✓ Conectado (${message.ms}ms) — HTTP ${message.status}</span>`;
                    } else {
                        connStatusDiv.innerHTML = `<span style="color:#f87171;font-weight:bold;">❌ Falló (${message.ms}ms): ${escapeHtml(message.error)}</span>`;
                    }
                }
                break;

            case 'stateRefreshed':
                if (message.url && connUrlInp) connUrlInp.value = message.url;
                break;

            // ─── Tool Call Results ────────────────────────────────────────────
            case 'toolReadFileResult':
                if (message.error) {
                    appendSystemMessage('❌ Error leyendo <code>' + escapeHtml(message.path) + '</code>: ' + escapeHtml(message.error), '❌');
                } else {
                    appendSystemMessage(
                        '✅ Archivo leído: <code>' + escapeHtml(message.path) + '</code> (' + (message.content || '').length + ' chars)',
                        '📂'
                    );
                    // Re-inject file content into AI (max 1 level to avoid loops)
                    if (_toolCallDepth < 1 && _lastUserPrompt) {
                        _toolCallDepth++;
                        var followUp = 'El contenido del archivo `' + message.path + '` es:\n```\n' + message.content + '\n```\n\nAhora responde basándote en este contenido: ' + _lastUserPrompt;
                        if (promptInput) {
                            promptInput.value = followUp;
                            setTimeout(function() { send(); }, 300);
                        }
                    }
                }
                break;

            case 'toolWriteFileResult':
                if (message.error) {
                    appendSystemMessage('❌ Error aplicando diff a <code>' + escapeHtml(message.path) + '</code>: ' + escapeHtml(message.error), '❌');
                } else if (message.diffOpened) {
                    appendSystemMessage('📝 Diff abierto para <code>' + escapeHtml(message.path) + '</code> — Acepta o rechaza los cambios.', '📝');
                } else if (message.success) {
                    appendSystemMessage('✅ Cambios aplicados a <code>' + escapeHtml(message.path) + '</code>.', '✅');
                }
                break;

            case 'toolExecResult':
                if (message.error) {
                    appendSystemMessage('❌ Error ejecutando: ' + escapeHtml(message.error), '❌');
                } else {
                    appendSystemMessage(
                        '💻 Salida:<br><pre style="font-size:9px;margin:4px 0;max-height:120px;overflow:auto;">' + escapeHtml(message.output || '(sin salida)') + '</pre>',
                        '💻'
                    );
                }
                break;


            case 'streamError':
            case 'settingsError':
                if (currentBotMsgDiv) {
                    let errText = message.error || 'Error desconocido';
                    if (errText.indexOf('os error 2') !== -1 || errText.indexOf('No such file') !== -1) {
                        errText = `⚠️ La herramienta CLI '${currentActiveModel.replace('cli:', '')}' no está instalada.\n\n💡 Usa modelos del Enjambre Local (Ollama) o configura una API Remota en ⚙️ Ajustes.`;
                    } else {
                        errText = '❌ ' + errText;
                    }
                    currentBotMsgDiv.textContent = errText;
                }
                setGenerationState(false);
                break;
        }
    });
})();
