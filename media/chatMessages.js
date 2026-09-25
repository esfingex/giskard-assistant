/**
 * Giskard Assistant VSCode Extension — Module: Message Rendering & History
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatView.js (v4.3.0 wave 7b). Scope global compartido entre
 * scripts del webview (mismo patrón que chatUtils.js). Orden de carga importa:
 * chatUtils -> chatState -> chatTabs -> chatMessages -> connectionsView ->
 * mcpView -> chatRouter -> chatView.
 */

/** Flush accumulated tool results (files read, dirs listed, searches) back to the model */
function flushToolBatch() {
    if (_readFilesBatch.length > 0 && _lastUserPrompt) {
        var combinedContent = _readFilesBatch
            .map(function (item) {
                var content = item.content || '';
                if (content.length > 6000) {
                    content =
                        content.substring(0, 6000) +
                        '\n... [Contenido truncado a 6000 caracteres para seguridad de contexto]';
                }
                return 'File `' + item.path + '`:\n```\n' + content + '\n```';
            })
            .join('\n\n');
        var followUp =
            '[Contenido de los archivos leídos del workspace]:\n\n' +
            combinedContent +
            '\n\nCon base en la información de estos archivos del proyecto, responde a la solicitud del usuario:\n' +
            _lastUserPrompt;
        // Hard cap on re-injected content: keep it inside the local model context window
        // (32K tokens ≈ 24K chars of code) so the follow-up generation never overflows.
        if (followUp.length > 24000) {
            followUp =
                followUp.substring(0, 24000) +
                '\n\n... [Contenido combinado truncado para no desbordar la ventana de contexto del modelo local]';
        }
        _readFilesBatch = [];
        if (promptInput) {
            promptInput.value = followUp;
            setTimeout(function () {
                send();
            }, 300);
        }
    }
}

/** Fase 3b: render the model's [PLAN] with Approve/Discard buttons */
function showPlanCard(planText, modelName, tabId) {
    if (!messagesDiv) return;
    const card = document.createElement('div');
    card.className = 'msg bot system-tool-msg';
    card.style.cssText = 'border-left:3px solid #a78bfa;padding:8px 10px;font-size:11px;margin:6px 0;';
    card.innerHTML =
        '<div style="font-weight:bold;color:#a78bfa;">📋 Plan propuesto por la IA' +
        (modelName ? ' (' + escapeHtml(modelName) + ')' : '') +
        '</div>' +
        '<pre style="white-space:pre-wrap;font-size:10px;max-height:200px;overflow:auto;margin:6px 0;">' +
        escapeHtml(planText) +
        '</pre>' +
        '<div style="display:flex;gap:6px;margin-top:4px;">' +
        '<button id="plan-approve-btn" style="background:#16a34a;color:#fff;border:none;padding:5px 12px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:bold;">✅ Aprobar y ejecutar</button>' +
        '<button id="plan-discard-btn" style="background:transparent;color:#f87171;border:1px solid #f87171;padding:5px 12px;border-radius:4px;font-size:10px;cursor:pointer;">❌ Descartar</button>' +
        '</div>';
    messagesDiv.appendChild(card);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const approveBtn = card.querySelector('#plan-approve-btn');
    const discardBtn = card.querySelector('#plan-discard-btn');
    if (approveBtn) {
        approveBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'approvePlan', plan: planText, model: modelName, tabId: tabId });
            card.remove();
        });
    }
    if (discardBtn) {
        discardBtn.addEventListener('click', function () {
            card.remove();
        });
    }
}

/** Fase 4a: serialize current tabs and persist them in the extension host */
function persistChatHistory() {
    try {
        const serializable = _subTabs.map(function (t) {
            return {
                id: t.id,
                title: t.title || '',
                model: t.model || '',
                messagesHtml: t.messagesHtml || '',
                rawText: t.rawText || ''
            };
        });
        vscode.postMessage({ type: 'saveChatHistory', tabs: serializable });
    } catch (e) {}
}

/** Fase 4a: restore persisted tabs from the extension host */
function restoreChatHistory(tabs) {
    if (!Array.isArray(tabs) || tabs.length === 0) return;
    try {
        const restored = tabs
            .filter(function (t) {
                return t && t.id && t.messagesHtml;
            })
            .map(function (t) {
                return {
                    id: String(t.id),
                    title: t.title || 'Chat',
                    model: t.model || '',
                    messagesHtml: String(t.messagesHtml),
                    rawText: t.rawText || '',
                    isGenerating: false
                };
            });
        if (restored.length === 0) return;
        _subTabs = restored;
        _subTabCounter = restored.length;
        _activeTabId = restored[0].id;

        const firstTab = restored[0];
        if (messagesDiv) messagesDiv.innerHTML = firstTab.messagesHtml;
        currentActiveModel = firstTab.model || _enabledModelsCache[0] || '';
        currentBotRawText = firstTab.rawText || '';
        currentBotMsgDiv = messagesDiv ? messagesDiv.querySelector('.msg.bot[data-streaming="true"]') : null;

        if (activeModelName) {
            activeModelName.textContent = '🤖 ' + (currentActiveModel || 'Modelo');
        }
        renderSubTabs();
        renderPopoverLists();
        updateTokenCounter();
    } catch (e) {}
}

