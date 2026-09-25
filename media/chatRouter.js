/**
 * Giskard Assistant VSCode Extension — Module: Main Webview Message Router
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatView.js (v4.3.0 wave 7b). Scope global compartido entre
 * scripts del webview (mismo patrón que chatUtils.js). Orden de carga importa:
 * chatUtils -> chatState -> chatTabs -> chatMessages -> connectionsView ->
 * mcpView -> chatRouter -> chatView.
 */

// ── Main Webview Message Router ─────────────────────────────────────
window.addEventListener('message', (event) => {
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
        case 'streamStatus': {
            const targetTabId = message.tabId || _activeTabId;
            const _phase = message.phase;
            const _prov = escapeHtml(message.provider || 'servidor');
            const _local = message.isLocal;
            const _icon = _local ? '🔌' : '🌐';
            const _icon2 = _local ? '⚙️' : '📡';
            const statusHtml =
                _phase === 'connecting'
                    ? `<span style="opacity:0.65;font-size:11px;font-style:italic;">${_icon} Conectando a <b>${_prov}</b>…</span>`
                    : `<span style="opacity:0.65;font-size:11px;font-style:italic;">${_icon2} Conexión establecida — Generando respuesta…</span>`;

            if (targetTabId === _activeTabId) {
                const targetDiv = getActiveBotMsgDiv(targetTabId);
                if (targetDiv) targetDiv.innerHTML = statusHtml;
            } else {
                const targetTab = _subTabs.find((t) => t.id === targetTabId);
                if (targetTab) {
                    const tempContainer = document.createElement('div');
                    tempContainer.innerHTML = targetTab.messagesHtml || '';
                    let botDiv = tempContainer.querySelector('.msg.bot[data-streaming="true"]');
                    if (!botDiv) {
                        const botMsgs = tempContainer.querySelectorAll('.msg.bot');
                        if (botMsgs.length > 0) botDiv = botMsgs[botMsgs.length - 1];
                    }
                    if (botDiv) {
                        botDiv.innerHTML = statusHtml;
                        targetTab.messagesHtml = tempContainer.innerHTML;
                    }
                }
            }
            break;
        }

        case 'streamToken': {
            const targetTabId = message.tabId || _activeTabId;
            const targetTab = _subTabs.find((t) => t.id === targetTabId);
            if (targetTab) {
                targetTab.rawText = (targetTab.rawText || '') + message.token;
            }

            if (targetTabId === _activeTabId) {
                const targetTokenDiv = getActiveBotMsgDiv(targetTabId);
                const isNearBottom = messagesDiv
                    ? messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 60
                    : false;

                currentBotRawText = targetTab ? targetTab.rawText : currentBotRawText;
                if (targetTokenDiv) {
                    updateBotMessageDisplay(
                        targetTokenDiv,
                        currentBotRawText,
                        message.model || currentActiveModel,
                        true
                    );
                }

                if (messagesDiv && isNearBottom) {
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }
                updateTokenCounter();
            } else if (targetTab) {
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = targetTab.messagesHtml || '';
                let botDiv = tempContainer.querySelector('.msg.bot[data-streaming="true"]');
                if (!botDiv) {
                    const botMsgs = tempContainer.querySelectorAll('.msg.bot');
                    if (botMsgs.length > 0) botDiv = botMsgs[botMsgs.length - 1];
                }
                if (botDiv) {
                    updateBotMessageDisplay(
                        botDiv,
                        targetTab.rawText,
                        message.model || targetTab.model,
                        true
                    );
                    targetTab.messagesHtml = tempContainer.innerHTML;
                }
            }
            break;
        }

        case 'streamComplete': {
            const targetTabId = message.tabId || _activeTabId;
            const targetTab = _subTabs.find((t) => t.id === targetTabId);
            if (targetTab) targetTab.isGenerating = false;

            var rawFull = targetTab ? targetTab.rawText || '' : currentBotRawText;
            var parsed = parseToolCalls(rawFull);
            var hadTools = parsed.toolCalls.length > 0;
            var pendingPlan = extractPlan(rawFull);
            var displayText = hadTools ? parsed.cleanText : rawFull;
            if (pendingPlan) {
                displayText =
                    displayText.replace(/\[PLAN\][\s\S]*?\[\/END_PLAN\]/g, '').trim() ||
                    '📋 La IA propuso un plan:';
            }

            if (targetTabId === _activeTabId) {
                const targetCompDiv = getActiveBotMsgDiv(targetTabId);
                if (targetCompDiv) {
                    targetCompDiv.removeAttribute('data-streaming');
                    updateBotMessageDisplay(
                        targetCompDiv,
                        displayText,
                        message.model || currentActiveModel,
                        false
                    );
                }
                currentBotMsgDiv = null;
                currentBotRawText = '';
                updateTokenCounter();
                setGenerationState(false);
            } else if (targetTab) {
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = targetTab.messagesHtml || '';
                let botDiv = tempContainer.querySelector('.msg.bot[data-streaming="true"]');
                if (!botDiv) {
                    const botMsgs = tempContainer.querySelectorAll('.msg.bot');
                    if (botMsgs.length > 0) botDiv = botMsgs[botMsgs.length - 1];
                }
                if (botDiv) {
                    botDiv.removeAttribute('data-streaming');
                    updateBotMessageDisplay(botDiv, displayText, message.model || targetTab.model, false);
                    targetTab.messagesHtml = tempContainer.innerHTML;
                }
            }

            // Fase 3b: model proposed a plan — show approve/discard UI, do NOT execute tools yet
            if (pendingPlan && targetTabId === _activeTabId) {
                showPlanCard(pendingPlan, message.model || currentActiveModel, targetTabId);
            } else if (hadTools && targetTabId === _activeTabId) {
                setTimeout(function () {
                    dispatchToolCalls(parsed.toolCalls);
                }, 80);
            }
            persistChatHistory();
            break;
        }

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

        case 'injectCodeSnippet': {
            // Fix wave 7a: el host envía {contextBlock:{relativePath,startLine,endLine,code,lang}} (webviewContract)
            const cb = message.contextBlock || {};
            if (messagesDiv && cb.code) {
                const ctxDiv = document.createElement('div');
                ctxDiv.className = 'msg context-block';
                ctxDiv.innerHTML =
                    `<span style="font-size:9px; color:#38bdf8; font-weight:bold;">📎 Contexto adjunto (Ctrl+L)</span><br>` +
                    `<span style="opacity:0.7; font-size:9px;">${escapeHtml(cb.relativePath || '')} · Línea ${cb.startLine || '?'}–${cb.endLine || '?'}${cb.lang ? ' · ' + escapeHtml(cb.lang) : ''}</span><br>` +
                    `<pre style="margin:4px 0 0 0; font-size:10px; max-height:80px; overflow:auto;"><code>${escapeHtml(cb.code)}</code></pre>`;
                messagesDiv.appendChild(ctxDiv);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
            break;
        }

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

        case 'selectTheme':
            const themePreset = (message.theme || message.preset || '').toLowerCase();
            if (themePreset.includes('white') || themePreset.includes('light'))
                setPaletteValues('#ffffff', '#ffffff', '#e2e8f0', '#334155', '#1e293b', '#0f172a');
            else if (themePreset.includes('cyan') || themePreset.includes('neon'))
                setPaletteValues('#f8fafc', '#ffffff', '#38bdf8', '#0284c7', '#0f172a', '#0284c7');
            else if (themePreset.includes('emerald') || themePreset.includes('midnight'))
                setPaletteValues('#ecfdf5', '#ffffff', '#34d399', '#059669', '#064e3b', '#022c22');
            else setPaletteValues('#faf5ff', '#ffffff', '#c084fc', '#9333ea', '#3b0764', '#1e1b4b');
            break;

        case 'clearMessages':
            if (messagesDiv) {
                messagesDiv.innerHTML = '';
                currentBotMsgDiv = null;
                currentBotRawText = '';
            }
            persistChatHistory();
            break;

        case 'chatHistoryRestored':
            restoreChatHistory(message.tabs);
            break;

        case 'setEnabledModels':
            console.log('[Giskard Webview] setEnabledModels payload:', message.enabledModels);
            if (Array.isArray(message.enabledModels)) {
                _enabledModelsCache = message.enabledModels.map(cleanModelName).filter(Boolean);
                if (_enabledModelsCache.length > 0 && !currentActiveModel) {
                    currentActiveModel = _enabledModelsCache[0];
                }
                if (activeModelName) {
                    activeModelName.textContent = '🤖 ' + (currentActiveModel || 'Modelo');
                }
                renderPopoverLists();
            }
            break;

        case 'modelsList':
            console.log('[Giskard Webview] modelsList payload:', message);
            if (Array.isArray(message.enabledModels)) {
                _enabledModelsCache = message.enabledModels.map(cleanModelName).filter(Boolean);
            }
            let list = [];
            if (Array.isArray(message.models)) list = list.concat(message.models);
            if (Array.isArray(message.localModels)) list = list.concat(message.localModels);
            if (Array.isArray(message.groups)) {
                message.groups.forEach((g) => {
                    if (g && Array.isArray(g.models)) {
                        list = list.concat(g.models);
                    }
                });
            }
            _allModelsCache = Array.from(new Set(list.map(cleanModelName).filter(Boolean)));

            if (!currentActiveModel) {
                currentActiveModel = _enabledModelsCache[0] || _allModelsCache[0] || '';
            }

            const activeCurTab = _subTabs.find((t) => t.id === _activeTabId);
            if (activeCurTab) {
                if (!activeCurTab.model && currentActiveModel) {
                    activeCurTab.model = currentActiveModel;
                }
                if (activeModelName) {
                    activeModelName.textContent =
                        '🤖 ' + (activeCurTab.model || currentActiveModel || 'Modelo');
                }
            }

            if (message.connectionMode && offlineBadge) {
                if (message.connectionMode === 'giskardSysActive') {
                    offlineBadge.style.display = 'inline-block';
                    offlineBadge.textContent = '🛡️ Giskard-Sys';
                    offlineBadge.title = 'Conector Giskard-Sys activo con Sandbox Jail';
                } else {
                    offlineBadge.style.display = 'inline-block';
                    offlineBadge.textContent = '⚡ Ollama Directo';
                    offlineBadge.title = 'Modo Ollama local directo (puerto 11434)';
                }
            }

            renderSubTabs();
            renderPopoverLists();
            break;

        case 'toolReadFileResult':
            if (message.error) {
                appendActivityPill(
                    '❌ Error reading <code>' +
                        escapeHtml(message.path) +
                        '</code>: ' +
                        escapeHtml(message.error),
                    '❌'
                );
            } else {
                vscode.postMessage({ type: 'openFile', relativePath: message.path });
                appendActivityPill(
                    'Read 1 file ➔ <code>' +
                        escapeHtml(message.path) +
                        '</code> (' +
                        (message.content || '').length +
                        ' chars)',
                    '🔍'
                );
                _readFilesBatch.push(message);
                if (_readFileTimer) clearTimeout(_readFileTimer);
                _readFileTimer = setTimeout(flushToolBatch, 600);
            }
            break;

        case 'toolListDirResult':
            if (message.error) {
                appendActivityPill(
                    '❌ Error listando <code>' +
                        escapeHtml(message.path) +
                        '</code>: ' +
                        escapeHtml(message.error),
                    '❌'
                );
            } else {
                appendActivityPill(
                    '📂 <code>' +
                        escapeHtml(message.path) +
                        '</code> — ' +
                        (message.listing ? message.listing.split('\n').length : 0) +
                        ' entradas',
                    '📂'
                );
                _readFilesBatch.push({
                    path: message.path + ' (listado)',
                    content: message.listing || '(vacío)'
                });
                if (_readFileTimer) clearTimeout(_readFileTimer);
                _readFileTimer = setTimeout(function () {
                    flushToolBatch();
                }, 600);
            }
            break;

        case 'toolSearchResult':
            if (message.error) {
                appendActivityPill('❌ Error buscando: ' + escapeHtml(message.error), '❌');
            } else {
                var sFiles = Array.isArray(message.files) ? message.files : [];
                appendActivityPill(
                    '🔍 «' + escapeHtml(message.query) + '» → ' + sFiles.length + ' resultados',
                    '🔍'
                );
                _readFilesBatch.push({
                    path: 'search:' + message.query,
                    content: sFiles.length ? sFiles.join('\n') : '(sin resultados)'
                });
                if (_readFileTimer) clearTimeout(_readFileTimer);
                _readFileTimer = setTimeout(function () {
                    flushToolBatch();
                }, 600);
            }
            break;

        case 'toolGlobResult':
            if (message.error) {
                appendActivityPill('❌ Error en glob: ' + escapeHtml(message.error), '❌');
            } else {
                var gFiles = Array.isArray(message.files) ? message.files : [];
                appendActivityPill(
                    '🗂️ ' + escapeHtml(message.pattern || '**/*') + ' → ' + gFiles.length + ' archivos',
                    '🗂️'
                );
                _readFilesBatch.push({
                    path: 'glob:' + (message.pattern || '**/*'),
                    content: gFiles.length ? gFiles.join('\n') : '(sin resultados)'
                });
                if (_readFileTimer) clearTimeout(_readFileTimer);
                _readFileTimer = setTimeout(function () {
                    flushToolBatch();
                }, 600);
            }
            break;

        case 'toolWriteFileResult':
            if (message.error) {
                appendActivityPill(
                    '❌ Error aplicando diff a <code>' +
                        escapeHtml(message.path) +
                        '</code>: ' +
                        escapeHtml(message.error),
                    '❌'
                );
            } else if (message.diffOpened) {
                appendActivityPill(
                    'Abierto cambio in-place para <code>' +
                        escapeHtml(message.path) +
                        '</code> — Acepta o rechaza en el editor.',
                    '📝'
                );
            } else if (message.success) {
                appendActivityPill('Cambios aplicados a <code>' + escapeHtml(message.path) + '</code>', '✅');
            }
            break;

        case 'toolExecResult':
            if (message.error) {
                appendActivityPill('❌ Error ejecutando: ' + escapeHtml(message.error), '❌');
            } else {
                appendActivityPill(
                    'Ejecutó comando en terminal:<br><pre style="font-size:9px;margin:4px 0;max-height:120px;overflow:auto;">' +
                        escapeHtml(message.output || '(sin salida)') +
                        '</pre>',
                    '⚡'
                );
            }
            break;

        case 'streamError':
        case 'settingsError': {
            const targetTabId = message.tabId || _activeTabId;
            const targetTab = _subTabs.find((t) => t.id === targetTabId);
            if (targetTab) targetTab.isGenerating = false;

            let errText = message.error || 'Unknown error';
            if (errText.indexOf('os error 2') !== -1 || errText.indexOf('No such file') !== -1) {
                errText = `⚠️ CLI tool '${(message.model || currentActiveModel).replace('cli:', '')}' is not installed.\n\n💡 Use Local Swarm models (Ollama) or configure a Remote API Key in Settings ⚙️.`;
            }
            const formattedErr = errText.startsWith('⚠️')
                ? errText
                : `⚠️ **Connection Error**:\n\n${errText}`;

            if (targetTabId === _activeTabId) {
                const targetErrDiv = getActiveBotMsgDiv(targetTabId);
                if (targetErrDiv) {
                    targetErrDiv.removeAttribute('data-streaming');
                    updateBotMessageDisplay(
                        targetErrDiv,
                        formattedErr,
                        message.model || currentActiveModel,
                        false
                    );
                }
                currentBotMsgDiv = null;
                currentBotRawText = '';
                setGenerationState(false);
            } else if (targetTab) {
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = targetTab.messagesHtml || '';
                let botDiv = tempContainer.querySelector('.msg.bot[data-streaming="true"]');
                if (!botDiv) {
                    const botMsgs = tempContainer.querySelectorAll('.msg.bot');
                    if (botMsgs.length > 0) botDiv = botMsgs[botMsgs.length - 1];
                }
                if (botDiv) {
                    botDiv.removeAttribute('data-streaming');
                    updateBotMessageDisplay(botDiv, formattedErr, message.model || targetTab.model, false);
                    targetTab.messagesHtml = tempContainer.innerHTML;
                }
            }
            break;
        }
    }
});

// Send ready signal to host on startup
vscode.postMessage({ type: 'webviewReady' });
vscode.postMessage({ type: 'fetchModels' });
vscode.postMessage({ type: 'restoreChatHistory' });
