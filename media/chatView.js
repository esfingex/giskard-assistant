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
    const mountWorkspaceBtn = document.getElementById('mount-workspace-btn');
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

    function formatMarkdown(text) {
        if (!text) return '';
        let htmlText = text;
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
            try {
                htmlText = marked.parse(text);
            } catch (e) {
                console.error('Markdown error:', e);
                htmlText = escapeHtml(text);
            }
        } else {
            htmlText = escapeHtml(text);
        }
        return htmlText;
    }

    function attachCodeBlockActions(container) {
        if (!container) return;
        const pres = container.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.querySelector('.code-toolbar')) return;

            const codeEl = pre.querySelector('code');
            const codeText = codeEl ? codeEl.innerText : pre.innerText;

            const toolbar = document.createElement('div');
            toolbar.className = 'code-toolbar';
            toolbar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 4px 8px; border-bottom: 1px solid var(--vscode-input-border); border-top-left-radius: 6px; border-top-right-radius: 6px; font-size: 10px; opacity: 0.9;';

            const langLabel = document.createElement('span');
            langLabel.style.color = '#38bdf8';
            langLabel.style.fontWeight = 'bold';
            langLabel.textContent = '💻 Código / Shell';

            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '6px';

            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋 Copiar';
            copyBtn.style.cssText = 'background: transparent; border: 1px solid var(--vscode-input-border); padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer;';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(codeText);
                copyBtn.textContent = '✓ Copiado';
                setTimeout(() => { copyBtn.textContent = '📋 Copiar'; }, 2000);
            };

            const runBtn = document.createElement('button');
            runBtn.textContent = '⚡ Ejecutar en Shell';
            runBtn.style.cssText = 'background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold;';
            runBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'executeShellCommand', command: codeText.trim() });
            };

            const diffBtn = document.createElement('button');
            diffBtn.textContent = '📝 Ver Diff en VSCode';
            diffBtn.style.cssText = 'background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer; font-weight: bold;';
            diffBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'openDiff', code: codeText });
            };

            btnGroup.appendChild(copyBtn);
            btnGroup.appendChild(runBtn);
            btnGroup.appendChild(diffBtn);
            toolbar.appendChild(langLabel);
            toolbar.appendChild(btnGroup);

            pre.parentNode.insertBefore(toolbar, pre);
            pre.style.marginTop = '0';
            pre.style.borderTopLeftRadius = '0';
            pre.style.borderTopRightRadius = '0';
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

        // Grupo 1: Enjambre Local (Ollama)
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

        // Grupo 2: Orquestadores & CLIs
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
                if (m.includes('distill') || m.includes('kimi')) label += ' (Kimi+Opus 🧠)';
                else if (m.includes('coder') || m.includes('code')) label += ' (Coder ⚡)';
                else if (m.includes('phi')) label += ' (Fast ⚡)';
                else if (m.includes('aya')) label += ' (Traductor 🌐)';
                html += '<option value="' + escapeHtml(m) + '">' + escapeHtml(label) + '</option>';
            });
            html += '</optgroup>';
        }

        if (showGemini || showClaude) {
            html += '<optgroup label="☁️ Orquestadores & CLIs">';
            if (showGemini) html += '<option value="cli:gemini">Gemini CLI (Google AI)</option>';
            if (showClaude) html += '<option value="cli:claude">Claude CLI (Anthropic)</option>';
            html += '</optgroup>';
        }

        if (!html) {
            html = '<option value="qwimi-k2.6:distill">qwimi-k2.6:distill (Default)</option>';
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
    }

    function updateBotMessageDisplay(div, fullText, modelName, isStreaming) {
        if (!div) return;
        currentBotRawText = fullText;
        let clean = fullText.replace(/&lt;think&gt;/g, '<think>').replace(/&lt;\/think&gt;/g, '</think>');
        
        const activeModel = modelName || (modelSelect ? modelSelect.value : 'model');
        const modelTagHtml = '<div class="model-tag">🏷️ ' + escapeHtml(activeModel) + '</div>';

        // Detectar traza de pensamiento
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
        tokenCounter.textContent = '🔢 Tokens: ' + totalEstTokens.toLocaleString() + ' / 32,768';
        tokenCounter.style.color = totalEstTokens > 24000 ? '#ff6b6b' : 'inherit';
    }

    // Manejo de Pestañas (Tabs) en Modal Ajustes
    if (tabBtnLocal && tabBtnRemote) {
        tabBtnLocal.addEventListener('click', () => {
            tabBtnLocal.classList.add('active');
            tabBtnRemote.classList.remove('active');
            if (tabContentLocal) tabContentLocal.classList.add('active');
            if (tabContentRemote) tabContentRemote.classList.remove('active');
        });
        tabBtnRemote.addEventListener('click', () => {
            tabBtnRemote.classList.add('active');
            tabBtnLocal.classList.remove('active');
            if (tabContentRemote) tabContentRemote.classList.add('active');
            if (tabContentLocal) tabContentLocal.classList.remove('active');
        });
    }

    if (mountWorkspaceBtn) {
        mountWorkspaceBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'mountWorkspace' });
        });
    }

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'flex';
            vscode.postMessage({ type: 'fetchPolicy' });
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
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
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
            case 'streamToken':
                if (currentBotRawText === '' && currentBotMsgDiv) {
                    currentBotMsgDiv.textContent = '';
                }

                // Scroll inteligente
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
                break;
            case 'streamError':
            case 'settingsError':
                if (currentBotMsgDiv) {
                    let errText = message.error || 'Error desconocido';
                    if (errText.indexOf('os error 2') !== -1 || errText.indexOf('No such file') !== -1) {
                        errText = `⚠️ La herramienta CLI '${currentActiveModel.replace('cli:', '')}' no está instalada en el PATH de tu sistema.\n\n💡 Usa los modelos del Enjambre Local (Ollama como qwimi-k2.6:distill) o configura una API Remota en ⚙️ Ajustes.`;
                    } else {
                        errText = '❌ Error: ' + errText;
                    }
                    currentBotMsgDiv.textContent = errText;
                }
                break;
        }
    });
})();