function getActiveBotMsgDiv(tabId) {
    const targetTabId = tabId || _activeTabId;
    if (targetTabId === _activeTabId) {
        if (currentBotMsgDiv && document.body.contains(currentBotMsgDiv)) {
            return currentBotMsgDiv;
        }
        const msgDiv = document.getElementById('messages');
        if (msgDiv) {
            let found = msgDiv.querySelector('.msg.bot[data-streaming="true"]');
            if (!found) {
                const botMsgs = msgDiv.querySelectorAll('.msg.bot');
                if (botMsgs.length > 0) found = botMsgs[botMsgs.length - 1];
            }
            if (found) {
                currentBotMsgDiv = found;
                return found;
            }
        }
    }
    return null;
}

function updateBotMessageDisplay(div, fullText, modelName, isStreaming) {
    if (!div) return;
    currentBotRawText = fullText;
    let clean = normalizeThinkingTags(fullText);

    const activeModel = modelName || (modelSelect ? modelSelect.value : 'model');
    const modelTagHtml = '<div class="model-tag">🏷️ ' + escapeHtml(activeModel) + '</div>';

    // DeepSeek-R1 / Qwen thinking format:  think ...  response
    if (clean.includes(' response') && (clean.includes(' think') || clean.startsWith(' think'))) {
        const parts = clean.split(' response');
        const thinkContent = parts[0].replace(' think', '').trim();
        const answerContent = parts.slice(1).join(' response').trim();
        const openAttr = isStreaming ? 'open' : '';
        div.innerHTML =
            modelTagHtml +
            '<details class="think-box" ' +
            openAttr +
            '>' +
            '<summary>💡 Razonamiento de la IA (Ocultar/Mostrar)</summary>' +
            '<div class="think-content">' +
            formatMarkdown(thinkContent) +
            '</div>' +
            '</details>' +
            '<div class="answer-content">' +
            formatMarkdown(answerContent) +
            '</div>';
    } else if (clean.startsWith(' think') && !clean.includes(' response')) {
        const thinkContent = clean.replace(' think', '').trim();
        div.innerHTML =
            modelTagHtml +
            '<details class="think-box" open>' +
            '<summary>💡 Razonamiento de la IA (Razonando…)</summary>' +
            '<div class="think-content">' +
            formatMarkdown(thinkContent) +
            '</div>' +
            '</details>';
    } else if (clean.indexOf('</think>') !== -1) {
        const parts = clean.split('</think>');
        const thinkContent = parts[0].replace('<think>', '').trim();
        const answerContent = parts.slice(1).join('</think>').trim();

        const openAttr = isStreaming ? 'open' : '';
        div.innerHTML =
            modelTagHtml +
            '<details class="think-box" ' +
            openAttr +
            '>' +
            '<summary>💡 Pensamiento de la IA (Ocultar/Mostrar)</summary>' +
            '<div class="think-content">' +
            formatMarkdown(thinkContent) +
            '</div>' +
            '</details>' +
            '<div class="answer-content">' +
            formatMarkdown(answerContent) +
            '</div>';
    } else if (clean.startsWith('<think>')) {
        const thinkContent = clean.replace('<think>', '').trim();
        div.innerHTML =
            modelTagHtml +
            '<details class="think-box" open>' +
            '<summary>💡 Pensamiento de la IA (Razonando...)</summary>' +
            '<div class="think-content">' +
            formatMarkdown(thinkContent) +
            '</div>' +
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
    messagesDiv.querySelectorAll('.msg').forEach((m) => (totalChars += m.textContent.length));
    const totalEstTokens = Math.ceil(totalChars / 4);

    const currentModel = currentActiveModel || '';
    const maxTokens = getModelMaxContext(currentModel);

    tokenCounter.textContent =
        '🔢 Tokens: ' + totalEstTokens.toLocaleString() + ' / ' + maxTokens.toLocaleString();
    tokenCounter.style.color = totalEstTokens > maxTokens * 0.8 ? '#ff6b6b' : 'inherit';
}
