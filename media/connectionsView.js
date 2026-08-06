/**
 * Giskard Assistant VSCode Extension — Module: Connections & Models UI Manager
 * Copyright (C) 2025-2026 Giskard Project
 */

let lastDetectedModels = [];

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

let lastModelsPayload = { models: [], localModels: [], activeTag: 'ollama', activeName: 'Local AI' };

function renderModelFilterList(payload) {
    const modelFilterList = document.getElementById('model-filter-list');
    if (!modelFilterList) return;

    if (Array.isArray(payload)) {
        lastModelsPayload.models = payload;
    } else if (payload && typeof payload === 'object') {
        lastModelsPayload = {
            models: payload.models || [],
            localModels: payload.localModels || [],
            activeTag: payload.activeTag || 'ollama',
            activeName: payload.activeName || 'Local AI'
        };
    }

    const enabled = getEnabledModels();
    let html = '';

    const tagUpper = (lastModelsPayload.activeTag || 'ollama').toUpperCase();
    const tagClass = ['nvidia', 'deepseek', 'kimi', 'qwen', 'openai', 'anthropic', 'gemini'].includes(lastModelsPayload.activeTag) ? 'cli' : 'ollama';
    const activeModels = lastModelsPayload.models || [];
    const localModels = lastModelsPayload.localModels || [];

    // 1. Collapsible Group 1: Active Connection Provider Models
    if (activeModels.length > 0) {
        html += `<details open style="margin-bottom:8px;">
            <summary style="font-size:10px;font-weight:bold;color:#38bdf8;cursor:pointer;user-select:none;padding:2px 0;">
                🟢 ${escapeHtml(lastModelsPayload.activeName)} [${escapeHtml(tagUpper)}] (${activeModels.length} detectados)
            </summary>
            <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
        activeModels.forEach(m => {
            const isChecked = !enabled || enabled.includes(m);
            html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
                <input type="checkbox" class="model-filter-cb" value="${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                <span class="filter-tag ${tagClass}">${escapeHtml(tagUpper)}</span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
            </label>`;
        });
        html += `</div></details>`;
    }

    // 2. Collapsible Group 2: Local System Models (Ollama)
    if (localModels.length > 0 && lastModelsPayload.activeTag !== 'ollama') {
        html += `<details style="margin-bottom:8px;">
            <summary style="font-size:10px;font-weight:bold;color:#34d399;cursor:pointer;user-select:none;padding:2px 0;">
                🦙 Modelos Locales en el Sistema (Ollama - ${localModels.length} detectados)
            </summary>
            <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
        localModels.forEach(m => {
            const isChecked = !enabled || enabled.includes(`local:${m}`);
            html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
                <input type="checkbox" class="model-filter-cb" value="local:${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                <span class="filter-tag ollama">LOCAL</span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
            </label>`;
        });
        html += `</div></details>`;
    }

    // 3. Collapsible Group 3: Cloud Orchestrators & CLIs
    html += `<details style="margin-bottom:4px;">
        <summary style="font-size:10px;font-weight:bold;color:#fbbf24;cursor:pointer;user-select:none;padding:2px 0;">
            ☁️ Orquestadores & CLIs
        </summary>
        <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
    const cliModels = [
        { id: 'cli:gemini', name: 'Gemini CLI (Google AI)' },
        { id: 'cli:claude', name: 'Claude CLI (Anthropic)' }
    ];
    cliModels.forEach(c => {
        const isChecked = !enabled || enabled.includes(c.id);
        html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
            <input type="checkbox" class="model-filter-cb" value="${escapeHtml(c.id)}" ${isChecked ? 'checked' : ''}>
            <span class="filter-tag cli">CLI</span>
            <span>${escapeHtml(c.name)}</span>
        </label>`;
    });
    html += `</div></details>`;

    modelFilterList.innerHTML = html;

    modelFilterList.querySelectorAll('.model-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = [];
            modelFilterList.querySelectorAll('.model-filter-cb:checked').forEach(c => selected.push(c.value));
            setEnabledModels(selected);
            updateModelDropdown(lastModelsPayload);
        });
    });
}

