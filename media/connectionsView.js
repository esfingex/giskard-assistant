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

function getModelProviderMeta(modelName, fallbackTag, fallbackName) {
    const m = (modelName || '').toLowerCase();
    if (m.startsWith('local:')) {
        return { tag: 'OLLAMA', label: 'Local Swarm (Ollama)', type: 'ollama' };
    }
    if (m.includes('nvidia') || m.includes('nemotron') || m.includes('llama') || m.includes('gpt-oss') || m.includes('mistralai')) {
        return { tag: 'NVIDIA', label: 'NVIDIA NIM API', type: 'cli' };
    }
    if (m.includes('deepseek')) {
        return { tag: 'DEEPSEEK', label: 'DeepSeek API', type: 'cli' };
    }
    if (m.includes('kimi') || m.includes('moonshot')) {
        return { tag: 'KIMI', label: 'Moonshot Kimi API', type: 'cli' };
    }
    if (m.includes('qwen') || m.includes('dashscope')) {
        return { tag: 'QWEN', label: 'Qwen / DashScope API', type: 'cli' };
    }
    if (m.includes('gemini')) {
        return { tag: 'GEMINI', label: 'Google Gemini', type: 'cli' };
    }
    if (m.includes('claude')) {
        return { tag: 'CLAUDE', label: 'Anthropic Claude', type: 'cli' };
    }
    
    const tagUpper = (fallbackTag || 'NVIDIA').toUpperCase();
    const tagClass = ['NVIDIA', 'DEEPSEEK', 'KIMI', 'QWEN', 'OPENAI', 'ANTHROPIC', 'GEMINI'].includes(tagUpper) ? 'cli' : 'ollama';
    return { tag: tagUpper, label: fallbackName || 'AI Model', type: tagClass };
}

