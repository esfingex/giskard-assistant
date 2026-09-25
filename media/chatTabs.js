/**
 * Giskard Assistant VSCode Extension — Module: Model Popover, Sub-Tabs, Settings Tabs & Palette
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatView.js (v4.3.0 wave 7b). Scope global compartido entre
 * scripts del webview (mismo patrón que chatUtils.js). Orden de carga importa:
 * chatUtils -> chatState -> chatTabs -> chatMessages -> connectionsView ->
 * mcpView -> chatRouter -> chatView.
 */


if (modelPickerBtn && modelPopoverCard) {
    modelPickerBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        modelPopoverCard.classList.toggle('open');
        if (modelPopoverCard.classList.contains('open')) {
            vscode.postMessage({ type: 'getModels' });
            renderPopoverLists();
            if (popoverSearchInput) popoverSearchInput.focus();
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

    const cleanedEnabled = _enabledModelsCache.map(cleanModelName).filter(Boolean);
    const cleanedAll = _allModelsCache.map(cleanModelName).filter(Boolean);
    
    // Single unified list: enabled models first, followed by all other available models
    const allAvailable = Array.from(new Set([...cleanedEnabled, ...cleanedAll]));
    const filteredModels = allAvailable.filter(m => m.toLowerCase().includes(q));

    if (filteredModels.length === 0) {
        popoverModelList.innerHTML = '<div style="font-size:11px;color:#f87171;padding:8px 6px;text-align:center;">⚠️ Falló la conexión al obtener los modelos.<br><span style="opacity:0.8;font-size:10px;">Verifica tus conexiones activas en Ajustes ⚙️ o en la barra lateral 👈</span></div>';
    } else {
        popoverModelList.innerHTML = filteredModels.map(m => {
            const isSel = (m === currentActiveModel);
            const isCheckedInTree = cleanedEnabled.includes(m);
            const selClass = isSel ? 'selected' : '';
            const checkMark = isSel ? '✓ ' : '';
            const badgeText = isSel ? 'Activo' : (isCheckedInTree ? 'Habilitado' : 'Disponible');
            const badgeStyle = isSel ? 'background:rgba(56,189,248,0.25);color:#38bdf8;font-weight:bold;' : (isCheckedInTree ? 'background:rgba(34,197,94,0.18);color:#4ade80;font-weight:bold;' : 'opacity:0.6;');
            
            return `<div class="popover-model-item ${selClass}" data-model="${escapeHtml(m)}">
                <span>${checkMark}${escapeHtml(m)}</span>
                <span class="popover-model-badge" style="${badgeStyle}">${badgeText}</span>
            </div>`;
        }).join('');
    }

    if (popoverOtherList) {
        popoverOtherList.innerHTML = '';
    }

    const items = popoverModelList.querySelectorAll('.popover-model-item');
    items.forEach(el => {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            const selected = el.getAttribute('data-model');
            if (selected) {
                currentActiveModel = selected;
                const curTab = _subTabs.find(t => t.id === _activeTabId);
                if (curTab) {
                    curTab.model = selected;
                }
                if (activeModelName) {
                    activeModelName.textContent = '🤖 ' + selected;
                }
                vscode.postMessage({ type: 'modelChanged', model: selected });
                if (modelPopoverCard) {
                    modelPopoverCard.classList.remove('open');
                }
                renderSubTabs();
                renderPopoverLists();
                updateTokenCounter();
            }
        });
    });
}