function updateModelDropdown(payload) {
    const modelSelect = document.getElementById('model-select');
    if (!modelSelect) return;

    if (Array.isArray(payload)) {
        lastModelsPayload.models = payload;
    } else if (payload && typeof payload === 'object') {
        lastModelsPayload = {
            models: payload.models || [],
            localModels: payload.localModels || [],
            activeTag: payload.activeTag || 'ollama',
            activeName: payload.activeName || 'Local AI'
        };
    }

    const currentVal = modelSelect.value;
    const enabled = getEnabledModels();
    const activeModels = (lastModelsPayload.models || []).filter(m => !enabled || enabled.includes(m));
    const localModels = (lastModelsPayload.localModels || []).filter(m => !enabled || enabled.includes(`local:${m}`));
    const showGemini = !enabled || enabled.includes('cli:gemini');
    const showClaude = !enabled || enabled.includes('cli:claude');

    let html = '';
    const tagUpper = (lastModelsPayload.activeTag || 'ollama').toUpperCase();

    // Group 1: Active Connection Provider Models
    if (activeModels.length > 0) {
        html += `<optgroup label="🟢 ${escapeHtml(lastModelsPayload.activeName)} [${escapeHtml(tagUpper)}] (${activeModels.length} activos)">`;
        activeModels.forEach(m => {
            let label = m;
            if (m.includes('120b') || m.includes('coder') || m.includes('distill')) label += ' (Coder/Reasoning ⚡)';
            html += `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
        });
        html += '</optgroup>';
    }

    // Group 2: Local System Models (Ollama)
    if (localModels.length > 0 && lastModelsPayload.activeTag !== 'ollama') {
        html += `<optgroup label="🦙 Modelos Locales en el Sistema (Ollama - ${localModels.length} activos)">`;
        localModels.forEach(m => {
            html += `<option value="local:${escapeHtml(m)}">Local: ${escapeHtml(m)}</option>`;
        });
        html += '</optgroup>';
    }

    // Group 3: Cloud Orchestrators & CLIs
    if (showGemini || showClaude) {
        html += '<optgroup label="☁️ Orquestadores & CLIs">';
        if (showGemini) html += '<option value="cli:gemini">Gemini CLI (1M Context 🧠)</option>';
        if (showClaude) html += '<option value="cli:claude">Claude CLI (200K Context 🧠)</option>';
        html += '</optgroup>';
    }

    if (!html) {
        html = '<option value="default">— Selecciona un modelo —</option>';
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
    if (typeof updateTokenCounter === 'function') updateTokenCounter();
}

function renderConnectionsList(connections) {
    const connectionsListDiv = document.getElementById('connections-list');
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

// Bind connection form listeners
(function initConnectionsUI() {
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

    function updateConnTypeVisibility() {
        if (!connTokenField) return;
        const isRemote = connTypeRemote && connTypeRemote.checked;
        connTokenField.style.display = isRemote ? 'flex' : 'none';
    }

    if (connTagSel) {
        connTagSel.addEventListener('change', () => {
            const val = connTagSel.value;
            if (val === 'nvidia') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'NVIDIA NIM API';
                if (connUrlInp) connUrlInp.value = 'https://integrate.api.nvidia.com/v1';
                if (connTypeRemote) connTypeRemote.checked = true;
            } else if (val === 'deepseek') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'DeepSeek V3 / R1 API';
                if (connUrlInp) connUrlInp.value = 'https://api.deepseek.com/v1';
                if (connTypeRemote) connTypeRemote.checked = true;
            } else if (val === 'kimi') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'Moonshot Kimi API';
                if (connUrlInp) connUrlInp.value = 'https://api.moonshot.cn/v1';
                if (connTypeRemote) connTypeRemote.checked = true;
            } else if (val === 'qwen') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'Qwen DashScope API';
                if (connUrlInp) connUrlInp.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
                if (connTypeRemote) connTypeRemote.checked = true;
            } else if (val === 'giskard-sys') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'Giskard-Sys Sovereign';
                if (connUrlInp) connUrlInp.value = 'http://localhost:3500';
                if (connTypeLocal) connTypeLocal.checked = true;
            } else if (val === 'ollama') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'Ollama Local';
                if (connUrlInp) connUrlInp.value = 'http://localhost:11434';
                if (connTypeLocal) connTypeLocal.checked = true;
            } else if (val === 'openai') {
                if (connNameInp && !connNameInp.value) connNameInp.value = 'OpenAI API';
                if (connUrlInp) connUrlInp.value = 'https://api.openai.com/v1';
                if (connTypeRemote) connTypeRemote.checked = true;
            }
            updateConnTypeVisibility();
        });
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
})();
