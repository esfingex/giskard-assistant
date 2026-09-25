/**
 * Giskard Assistant VSCode Extension — Module: Shared State & DOM Registry
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraído de chatView.js (v4.3.0 wave 7b). Scope global compartido entre
 * scripts del webview (mismo patrón que chatUtils.js). Orden de carga importa:
 * chatUtils -> chatState -> chatTabs -> chatMessages -> connectionsView ->
 * mcpView -> chatRouter -> chatView.
 */


const modelPickerBtn = document.getElementById('model-picker-btn');
const modelPopoverCard = document.getElementById('model-popover-card');
const popoverSearchInput = document.getElementById('popover-search-input');
const popoverModelList = document.getElementById('popover-model-list');
const popoverOtherToggle = document.getElementById('popover-other-toggle');
const popoverOtherList = document.getElementById('popover-other-list');
const activeModelName = document.getElementById('active-model-name');
const accordionArrow = document.getElementById('accordion-arrow');

const messagesDiv = document.getElementById('messages');
const promptInput = document.getElementById('prompt');
const sendBtn = document.getElementById('send-btn');
const incFileCheckbox = document.getElementById('include-file') || document.getElementById('inc-file');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const settingsModal = document.getElementById('settings-modal');
const cfgConnectorUrl = document.getElementById('cfg-connector-url');
const modelSelect = document.getElementById('model-select');
const chatModelSelect = document.getElementById('chat-model-select');

let _enabledModelsCache = [];
let _allModelsCache = [];

function cleanModelName(m) {
    if (!m) return '';
    if (typeof m === 'string') return m.trim();
    if (typeof m === 'object') return (m.name || m.id || m.label || m.model || '').trim();
    return String(m).trim();
}

// ── Internal Sub-Tabs State Management ──────────────────────────────
let _subTabs = [
    { id: 'tab-1', title: 'Chat 1', model: '', messagesHtml: '' }
];
let _activeTabId = 'tab-1';
let _subTabCounter = 1;

const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) {
    newChatBtn.addEventListener('click', function() {
        createNewSubTab();
    });
}

const addCtxBtn = document.getElementById('add-ctx-btn');
const compressBtn = document.getElementById('compress-btn');
const tokenCounter = document.getElementById('token-counter');
const ctxMenu = document.getElementById('context-menu');
const offlineBadge = document.getElementById('offline-badge');
const clearCtxBtn = document.getElementById('clear-ctx-btn');

const tabBtnLocal = document.getElementById('tab-btn-local');
const tabBtnRemote = document.getElementById('tab-btn-remote');
const tabBtnMcp = document.getElementById('tab-btn-mcp');
const tabBtnExclusions = document.getElementById('tab-btn-exclusions');
const tabBtnPalette = document.getElementById('tab-btn-palette');

const palTextColor = document.getElementById('palette-text-color');
const palHeaderColor = document.getElementById('palette-header-color');
const palAccentColor = document.getElementById('palette-accent-color');
const palUserBg = document.getElementById('palette-user-bg');
const palBotBg = document.getElementById('palette-bot-bg');
const palThinkBg = document.getElementById('palette-think-bg');

const btnWhite = document.getElementById('preset-white');
const btnCyan = document.getElementById('preset-cyan');
const btnEmerald = document.getElementById('preset-emerald');
const btnPurple = document.getElementById('preset-purple');

let currentBotMsgDiv = null;
let currentBotRawText = '';
let currentActiveModel = '';
let selectedContextType = 'none';
let _readFilesBatch = [];
let _readFileTimer = null;

function getModelMaxContext(modelName) {
    const m = (modelName || '').toLowerCase().trim();
    return m.startsWith('local:') ? 32768 : 128000;
}

const ctxMedia = document.getElementById('ctx-media');
if (ctxMedia) ctxMedia.addEventListener('click', () => { selectedContextType = 'media'; addCtxBtn.textContent = '✓ +media'; if (ctxMenu) ctxMenu.style.display = 'none'; });

const ctxMentions = document.getElementById('ctx-mentions');
if (ctxMentions) ctxMentions.addEventListener('click', () => { selectedContextType = 'mentions'; addCtxBtn.textContent = '✓ +mentions'; if (ctxMenu) ctxMenu.style.display = 'none'; });

const ctxGraphify = document.getElementById('ctx-graphify');

const ctxSkills = document.getElementById('ctx-skills');

const ctxCheck = document.getElementById('ctx-action-check');
if (ctxCheck) ctxCheck.addEventListener('click', () => { vscode.postMessage({ type: 'actionBtn', action: 'cargo check' }); if (ctxMenu) ctxMenu.style.display = 'none'; });

const ctxPython = document.getElementById('ctx-action-python');
const stopBtn = document.getElementById('stop-btn');