function renderSubTabs() {
    const subTabBar = document.getElementById('sub-tab-bar');
    if (!subTabBar) return;

    subTabBar.innerHTML = _subTabs.map(t => {
        const isActive = t.id === _activeTabId;
        const activeClass = isActive ? 'active' : '';
        const modelLabel = t.model ? ` [${t.model.split('/')[0]}]` : '';
        const closeBtnHtml = _subTabs.length > 1 ? `<span class="sub-tab-close-btn" data-close-id="${t.id}">✕</span>` : '';
        return `<div class="sub-tab-item ${activeClass}" data-tab-id="${t.id}">
            <span>💬 ${escapeHtml(t.title)}${escapeHtml(modelLabel)}</span>
            ${closeBtnHtml}
        </div>`;
    }).join('');

    subTabBar.querySelectorAll('.sub-tab-item').forEach(el => {
        el.addEventListener('click', function(e) {
            const closeTarget = e.target.closest('.sub-tab-close-btn');
            if (closeTarget) {
                e.stopPropagation();
                const closeId = closeTarget.getAttribute('data-close-id');
                closeSubTab(closeId);
                return;
            }
            const tabId = el.getAttribute('data-tab-id');
            if (tabId) switchSubTab(tabId);
        });
    });
}

function saveCurrentTabState() {
    const curTab = _subTabs.find(t => t.id === _activeTabId);
    const msgDiv = document.getElementById('messages');
    if (curTab && msgDiv) {
        curTab.messagesHtml = msgDiv.innerHTML;
        curTab.model = currentActiveModel;
        curTab.rawText = currentBotRawText;
    }
}

function switchSubTab(tabId) {
    if (tabId === _activeTabId) return;

    saveCurrentTabState();

    _activeTabId = tabId;
    const nextTab = _subTabs.find(t => t.id === _activeTabId);
    if (!nextTab) return;

    const msgDiv = document.getElementById('messages');
    if (msgDiv) msgDiv.innerHTML = nextTab.messagesHtml || '';
    currentActiveModel = nextTab.model || (_enabledModelsCache[0] || '');
    currentBotRawText = nextTab.rawText || '';
    currentBotMsgDiv = msgDiv ? msgDiv.querySelector('.msg.bot[data-streaming="true"]') : null;

    if (activeModelName) {
        activeModelName.textContent = '🤖 ' + (currentActiveModel || 'Modelo');
    }

    setGenerationState(Boolean(nextTab.isGenerating));
    renderSubTabs();
    renderPopoverLists();
}

function createNewSubTab() {
    saveCurrentTabState();

    _subTabCounter++;
    const newTabId = 'tab-' + Date.now();
    const newTitle = 'Chat ' + _subTabCounter;
    const newModel = currentActiveModel || (_enabledModelsCache[0] || '');

    const welcomeHtml = `<div class="msg bot">✨ Nuevo sub-chat #${_subTabCounter} iniciado. Selecciona cualquier modelo en <b>[ 🤖 Modelo ▾ ]</b> para interactuar en paralelo.</div>`;

    _subTabs.push({
        id: newTabId,
        title: newTitle,
        model: newModel,
        messagesHtml: welcomeHtml
    });

    _activeTabId = newTabId;
    const msgDiv = document.getElementById('messages');
    if (msgDiv) msgDiv.innerHTML = welcomeHtml;
    currentActiveModel = newModel;

    if (activeModelName) {
        activeModelName.textContent = '🤖 ' + (currentActiveModel || 'Modelo');
    }

    renderSubTabs();
    renderPopoverLists();
}

function resequenceSubTabs() {
    _subTabs.forEach((t, i) => {
        t.title = 'Chat ' + (i + 1);
    });
    _subTabCounter = _subTabs.length;
}

function closeSubTab(tabId) {
    if (_subTabs.length <= 1) return;

    const idx = _subTabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    _subTabs.splice(idx, 1);

    resequenceSubTabs();

    if (_activeTabId === tabId) {
        const nextIdx = Math.max(0, idx - 1);
        _activeTabId = _subTabs[nextIdx].id;
        const nextTab = _subTabs[nextIdx];
        const msgDiv = document.getElementById('messages');
        if (msgDiv) msgDiv.innerHTML = nextTab.messagesHtml || '';
        currentActiveModel = nextTab.model || '';
        if (activeModelName) {
            activeModelName.textContent = '🤖 ' + (currentActiveModel || 'Modelo');
        }
    }

    renderSubTabs();
    renderPopoverLists();
}

