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

    function attachCodeBlockActions(container) {
        if (!container) return;
        const pres = container.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('code-box')) return;

            const codeEl = pre.querySelector('code');
            const codeText = codeEl ? codeEl.innerText : pre.innerText;

            if (!codeText || !codeText.trim()) {
                pre.style.display = 'none';
                return;
            }
            pre.style.display = 'block';

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
            langLabel.textContent = '▶ 💻 Código / Shell (Ocultar/Mostrar)';

            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '6px';

            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋 Copiar';
            copyBtn.style.cssText = 'background: transparent; border: 1px solid var(--vscode-input-border); padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer;';
            copyBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(codeText);
                copyBtn.textContent = '✓ Copiado';
                setTimeout(() => { copyBtn.textContent = '📋 Copiar'; }, 2000);
            };

            const runBtn = document.createElement('button');
            runBtn.textContent = '⚡ Ejecutar en Shell';
            runBtn.style.cssText = 'background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold;';
            runBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'executeShellCommand', command: codeText.trim() });
            };

            const diffBtn = document.createElement('button');
            diffBtn.textContent = '📝 Ver Diff en VSCode';
            diffBtn.style.cssText = 'background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold;';
            diffBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'openDiff', code: codeText });
            };

            btnGroup.appendChild(copyBtn);
            btnGroup.appendChild(runBtn);
            btnGroup.appendChild(diffBtn);
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
            vscode.postMessage({ type: 'fetchPolicy' });
            vscode.postMessage({ type: 'fetchModels' });
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'none'; 
        });
    }

    if (saveCfgBtn) {
        saveCfgBtn.addEventListener('click', () => {
            const connectorUrl = cfgConnectorUrl ? cfgConnectorUrl.value.trim() : '';
            const provider = document.getElementById('cfg-provider').value;
            const baseUrl = document.getElementById('cfg-base-url').value.trim();
            const apiKey = document.getElementById('cfg-api-key').value.trim();

            const checkedModels = [];
            document.querySelectorAll('.model-filter-cb').forEach(cb => {
                if (cb.checked) checkedModels.push(cb.value);
            });
            setEnabledModels(checkedModels);
            updateModelDropdown(lastDetectedModels);

            if (connectorUrl) {
                vscode.postMessage({ type: 'saveConnectorUrl', url: connectorUrl });
            }

            vscode.postMessage({
                type: 'saveSettings',
                provider: provider,
                baseUrl: baseUrl,
                apiKey: apiKey
            });
            if (settingsModal) settingsModal.style.display = 'none';
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
            case 'streamComplete':
                if (currentBotMsgDiv) {
                    updateBotMessageDisplay(currentBotMsgDiv, currentBotRawText, message.model || currentActiveModel, false);
                }
                currentBotMsgDiv = null;
                currentBotRawText = '';
                updateTokenCounter();
                setGenerationState(false);
                break;
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

            case 'stateRefreshed':
                if (message.url && cfgConnectorUrl) cfgConnectorUrl.value = message.url;
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