function renderModelFilterList(payload) {
    const modelFilterList = document.getElementById('model-filter-list');
    if (!modelFilterList) return;

    if (Array.isArray(payload)) {
        lastModelsPayload.models = payload;
    } else if (payload && typeof payload === 'object') {
        lastModelsPayload = {
            models: payload.models || [],
            groups: payload.groups || [],
            localModels: payload.localModels || [],
            activeTag: payload.activeTag || 'nvidia',
            activeName: payload.activeName || 'AI Connections'
        };
    }

    const enabled = getEnabledModels();
    let html = '';

    const groups = lastModelsPayload.groups || [];
    const activeModels = lastModelsPayload.models || [];
    const localModels = lastModelsPayload.localModels || [];

    if (groups.length > 0) {
        groups.forEach(grp => {
            const tagUpper = (grp.connectionTag || 'AI').toUpperCase();
            html += `<details open style="margin-bottom:8px;">
                <summary style="font-size:10px;font-weight:bold;color:#38bdf8;cursor:pointer;user-select:none;padding:2px 0;">
                    🔌 Conexión: ${escapeHtml(grp.connectionName)} [${escapeHtml(tagUpper)}] (${grp.models.length} detectados)
                </summary>
                <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
            grp.models.forEach(m => {
                const meta = getModelProviderMeta(m, grp.connectionTag, grp.connectionName);
                const isChecked = !enabled || enabled.includes(m);
                html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
                    <input type="checkbox" class="model-filter-cb" value="${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                    <span class="filter-tag ${meta.type}">${escapeHtml(meta.tag)}</span>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
                </label>`;
            });
            html += `</div></details>`;
        });
    } else if (activeModels.length > 0) {
        const grouped = {};
        activeModels.forEach(m => {
            const meta = getModelProviderMeta(m, lastModelsPayload.activeTag, lastModelsPayload.activeName);
            if (!grouped[meta.label]) grouped[meta.label] = { meta, items: [] };
            grouped[meta.label].items.push(m);
        });

        Object.keys(grouped).forEach(groupLabel => {
            const grp = grouped[groupLabel];
            html += `<details open style="margin-bottom:8px;">
                <summary style="font-size:10px;font-weight:bold;color:#38bdf8;cursor:pointer;user-select:none;padding:2px 0;">
                    🟢 ${escapeHtml(grp.meta.label)} [${escapeHtml(grp.meta.tag)}] (${grp.items.length} detectados)
                </summary>
                <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
            grp.items.forEach(m => {
                const isChecked = !enabled || enabled.includes(m);
                html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
                    <input type="checkbox" class="model-filter-cb" value="${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                    <span class="filter-tag ${grp.meta.type}">${escapeHtml(grp.meta.tag)}</span>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
                </label>`;
            });
            html += `</div></details>`;
        });
    }

    // 2. Collapsible Group for Local System Models (Ollama)
    if (localModels.length > 0) {
        html += `<details style="margin-bottom:8px;">
            <summary style="font-size:10px;font-weight:bold;color:#34d399;cursor:pointer;user-select:none;padding:2px 0;">
                🦙 Modelos Locales en el Sistema (Ollama - ${localModels.length} detectados)
            </summary>
            <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;padding-left:6px;">`;
        localModels.forEach(m => {
            const isChecked = !enabled || enabled.includes(`local:${m}`);
            html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
                <input type="checkbox" class="model-filter-cb" value="local:${escapeHtml(m)}" ${isChecked ? 'checked' : ''}>
                <span class="filter-tag ollama">OLLAMA</span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${escapeHtml(m)}">${escapeHtml(m)}</span>
            </label>`;
        });
        html += `</div></details>`;
    }

    if (!html) {
        html = '<div style="font-size:10px;opacity:0.6;">Sin modelos detectados. Configura o activa conexiones en la pestaña API Remota.</div>';
    }

    modelFilterList.innerHTML = html;

    modelFilterList.querySelectorAll('.model-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = [];
            modelFilterList.querySelectorAll('.model-filter-cb:checked').forEach(c => selected.push(c.value));
            setEnabledModels(selected);
            updateModelDropdown();
        });
    });
}

function updateModelDropdown() {
    const modelSelect = document.getElementById('model-select');
    if (!modelSelect) return;

    const currentVal = modelSelect.value;
    const enabled = getEnabledModels();
    const groups = lastModelsPayload.groups || [];
    const activeModels = (lastModelsPayload.models || []).filter(m => !enabled || enabled.includes(m));
    const localModels = (lastModelsPayload.localModels || []).filter(m => !enabled || enabled.includes(`local:${m}`));
    const showGemini = !enabled || enabled.includes('cli:gemini');
    const showClaude = !enabled || enabled.includes('cli:claude');

    let html = '';

    if (groups.length > 0) {
        groups.forEach(grp => {
            const tagUpper = (grp.connectionTag || 'AI').toUpperCase();
            const grpFiltered = grp.models.filter(m => !enabled || enabled.includes(m));
            if (grpFiltered.length > 0) {
                html += `<optgroup label="🔌 ${escapeHtml(grp.connectionName)} [${escapeHtml(tagUpper)}] (${grpFiltered.length} activos)">`;
                grpFiltered.forEach(m => {
                    let label = m;
                    if (m.includes('120b') || m.includes('coder') || m.includes('distill')) label += ' (Coder/Reasoning ⚡)';
                    html += `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
                });
                html += '</optgroup>';
            }
        });
    } else if (activeModels.length > 0) {
        const grouped = {};
        activeModels.forEach(m => {
            const meta = getModelProviderMeta(m, lastModelsPayload.activeTag, lastModelsPayload.activeName);
            if (!grouped[meta.label]) grouped[meta.label] = { meta, items: [] };
            grouped[meta.label].items.push(m);
        });

        Object.keys(grouped).forEach(groupLabel => {
            const grp = grouped[groupLabel];
            html += `<optgroup label="🟢 ${escapeHtml(grp.meta.label)} [${escapeHtml(grp.meta.tag)}] (${grp.items.length} activos)">`;
            grp.items.forEach(m => {
                let label = m;
                if (m.includes('120b') || m.includes('coder') || m.includes('distill')) label += ' (Coder/Reasoning ⚡)';
                html += `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
            });
            html += '</optgroup>';
        });
    }

    if (localModels.length > 0) {
        html += `<optgroup label="🦙 Modelos Locales en el Sistema (Ollama - ${localModels.length} activos)">`;
        localModels.forEach(m => {
            html += `<option value="local:${escapeHtml(m)}">Local: ${escapeHtml(m)}</option>`;
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
            ? `<button type="button" class="btn-act-conn active" data-id="${c.id}" style="padding:2px 7px;font-size:9px;background:#16a34a;color:#ffffff;border:none;border-radius:3px;cursor:pointer;font-weight:bold;box-shadow:0 0 4px rgba(22,163,74,0.4);" title="Clic para desactivar esta conexión">★ Activa</button>`
            : `<button type="button" class="btn-act-conn" data-id="${c.id}" style="padding:2px 7px;font-size:9px;background:transparent;border:1px solid #38bdf8;color:#38bdf8;border-radius:3px;cursor:pointer;" title="Clic para activar esta conexión">Activar</button>`;

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

    // Exclusion patterns UI handlers
    const saveExclusionsBtn = document.getElementById('save-exclusions-btn');
    const resetExclusionsBtn = document.getElementById('reset-exclusions-btn');
    const exclusionPatternsInput = document.getElementById('exclusion-patterns-input');

    if (saveExclusionsBtn && exclusionPatternsInput) {
        saveExclusionsBtn.addEventListener('click', () => {
            const raw = exclusionPatternsInput.value || '';
            const patterns = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            vscode.postMessage({ type: 'saveExclusionPatterns', patterns });
        });
    }

    if (resetExclusionsBtn && exclusionPatternsInput) {
        resetExclusionsBtn.addEventListener('click', () => {
            const defaultExclusions = ['node_modules', 'out', 'dist', 'target', 'build', 'coverage', '.git', '.gemini', '.cache', 'venv', '.venv'];
            exclusionPatternsInput.value = defaultExclusions.join(', ');
            vscode.postMessage({ type: 'saveExclusionPatterns', patterns: defaultExclusions });
        });
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'exclusionPatternsLoaded') {
            if (exclusionPatternsInput && Array.isArray(message.patterns)) {
                exclusionPatternsInput.value = message.patterns.join(', ');
            }
        }
    });
})();
