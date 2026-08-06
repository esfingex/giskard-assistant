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

function renderModelFilterList(ollamaModels) {
    const modelFilterList = document.getElementById('model-filter-list');
    if (!modelFilterList) return;
    lastDetectedModels = ollamaModels || [];
    
    const enabled = getEnabledModels();
    let html = '';

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

    modelFilterList.querySelectorAll('.model-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = [];
            modelFilterList.querySelectorAll('.model-filter-cb:checked').forEach(c => selected.push(c.value));
            setEnabledModels(selected);
            updateModelDropdown(lastDetectedModels);
        });
    });
}

function updateModelDropdown(ollamaModels) {
    const modelSelect = document.getElementById('model-select');
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
            if (m.includes('distill') || m.includes('kimi')) label += ' (Kimi+Opus 🧠 128K)';
            else if (m.includes('coder') || m.includes('code')) label += ' (Coder ⚡ 64K)';
            else if (m.includes('phi')) label += ' (Fast ⚡ 32K)';
            else if (m.includes('aya')) label += ' (Traductor 🌐 32K)';
            html += '<option value="' + escapeHtml(m) + '">' + escapeHtml(label) + '</option>';
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