// Initialize sub-tabs bar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSubTabs);
} else {
    renderSubTabs();
}

function switchSettingsTab(btn, targetId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');
}

if (tabBtnLocal) tabBtnLocal.addEventListener('click', () => switchSettingsTab(tabBtnLocal, 'tab-content-local'));
if (tabBtnRemote) tabBtnRemote.addEventListener('click', () => switchSettingsTab(tabBtnRemote, 'tab-content-remote'));
if (tabBtnMcp) tabBtnMcp.addEventListener('click', () => switchSettingsTab(tabBtnMcp, 'tab-content-mcp'));
if (tabBtnExclusions) tabBtnExclusions.addEventListener('click', () => switchSettingsTab(tabBtnExclusions, 'tab-content-exclusions'));
if (tabBtnPalette) tabBtnPalette.addEventListener('click', () => switchSettingsTab(tabBtnPalette, 'tab-content-palette'));

// 🎨 Live Custom Palette Color Event Listeners

function applyCustomPalette() {
    const root = document.documentElement;
    if (palAccentColor) root.style.setProperty('--accent-color', palAccentColor.value);
    if (palUserBg) root.style.setProperty('--user-bg', palUserBg.value);
    if (palBotBg) root.style.setProperty('--bot-bg', palBotBg.value);
    if (palThinkBg) root.style.setProperty('--think-bg', palThinkBg.value);
    if (palTextColor) root.style.setProperty('--text-color', palTextColor.value);

    const savedPalette = {
        textColor: palTextColor ? palTextColor.value : '',
        headerColor: palHeaderColor ? palHeaderColor.value : '',
        accentColor: palAccentColor ? palAccentColor.value : '',
        userBg: palUserBg ? palUserBg.value : '',
        botBg: palBotBg ? palBotBg.value : '',
        thinkBg: palThinkBg ? palThinkBg.value : ''
    };
    try { localStorage.setItem('giskard_custom_palette', JSON.stringify(savedPalette)); } catch(e) {}
}

[palTextColor, palHeaderColor, palAccentColor, palUserBg, palBotBg, palThinkBg].forEach(input => {
    if (input) {
        input.addEventListener('input', applyCustomPalette);
        input.addEventListener('change', applyCustomPalette);
    }
});
function setPaletteValues(text, header, accent, userBg, botBg, thinkBg) {
    if (palTextColor) palTextColor.value = text;
    if (palHeaderColor) palHeaderColor.value = header;
    if (palAccentColor) palAccentColor.value = accent;
    if (palUserBg) palUserBg.value = userBg;
    if (palBotBg) palBotBg.value = botBg;
    if (palThinkBg) palThinkBg.value = thinkBg;
    applyCustomPalette();
}
if (btnWhite) btnWhite.addEventListener('click', () => setPaletteValues('#ffffff', '#ffffff', '#e2e8f0', '#334155', '#1e293b', '#0f172a'));
if (btnCyan) btnCyan.addEventListener('click', () => setPaletteValues('#f8fafc', '#ffffff', '#38bdf8', '#0284c7', '#0f172a', '#0284c7'));
if (btnEmerald) btnEmerald.addEventListener('click', () => setPaletteValues('#ecfdf5', '#ffffff', '#34d399', '#059669', '#064e3b', '#022c22'));
if (btnPurple) btnPurple.addEventListener('click', () => setPaletteValues('#faf5ff', '#ffffff', '#c084fc', '#9333ea', '#3b0764', '#1e1b4b'));

try {
    const saved = JSON.parse(localStorage.getItem('giskard_custom_palette') || '{}');
    if (saved.accentColor) setPaletteValues(saved.textColor, saved.headerColor, saved.accentColor, saved.userBg, saved.botBg, saved.thinkBg);
} catch(e) {}
