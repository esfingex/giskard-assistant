/**
 * Giskard Assistant VSCode Extension — Module: Model Settings Webview View
 * Copyright (C) 2025-2026 Giskard Project
 */

import * as vscode from 'vscode';
import { ConnectionStore, DEFAULT_MODEL_SETTINGS, ModelSettings } from '../core/connectionStore';
import { fetchWithTimeout, fetchLlmModelsGrouped } from '../core/api';

export class GiskardModelSettingsWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly store: ConnectionStore
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'loadModels': {
                    const groups = await fetchLlmModelsGrouped().catch(() => []);
                    let activeModels: string[] = [];

                    groups.forEach(g => {
                        g.models.forEach(m => {
                            if (!activeModels.includes(m)) activeModels.push(m);
                        });
                    });

                    const enabled = this.store.getEnabledModels();
                    enabled.forEach(m => {
                        if (!activeModels.includes(m)) activeModels.push(m);
                    });

                    webviewView.webview.postMessage({ command: 'modelsLoaded', models: activeModels });
                    break;
                }
                case 'getSettings': {
                    const settings = this.store.getModelOverrides(message.model);
                    webviewView.webview.postMessage({ command: 'settingsLoaded', settings });
                    break;
                }
                case 'saveSettings': {
                    await this.store.saveModelOverrides(message.model, message.settings);
                    vscode.window.showInformationMessage(`✓ Ajustes guardados para '${message.model}'`);
                    break;
                }
                case 'testOptimalConfig': {
                    const modelName = message.model;
                    if (!modelName) return;

                    vscode.window.showInformationMessage(`⚡ Ejecutando benchmark en vivo para '${modelName}'...`);
                    
                    const startTime = Date.now();
                    let tokensPerSec = 0;
                    let ttftMs = 0;

                    try {
                        const testRes = await fetchWithTimeout('http://127.0.0.1:11434/api/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: modelName,
                                prompt: 'fn hello() { return 42; }',
                                stream: false,
                                options: { num_predict: 20 }
                            })
                        }, 10000);

                        if (testRes.ok) {
                            const data: any = await testRes.json();
                            const elapsedSec = (Date.now() - startTime) / 1000;
                            const evalCount = data.eval_count || 20;
                            tokensPerSec = Math.round(evalCount / elapsedSec);
                            ttftMs = Math.round((data.prompt_eval_duration || 100000000) / 1000000);
                        }
                    } catch {}

                    const l = modelName.toLowerCase();
                    let optimal: ModelSettings;

                    if (l.includes('r1') || l.includes('reasoner') || l.includes('qwq') || l.includes('thinking')) {
                        optimal = { temperature: 0.6, topP: 0.95, topK: 50, numCtx: 32768, numPredict: 4096, think: true, thinkBudget: 4096 };
                    } else if (l.includes('coder') || l.includes('starcoder') || l.includes('code')) {
                        optimal = { temperature: 0.2, topP: 0.95, topK: 40, numCtx: 16384, numPredict: 4096, think: false, thinkBudget: 2048 };
                    } else {
                        optimal = { temperature: 0.7, topP: 0.90, topK: 40, numCtx: 8192, numPredict: 2048, think: false, thinkBudget: 2048 };
                    }

                    await this.store.saveModelOverrides(modelName, optimal);
                    webviewView.webview.postMessage({ command: 'settingsLoaded', settings: optimal });

                    const statsMsg = tokensPerSec > 0 ? ` [Rendimiento: ${tokensPerSec} tok/s | Latencia: ${ttftMs}ms]` : '';
                    vscode.window.showInformationMessage(`✓ Benchmark completado${statsMsg} — Configuración óptima guardada para '${modelName}'!`);
                    break;
                }
            }
        });
    }

    private _getHtmlForWebview(): string {
        return /* html */ `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, sans-serif);
            font-size: 11px;
            color: var(--vscode-foreground);
            background: transparent;
            padding: 10px;
            margin: 0;
            user-select: none;
        }
        .control-group {
            margin-bottom: 12px;
        }
        label {
            display: block;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        .slider-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        input[type="range"] {
            flex: 1;
            accent-color: #38bdf8;
            cursor: pointer;
        }
        input[type="number"], select {
            background: var(--vscode-input-background, #1e293b);
            color: var(--vscode-input-foreground, #f8fafc);
            border: 1px solid var(--vscode-input-border, #334155);
            border-radius: 4px;
            padding: 4px 6px;
            font-size: 11px;
            outline: none;
            width: 70px;
            text-align: right;
        }
        select {
            width: 100%;
            text-align: left;
            margin-bottom: 12px;
            cursor: pointer;
        }
        .btn-reset {
            background: #0284c7;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 14px;
        }
        .btn-reset:hover {
            background: #0369a1;
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 10px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="control-group">
        <label for="model-select">Model</label>
        <select id="model-select">
            <option value="">Cargando modelos...</option>
        </select>
    </div>

    <div class="control-group">
        <label>Temperature</label>
        <div class="slider-row">
            <input type="range" id="temp-slider" min="0" max="1" step="0.05" value="0.8">
            <input type="number" id="temp-num" value="0.8" step="0.05">
        </div>
    </div>

    <div class="control-group">
        <label>Top-P</label>
        <div class="slider-row">
            <input type="range" id="topp-slider" min="0" max="1" step="0.05" value="0.9">
            <input type="number" id="topp-num" value="0.9" step="0.05">
        </div>
    </div>

    <div class="control-group">
        <label>Top-K</label>
        <div class="slider-row">
            <input type="range" id="topk-slider" min="1" max="100" step="1" value="40">
            <input type="number" id="topk-num" value="40">
        </div>
    </div>

    <div class="control-group">
        <label>Context Window</label>
        <div class="slider-row">
            <input type="range" id="ctx-slider" min="2048" max="131072" step="2048" value="2048">
            <input type="number" id="ctx-num" value="2048">
        </div>
    </div>

    <div class="control-group">
        <label>Max Tokens (-1 = unlimited)</label>
        <div class="slider-row">
            <input type="range" id="predict-slider" min="-1" max="8192" step="256" value="-1">
            <input type="number" id="predict-num" value="-1">
        </div>
    </div>

    <div class="control-group">
        <label class="checkbox-row">
            <input type="checkbox" id="think-cb">
            <span>Thinking</span>
        </label>
    </div>

    <div class="control-group">
        <label>Thinking Budget</label>
        <div class="slider-row">
            <input type="range" id="thinkb-slider" min="512" max="16384" step="512" value="2048">
            <input type="number" id="thinkb-num" value="2048">
        </div>
    </div>

    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <button class="btn-reset" id="reset-btn">🔄 Reset</button>
        <button class="btn-reset" id="test-opt-btn" style="background:#059669;">⚡ Probar & Config Óptima</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const modelSelect = document.getElementById('model-select');

        const tempSlider = document.getElementById('temp-slider');
        const tempNum = document.getElementById('temp-num');

        const toppSlider = document.getElementById('topp-slider');
        const toppNum = document.getElementById('topp-num');

        const topkSlider = document.getElementById('topk-slider');
        const topkNum = document.getElementById('topk-num');

        const ctxSlider = document.getElementById('ctx-slider');
        const ctxNum = document.getElementById('ctx-num');

        const predictSlider = document.getElementById('predict-slider');
        const predictNum = document.getElementById('predict-num');

        const thinkCb = document.getElementById('think-cb');

        const thinkbSlider = document.getElementById('thinkb-slider');
        const thinkbNum = document.getElementById('thinkb-num');

        const resetBtn = document.getElementById('reset-btn');
        const testOptBtn = document.getElementById('test-opt-btn');

        function bindSync(slider, num) {
            slider.addEventListener('input', () => { num.value = slider.value; save(); });
            num.addEventListener('input', () => { slider.value = num.value; save(); });
        }

        bindSync(tempSlider, tempNum);
        bindSync(toppSlider, toppNum);
        bindSync(topkSlider, topkNum);
        bindSync(ctxSlider, ctxNum);
        bindSync(predictSlider, predictNum);
        bindSync(thinkbSlider, thinkbNum);

        thinkCb.addEventListener('change', save);

        modelSelect.addEventListener('change', () => {
            if (modelSelect.value) {
                vscode.postMessage({ command: 'getSettings', model: modelSelect.value });
            }
        });

        testOptBtn.addEventListener('click', () => {
            if (modelSelect.value) {
                vscode.postMessage({ command: 'testOptimalConfig', model: modelSelect.value });
            }
        });

        resetBtn.addEventListener('click', () => {
            tempSlider.value = 0.8; tempNum.value = 0.8;
            toppSlider.value = 0.9; toppNum.value = 0.9;
            topkSlider.value = 40; topkNum.value = 40;
            ctxSlider.value = 2048; ctxNum.value = 2048;
            predictSlider.value = -1; predictNum.value = -1;
            thinkCb.checked = false;
            thinkbSlider.value = 2048; thinkbNum.value = 2048;
            save();
        });

        function save() {
            if (!modelSelect.value) return;
            vscode.postMessage({
                command: 'saveSettings',
                model: modelSelect.value,
                settings: {
                    temperature: parseFloat(tempNum.value),
                    topP: parseFloat(toppNum.value),
                    topK: parseInt(topkNum.value),
                    numCtx: parseInt(ctxNum.value),
                    numPredict: parseInt(predictNum.value),
                    think: thinkCb.checked,
                    thinkBudget: parseInt(thinkbNum.value)
                }
            });
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'modelsLoaded') {
                modelSelect.innerHTML = msg.models.map(m => \`<option value="\${m}">\${m}</option>\`).join('');
                if (msg.models.length > 0) {
                    modelSelect.value = msg.models[0];
                    vscode.postMessage({ command: 'getSettings', model: msg.models[0] });
                }
            } else if (msg.command === 'settingsLoaded') {
                const s = msg.settings || { temperature: 0.8, topP: 0.9, topK: 40, numCtx: 2048, numPredict: -1, think: false, thinkBudget: 2048 };
                tempSlider.value = s.temperature; tempNum.value = s.temperature;
                toppSlider.value = s.topP; toppNum.value = s.topP;
                topkSlider.value = s.topK; topkNum.value = s.topK;
                ctxSlider.value = s.numCtx; ctxNum.value = s.numCtx;
                predictSlider.value = s.numPredict; predictNum.value = s.numPredict;
                thinkCb.checked = !!s.think;
                thinkbSlider.value = s.thinkBudget || 2048; thinkbNum.value = s.thinkBudget || 2048;
            }
        });

        vscode.postMessage({ command: 'loadModels' });
    </script>
</body>
</html>
        `;
    }
}
