/**
 * Giskard Assistant VSCode Extension — Module: MCP Server UI Manager
 * Copyright (C) 2025-2026 Giskard Project
 */

function renderMcpServersList(servers) {
    const mcpServersListDiv = document.getElementById('mcp-servers-list');
    if (!mcpServersListDiv) return;
    if (!servers || servers.length === 0) {
        mcpServersListDiv.innerHTML = '<span style="font-size:9px;opacity:0.5;">Sin servidores MCP agregados</span>';
        return;
    }

    let html = '';
    servers.forEach(s => {
        const activeBadge = s.isActive
            ? `<button type="button" class="btn-tog-mcp" data-id="${s.id}" style="padding:1px 5px;font-size:9px;background:rgba(52,211,153,0.2);color:#34d399;border:1px solid #34d399;border-radius:3px;cursor:pointer;font-weight:bold;">🟢 Activo</button>`
            : `<button type="button" class="btn-tog-mcp" data-id="${s.id}" style="padding:1px 5px;font-size:9px;background:transparent;border:1px solid #94a3b8;color:#94a3b8;border-radius:3px;cursor:pointer;">⚪ Inactivo</button>`;

        let toolsHtml = '';
        if (s.tools && s.tools.length > 0) {
            toolsHtml += `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.1);display:flex;flex-direction:column;gap:3px;">
                <div style="font-size:9px;font-weight:bold;color:#38bdf8;">🛠️ Servicios/Herramientas Disponibles (${s.tools.filter(t=>t.enabled).length}/${s.tools.length}):</div>`;
            s.tools.forEach(t => {
                toolsHtml += `<label style="display:flex;align-items:center;gap:5px;font-size:9px;cursor:pointer;opacity:${t.enabled ? '1' : '0.5'};">
                    <input type="checkbox" class="mcp-tool-cb" data-server-id="${s.id}" data-tool-id="${escapeHtml(t.id)}" ${t.enabled ? 'checked' : ''}>
                    <strong style="color:${t.enabled ? '#34d399' : '#94a3b8'};">${escapeHtml(t.name)}</strong>
                    <span style="opacity:0.7;">— ${escapeHtml(t.description)}</span>
                </label>`;
            });
            toolsHtml += `</div>`;
        } else {
            toolsHtml += `<div style="margin-top:4px;">
                <button type="button" class="btn-disc-mcp" data-id="${s.id}" style="padding:1px 5px;font-size:9px;background:transparent;border:1px dashed #38bdf8;color:#38bdf8;border-radius:3px;cursor:pointer;">🔍 Escanear Servicios MCP</button>
            </div>`;
        }

        html += `<div style="display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,0.04);border:1px solid var(--vscode-input-border);padding:6px;border-radius:6px;font-size:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;flex-direction:column;gap:1px;overflow:hidden;flex:1;">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="filter-tag ${s.type === 'docker' ? 'ollama' : 'cli'}">${escapeHtml(s.type.toUpperCase())}</span>
                        <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</strong>
                    </div>
                    <span style="opacity:0.6;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.commandOrUrl)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-left:6px;">
                    ${activeBadge}
                    <button type="button" class="btn-disc-mcp" data-id="${s.id}" style="background:transparent;border:none;color:#38bdf8;font-size:11px;cursor:pointer;padding:0 2px;" title="Escanear/Refrescar Herramientas">🔍</button>
                    <button type="button" class="btn-del-mcp" data-id="${s.id}" style="background:transparent;border:none;color:#f87171;font-weight:bold;cursor:pointer;padding:0 2px;" title="Eliminar">✖</button>
                </div>
            </div>
            ${toolsHtml}
        </div>`;
    });

    mcpServersListDiv.innerHTML = html;

    mcpServersListDiv.querySelectorAll('.btn-tog-mcp').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (id) vscode.postMessage({ type: 'toggleMcpServer', id });
        });
    });

    mcpServersListDiv.querySelectorAll('.btn-disc-mcp').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (id) vscode.postMessage({ type: 'discoverMcpTools', serverId: id });
        });
    });

    mcpServersListDiv.querySelectorAll('.mcp-tool-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const serverId = parseInt(cb.getAttribute('data-server-id'), 10);
            const toolId = cb.getAttribute('data-tool-id');
            if (serverId && toolId) {
                vscode.postMessage({ type: 'toggleMcpTool', serverId, toolId });
            }
        });
    });

    mcpServersListDiv.querySelectorAll('.btn-del-mcp').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'), 10);
            if (id) vscode.postMessage({ type: 'removeMcpServer', id });
        });
    });
}

(function initMcpUI() {
    const mcpNameInp = document.getElementById('mcp-name');
    const mcpTypeSel = document.getElementById('mcp-type');
    const mcpCmdInp = document.getElementById('mcp-cmd');
    const addMcpBtn = document.getElementById('add-mcp-btn');
    const testMcpBtn = document.getElementById('test-mcp-btn');
    const mcpStatusDiv = document.getElementById('mcp-status');
    const importMcpConfigBtn = document.getElementById('import-mcp-config-btn');

    if (importMcpConfigBtn) {
        importMcpConfigBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'importMcpConfig' });
        });
    }

    if (testMcpBtn) {
        testMcpBtn.addEventListener('click', () => {
            const serverType = mcpTypeSel ? mcpTypeSel.value : 'docker';
            const commandOrUrl = mcpCmdInp ? mcpCmdInp.value.trim() : '';

            if (!commandOrUrl) {
                if (mcpStatusDiv) mcpStatusDiv.innerHTML = '<span style="color:#f87171;">⚠️ Ingresa un comando o URL para probar.</span>';
                return;
            }

            if (mcpStatusDiv) mcpStatusDiv.innerHTML = '<span style="color:#38bdf8;">⏳ Probando MCP...</span>';
            vscode.postMessage({
                type: 'testMcpServer',
                serverType,
                commandOrUrl
            });
        });
    }

    if (addMcpBtn) {
        addMcpBtn.addEventListener('click', () => {
            const name = mcpNameInp ? mcpNameInp.value.trim() : '';
            const serverType = mcpTypeSel ? mcpTypeSel.value : 'docker';
            const commandOrUrl = mcpCmdInp ? mcpCmdInp.value.trim() : '';

            if (!name || !commandOrUrl) {
                alert('Ingresa al menos un Nombre y un Comando/URL para el servidor MCP.');
                return;
            }

            vscode.postMessage({
                type: 'addMcpServer',
                name,
                serverType,
                commandOrUrl
            });

            if (mcpNameInp) mcpNameInp.value = '';
            if (mcpCmdInp) mcpCmdInp.value = '';
            if (mcpStatusDiv) mcpStatusDiv.innerHTML = '';
        });
    }
})();
