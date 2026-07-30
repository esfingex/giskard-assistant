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
    const cfgConnectorUrl = document.getElementById('cfg-connector-url');

    let currentBotMsgDiv = null;
    let currentBotRawText = '';
    let currentActiveModel = '';
    let selectedContextType = 'none';

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function updateBotMessageDisplay(div, fullText, modelName) {
        if (!div) return;
        currentBotRawText = fullText;
        let clean = fullText.replace(/&lt;think&gt;/g, '<think>').replace(/&lt;\/think&gt;/g, '</think>');
        
        const activeModel = modelName || (modelSelect ? modelSelect.value : 'model');
        const modelTagHtml = '<div class="model-tag">🏷️ ' + escapeHtml(activeModel) + '</div>';

        // Detectar traza de pensamiento (soporta con o sin tag <think> inicial)
        if (clean.indexOf('</think>') !== -1) {
            const parts = clean.split('</think>');
            const thinkContent = parts[0].replace('<think>', '').trim();
            const answerContent = parts.slice(1).join('</think>').trim();

            div.innerHTML = modelTagHtml +
                            '<details class="think-box" open>' +
                            '<summary>💡 Pensamiento de la IA (Ocultar/Mostrar)</summary>' +
                            '<div class="think-content">' + escapeHtml(thinkContent) + '</div>' +
                            '</details>' +
                            '<div class="answer-content">' + escapeHtml(answerContent) + '</div>';
        } else if (clean.startsWith('<think>')) {
            const thinkContent = clean.replace('<think>', '').trim();
            div.innerHTML = modelTagHtml +
                            '<details class="think-box" open>' +
                            '<summary>💡 Pensamiento de la IA (Razonando...)</summary>' +
                            '<div class="think-content">' + escapeHtml(thinkContent) + '</div>' +
                            '</details>';
        } else {
            div.innerHTML = modelTagHtml + '<div class="answer-content">' + escapeHtml(fullText) + '</div>';
        }
    }

    function updateTokenCounter() {
        if (!messagesDiv || !tokenCounter) return;
        let totalChars = 0;
        messagesDiv.querySelectorAll('.msg').forEach(m => totalChars += m.textContent.length);
        const totalEstTokens = Math.ceil(totalChars / 4);
        tokenCounter.textContent = '🔢 Tokens: ' + totalEstTokens.toLocaleString() + ' / 32,768';
        tokenCounter.style.color = totalEstTokens > 24000 ? '#ff6b6b' : 'inherit';
    }

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => { 
            if (settingsModal) settingsModal.style.display = 'flex'; 
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

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
                break;
            case 'streamToken':
                if (currentBotRawText === '' && currentBotMsgDiv) {
                    currentBotMsgDiv.textContent = '';
                }
                currentBotRawText += message.token;
                updateBotMessageDisplay(currentBotMsgDiv, currentBotRawText, message.model || currentActiveModel);
                if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
                updateTokenCounter();
                break;
            case 'streamComplete':
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
