/**
 * Giskard Assistant VSCode Extension — Module: Main Chat Controller
 * Copyright (C) 2025-2026 Giskard Project
 */

(function() {
    const modelPickerBtn = document.getElementById('model-picker-btn');
    const modelPopoverCard = document.getElementById('model-popover-card');
    const popoverSearchInput = document.getElementById('popover-search-input');
    const popoverModelList = document.getElementById('popover-model-list');
    const popoverOtherToggle = document.getElementById('popover-other-toggle');
    const popoverOtherList = document.getElementById('popover-other-list');
    const activeModelName = document.getElementById('active-model-name');
    const accordionArrow = document.getElementById('accordion-arrow');

    let _enabledModelsCache = [];
    let _allModelsCache = [];

    if (modelPickerBtn && modelPopoverCard) {
        modelPickerBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            modelPopoverCard.classList.toggle('open');
            if (modelPopoverCard.classList.contains('open') && popoverSearchInput) {
                popoverSearchInput.focus();
            }
        });

        document.addEventListener('click', function(e) {
            if (modelPopoverCard && !modelPopoverCard.contains(e.target) && !modelPickerBtn.contains(e.target)) {
                modelPopoverCard.classList.remove('open');
            }
        });
    }

    if (popoverOtherToggle && popoverOtherList) {
        popoverOtherToggle.addEventListener('click', function() {
            popoverOtherList.classList.toggle('open');
            if (accordionArrow) {
                accordionArrow.textContent = popoverOtherList.classList.contains('open') ? '▾' : '›';
            }
        });
    }

    if (popoverSearchInput) {
        popoverSearchInput.addEventListener('input', function() {
            renderPopoverLists();
        });
    }

    function renderPopoverLists() {
        if (!popoverModelList) return;
        const q = (popoverSearchInput ? popoverSearchInput.value : '').toLowerCase().trim();

        const filteredEnabled = _enabledModelsCache.filter(m => m.toLowerCase().includes(q));
        if (filteredEnabled.length === 0) {
            popoverModelList.innerHTML = '<div style="font-size:10px;color:#9ca3af;padding:6px;">Sin modelos activos. Actívalos en el Tree 👈</div>';
        } else {
            popoverModelList.innerHTML = filteredEnabled.map(m => {
                const isSel = m === currentActiveModel;
                const selClass = isSel ? 'selected' : '';
                const checkMark = isSel ? '✓ ' : '';
                return `<div class="popover-model-item ${selClass}" data-model="${escapeHtml(m)}">
                    <span>${checkMark}${escapeHtml(m)}</span>
                    <span class="popover-model-badge">Activo</span>
                </div>`;
            }).join('');
        }

        if (popoverOtherList) {
            const otherModels = _allModelsCache.filter(m => !_enabledModelsCache.includes(m) && m.toLowerCase().includes(q));
            if (otherModels.length === 0) {
                popoverOtherList.innerHTML = '<div style="font-size:10px;color:#9ca3af;padding:4px 8px;">No hay más modelos</div>';
            } else {
                popoverOtherList.innerHTML = otherModels.map(m => {
                    const isSel = m === currentActiveModel;
                    const selClass = isSel ? 'selected' : '';
                    return `<div class="popover-model-item ${selClass}" data-model="${escapeHtml(m)}">
                        <span>${escapeHtml(m)}</span>
                    </div>`;
                }).join('');
            }
        }

        const items = document.querySelectorAll('.popover-model-item');
        items.forEach(el => {
            el.addEventListener('click', function() {
                const selected = el.getAttribute('data-model');
                if (selected) {
                    currentActiveModel = selected;
                    if (activeModelName) activeModelName.textContent = '🤖 ' + selected;
                    vscode.postMessage({ type: 'modelChanged', model: selected });
                    if (modelPopoverCard) modelPopoverCard.classList.remove('open');
                    renderPopoverLists();
                }
            });
        });
    }
    const addCtxBtn = document.getElementById('add-ctx-btn');
    const compressBtn = document.getElementById('compress-btn');
    const tokenCounter = document.getElementById('token-counter');
    const ctxMenu = document.getElementById('context-menu');

    const openSettingsBtn = document.getElementById('open-settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const offlineBadge = document.getElementById('offline-badge');
    const cfgConnectorUrl = document.getElementById('cfg-connector-url');
    const clearCtxBtn = document.getElementById('clear-ctx-btn');

    const tabBtnLocal = document.getElementById('tab-btn-local');
    const tabBtnRemote = document.getElementById('tab-btn-remote');
    const tabContentLocal = document.getElementById('tab-content-local');
    const tabContentRemote = document.getElementById('tab-content-remote');
    const tabBtnPalette = document.getElementById('tab-btn-palette');
    const tabContentPalette = document.getElementById('tab-content-palette');
    const tabBtnMcp = document.getElementById('tab-btn-mcp');
    const tabContentMcp = document.getElementById('tab-content-mcp');

    let currentBotMsgDiv = null;
    let currentBotRawText = '';
    let currentActiveModel = '';
    let selectedContextType = 'none';
    let _readFilesBatch = [];
    let _readFileTimer = null;

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

    function getModelMaxContext(modelName) {
        const m = (modelName || '').toLowerCase().trim();
        return m.startsWith('local:') ? 32768 : 128000;
    }

    function updateTokenCounter() {
        if (!messagesDiv || !tokenCounter) return;
        let totalChars = 0;
        messagesDiv.querySelectorAll('.msg').forEach(m => totalChars += m.textContent.length);
        const totalEstTokens = Math.ceil(totalChars / 4);

        const currentModel = modelSelect ? modelSelect.value : '';
        const maxTokens = getModelMaxContext(currentModel);

        tokenCounter.textContent = '🔢 Tokens: ' + totalEstTokens.toLocaleString() + ' / ' + maxTokens.toLocaleString();
        tokenCounter.style.color = totalEstTokens > (maxTokens * 0.8) ? '#ff6b6b' : 'inherit';
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', updateTokenCounter);
    }

    const tabBtnExclusions = document.getElementById('tab-btn-exclusions');
    const tabContentExclusions = document.getElementById('tab-content-exclusions');

    function switchTab(activeBtn, activeContent) {
        [tabBtnLocal, tabBtnRemote, tabBtnMcp, tabBtnExclusions, tabBtnPalette].forEach(b => { if (b) b.classList.remove('active'); });
        [tabContentLocal, tabContentRemote, tabContentMcp, tabContentExclusions, tabContentPalette].forEach(c => { if (c) c.classList.remove('active'); });
        if (activeBtn) activeBtn.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }

    if (tabBtnLocal) tabBtnLocal.addEventListener('click', () => switchTab(tabBtnLocal, tabContentLocal));
    if (tabBtnRemote) tabBtnRemote.addEventListener('click', () => switchTab(tabBtnRemote, tabContentRemote));
    if (tabBtnMcp) tabBtnMcp.addEventListener('click', () => switchTab(tabBtnMcp, tabContentMcp));
    if (tabBtnExclusions) tabBtnExclusions.addEventListener('click', () => { switchTab(tabBtnExclusions, tabContentExclusions); vscode.postMessage({ type: 'getExclusionPatterns' }); });
    if (tabBtnPalette) tabBtnPalette.addEventListener('click', () => switchTab(tabBtnPalette, tabContentPalette));

    if (promptInput) promptInput.value = '';

    if (clearCtxBtn) {
        clearCtxBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearContext' });
        });
    }

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'flex';
            vscode.postMessage({ type: 'loadConnections' });
            vscode.postMessage({ type: 'loadMcpServers' });
            vscode.postMessage({ type: 'fetchModels' });
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'none'; 
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && settingsModal.style.display === 'flex') {
                settingsModal.style.display = 'none';
            }
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

    const ctxGraphify = document.getElementById('ctx-graphify');
    if (ctxGraphify) {
        ctxGraphify.addEventListener('click', () => {
            vscode.postMessage({ type: 'runGraphify' });
            if (ctxMenu) ctxMenu.style.display = 'none';
        });
    }

    const ctxSkills = document.getElementById('ctx-skills');
    if (ctxSkills) {
        ctxSkills.addEventListener('click', () => {
            vscode.postMessage({ type: 'fetchSkills' });
            if (ctxMenu) ctxMenu.style.display = 'none';
        });
    }
    
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
            includeActiveFile: incFileCheckbox ? incFileCheckbox.checked : false,
            contextType: selectedContextType
        });

        selectedContextType = 'none';
        if (addCtxBtn) addCtxBtn.textContent = '+ Context';
        setGenerationState(true);
    }

    // ── Main Webview Message Router ─────────────────────────────────────
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'modelsList':
                if (message.currentUrl && cfgConnectorUrl) cfgConnectorUrl.value = message.currentUrl;
                renderModelFilterList(message);
                updateModelDropdown(message);
                break;
            case 'mcpServersLoaded':
                if (message.servers && Array.isArray(message.servers)) {
                    renderMcpServersList(message.servers);
                }
                break;
            case 'mcpTested':
                const mcpStatusDiv = document.getElementById('mcp-status');
                if (mcpStatusDiv) {
                    if (message.ok) {
                        mcpStatusDiv.innerHTML = `<span style="color:#34d399;font-weight:bold;">✓ Conexión MCP Exitosa (${message.ms}ms)</span>`;
                    } else {
                        mcpStatusDiv.innerHTML = `<span style="color:#f87171;font-weight:bold;">❌ Error MCP: ${escapeHtml(message.error || 'Sin respuesta')}</span>`;
                    }
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

                if (currentBotMsgDiv) {
                    updateBotMessageDisplay(currentBotMsgDiv, displayText, message.model || currentActiveModel, false);
                }

                currentBotMsgDiv = null;
                currentBotRawText = '';
                updateTokenCounter();
                setGenerationState(false);

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
                if (messagesDiv) messagesDiv.innerHTML = '';
                currentBotMsgDiv = null;
                currentBotRawText = '';
                currentActiveModel = '';
                if (tokenCounter) tokenCounter.textContent = 'Tokens: 0';
                setGenerationState(false);
                break;

            case 'attachedContext':
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
                const connStatusDiv = document.getElementById('connection-status');
                if (connStatusDiv) {
                    if (message.ok) {
                        connStatusDiv.innerHTML = `<span style="color:#4ade80;font-weight:bold;">✓ Conectado (${message.ms}ms) — HTTP ${message.status}</span>`;
                    } else {
                        connStatusDiv.innerHTML = `<span style="color:#f87171;font-weight:bold;">❌ Falló (${message.ms}ms): ${escapeHtml(message.error)}</span>`;
                    }
                }
                break;

            case 'openSettings':
                if (settingsModal) {
                    settingsModal.style.display = 'flex';
                }
                break;

            case 'clearMessages':
                if (messagesDiv) {
                    messagesDiv.innerHTML = '';
                    currentBotMsgDiv = null;
                    currentBotRawText = '';
                }
                break;

            case 'setEnabledModels':
                if (Array.isArray(message.enabledModels)) {
                    _enabledModelsCache = message.enabledModels;
                    if (_enabledModelsCache.length > 0 && !currentActiveModel) {
                        currentActiveModel = _enabledModelsCache[0];
                        if (activeModelName) activeModelName.textContent = '🤖 ' + currentActiveModel;
                    }
                    renderPopoverLists();
                }
                break;

            case 'modelsLoaded':
                if (Array.isArray(message.models)) {
                    _allModelsCache = message.models;
                    renderPopoverLists();
                }
                break;

            case 'setSelectedModel':
                if (message.model) {
                    currentActiveModel = message.model;
                    if (chatModelSelect) {
                        chatModelSelect.value = message.model;
                    }
                }
                break;

            case 'stateRefreshed':
                const connUrlInp = document.getElementById('conn-url');
                if (message.url && connUrlInp) connUrlInp.value = message.url;
                break;

            case 'toolReadFileResult':
                if (message.error) {
                    appendActivityPill('❌ Error reading <code>' + escapeHtml(message.path) + '</code>: ' + escapeHtml(message.error), '❌');
                } else {
                    vscode.postMessage({ type: 'openFile', relativePath: message.path });
                    appendActivityPill(
                        'Read 1 file ➔ <code>' + escapeHtml(message.path) + '</code> (' + (message.content || '').length + ' chars)',
                        '🔍'
                    );
                    _readFilesBatch.push(message);
                    if (_readFileTimer) clearTimeout(_readFileTimer);
                    _readFileTimer = setTimeout(function() {
                        if (_readFilesBatch.length > 0 && _lastUserPrompt) {
                            var combinedContent = _readFilesBatch.map(function(item) {
                                var content = item.content || '';
                                if (content.length > 6000) {
                                    content = content.substring(0, 6000) + '\n... [Contenido truncado a 6000 caracteres para seguridad de contexto]';
                                }
                                return 'File `' + item.path + '`:\n```\n' + content + '\n```';
                            }).join('\n\n');
                            var followUp = '[Contenido de los archivos leídos del workspace]:\n\n' + combinedContent + '\n\nCon base en la información de estos archivos del proyecto, responde a la solicitud del usuario:\n' + _lastUserPrompt;
                            _readFilesBatch = [];
                            if (promptInput) {
                                promptInput.value = followUp;
                                setTimeout(function() { send(); }, 300);
                            }
                        }
                    }, 600);
                }
                break;

            case 'toolWriteFileResult':
                if (message.error) {
                    appendActivityPill('❌ Error aplicando diff a <code>' + escapeHtml(message.path) + '</code>: ' + escapeHtml(message.error), '❌');
                } else if (message.diffOpened) {
                    appendActivityPill('Abierto cambio in-place para <code>' + escapeHtml(message.path) + '</code> — Acepta o rechaza en el editor.', '📝');
                } else if (message.success) {
                    appendActivityPill('Cambios aplicados a <code>' + escapeHtml(message.path) + '</code>', '✅');
                }
                break;

            case 'toolExecResult':
                if (message.error) {
                    appendActivityPill('❌ Error ejecutando: ' + escapeHtml(message.error), '❌');
                } else {
                    appendActivityPill(
                        'Ejecutó comando en terminal:<br><pre style="font-size:9px;margin:4px 0;max-height:120px;overflow:auto;">' + escapeHtml(message.output || '(sin salida)') + '</pre>',
                        '⚡'
                    );
                }
                break;

            case 'streamError':
            case 'settingsError':
                if (currentBotMsgDiv) {
                    let errText = message.error || 'Unknown error';
                    if (errText.indexOf('os error 2') !== -1 || errText.indexOf('No such file') !== -1) {
                        errText = `⚠️ CLI tool '${currentActiveModel.replace('cli:', '')}' is not installed.\n\n💡 Use Local Swarm models (Ollama) or configure a Remote API Key in Settings ⚙️.`;
                    }
                    updateBotMessageDisplay(
                        currentBotMsgDiv,
                        `⚠️ **Connection Error**:\n\n${errText}`,
                        currentActiveModel,
                        false
                    );
                }
                setGenerationState(false);
                break;
        }
    });

    // Send ready signal to host on startup
    vscode.postMessage({ type: 'webviewReady' });
})();
