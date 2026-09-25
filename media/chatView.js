/**
 * Giskard Assistant VSCode Extension — Module: Main Chat Controller (wiring & send)
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatView.js (v4.3.0 wave 7b). Scope global compartido entre
 * scripts del webview (mismo patrón que chatUtils.js). Orden de carga importa:
 * chatUtils -> chatState -> chatTabs -> chatMessages -> connectionsView ->
 * mcpView -> chatRouter -> chatView.
 */


if (modelSelect) {
    modelSelect.addEventListener('change', updateTokenCounter);
}

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
        bMsg.textContent = '🧠 Comprimiendo contexto y guardando memoria BCF...';
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
if (ctxGraphify) {
    ctxGraphify.addEventListener('click', () => {
        vscode.postMessage({ type: 'runGraphify' });
        if (ctxMenu) ctxMenu.style.display = 'none';
    });
}
if (ctxSkills) {
    ctxSkills.addEventListener('click', () => {
        vscode.postMessage({ type: 'fetchSkills' });
        if (ctxMenu) ctxMenu.style.display = 'none';
    });
}
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

if (ctxPython) ctxPython.addEventListener('click', () => { vscode.postMessage({ type: 'actionBtn', action: 'python3 -m unittest' }); if (ctxMenu) ctxMenu.style.display = 'none'; });

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

    const activeTabId = _activeTabId;
    const curTab = _subTabs.find(t => t.id === activeTabId);
    if (curTab) {
        curTab.isGenerating = true;
        curTab.model = currentActiveModel;
    }

    const bMsg = document.createElement('div');
    bMsg.className = 'msg bot';
    bMsg.setAttribute('data-streaming', 'true');
    bMsg.setAttribute('data-tab-id', activeTabId);
    bMsg.textContent = 'Pensando...';
    messagesDiv.appendChild(bMsg);
    currentBotMsgDiv = bMsg;
    currentBotRawText = '';
    currentActiveModel = currentActiveModel || (_enabledModelsCache[0] || '');

    if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateTokenCounter();

    vscode.postMessage({
        type: 'sendPrompt',
        prompt: prompt,
        model: currentActiveModel,
        tabId: activeTabId,
        includeActiveFile: incFileCheckbox ? incFileCheckbox.checked : false,
        contextType: selectedContextType
    });

    selectedContextType = 'none';
    if (addCtxBtn) addCtxBtn.textContent = '+ Context';
    setGenerationState(true);
}
