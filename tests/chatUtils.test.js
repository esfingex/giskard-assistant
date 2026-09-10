// Tests unitarios de media/chatUtils.js (wave 011)
// node:test + vm: cargan el script del webview sin DOM, sin dependencias.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'chatUtils.js'), 'utf8');
const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => {} }),
    console,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const parseToolCalls = sandbox.parseToolCalls;
const preprocessMarkdown = sandbox.preprocessMarkdown;
const normalizeThinkingTags = sandbox.normalizeThinkingTags;
const escapeHtml = sandbox.escapeHtml;

// ─── parseToolCalls ───────────────────────────────────────────────────────────

test('parseToolCalls: ambos formatos se parsean', () => {
    const text = 'Normal [TOOL_CALL] {"action":"read_file","path":"a.ts"} [/END_TOOL] ' +
        'y luego <tool_call>{"action":"list_dir","path":"src"}</tool_call>.';
    const { cleanText, toolCalls } = parseToolCalls(text);
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].action, 'read_file');
    assert.equal(toolCalls[1].action, 'list_dir');
    assert.ok(!cleanText.includes('[TOOL_CALL]'));
    assert.ok(!cleanText.includes('<tool_call>'));
});

test('parseToolCalls: delimitadores mezclados NO matchean', () => {
    // [TOOL_CALL] con cierre </tool_call> = formatos cruzados: se ignora
    const text = 'Inicio [TOOL_CALL] {"a":1} </tool_call> fin.';
    const { toolCalls } = parseToolCalls(text);
    assert.equal(toolCalls.length, 0);
});

test('parseToolCalls: JSON invalido se descarta sin romper', () => {
    const text = '<tool_call>no es json</tool_call> y [TOOL_CALL] {"action":"glob","pattern":"**/*.ts"} [/END_TOOL]';
    const { toolCalls } = parseToolCalls(text);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].action, 'glob');
});

test('parseToolCalls: texto vacio devuelve vacio', () => {
    const { cleanText, toolCalls } = parseToolCalls('');
    assert.equal(cleanText, '');
    assert.equal(toolCalls.length, 0);
});

// ─── preprocessMarkdown: alertas GitHub ───────────────────────────────────────

test('alertas multilinea: bloque completo dentro del div, sin ">" visible', () => {
    const out = preprocessMarkdown('> [!NOTE]\n> Informacion util\n> que sigue.\n\nTexto normal.');
    assert.ok(out.includes('markdown-alert-note'));
    assert.ok(!out.includes('> Informacion'), 'el ">" no debe quedar visible dentro del div');
    assert.ok(!out.includes('> que sigue'), 'las lineas de continuacion deben estar dentro del div');
    assert.ok(out.includes('Informacion util'));
    assert.ok(out.includes('que sigue.'));
    assert.ok(out.includes('Texto normal.'));
    // el div debe cerrarse despues del contenido de la alerta
    assert.ok(out.indexOf('que sigue.</div>') > out.indexOf('Informacion util'));
});

test('alertas: contenido HTML se escapa (sin inyeccion)', () => {
    const out = preprocessMarkdown('> [!NOTE] <img src=x onerror=alert(1)> cuidado');
    assert.ok(out.includes('&lt;img'), 'el HTML crudo debe quedar como texto literal');
    assert.ok(!out.includes('<img'), 'no debe inyectarse la etiqueta img');
    // el texto del atributo queda como literal inofensivo (no es una etiqueta)
    assert.ok(out.includes('onerror=alert(1)'));
});

test('alertas: marcado inline se preserva para marked', () => {
    const out = preprocessMarkdown('> [!TIP] usa **negrita** y `codigo`');
    assert.ok(out.includes('**negrita**'));
    assert.ok(out.includes('`codigo`'));
});

test('alertas: los 5 tipos existen', () => {
    // separadas por lineas en blanco (semantica GitHub: lineas ">" contiguas son un bloque)
    const text = '> [!NOTE] a\n\n> [!TIP] b\n\n> [!IMPORTANT] c\n\n> [!WARNING] d\n\n> [!CAUTION] e';
    const out = preprocessMarkdown(text);
    for (const t of ['note', 'tip', 'important', 'warning', 'caution']) {
        assert.ok(out.includes('markdown-alert-' + t), 'falta tipo ' + t);
    }
});

test('alertas: bloque de cita normal (sin alerta) no se toca', () => {
    const out = preprocessMarkdown('> una cita normal');
    assert.ok(!out.includes('markdown-alert'));
    assert.ok(out.includes('> una cita normal'));
});

// ─── normalizeThinkingTags ────────────────────────────────────────────────────

test('thinking: variantes se normalizan a <think>', () => {
    assert.equal(normalizeThinkingTags('<thinking>x</thinking>'), '<think>x</think>');
    assert.equal(normalizeThinkingTags('<thought>x</thought>'), '<think>x</think>');
    assert.equal(normalizeThinkingTags('&lt;thinking&gt;x&lt;/thinking&gt;'), '<think>x</think>');
    assert.equal(normalizeThinkingTags('&lt;thought&gt;x&lt;/thought&gt;'), '<think>x</think>');
    assert.equal(normalizeThinkingTags('&lt;think&gt;x&lt;/think&gt;'), '<think>x</think>');
});

test('thinking: NO toca bloques de codigo (fences)', () => {
    const code = 'Ejemplo:\n```xml\n<thinking>esto es un ejemplo</thinking>\n<response>hola</response>\n```';
    const out = normalizeThinkingTags(code);
    assert.ok(out.includes('<thinking>esto es un ejemplo</thinking>'), 'el code block no debe tocarse');
    assert.ok(!out.includes('<think>esto es un ejemplo</think>'));
});

test('thinking: NO toca codigo inline', () => {
    const out = normalizeThinkingTags('usa `<thinking>` literal');
    assert.ok(out.includes('`<thinking>`'));
});

test('thinking: mezcla de codigo y texto real', () => {
    const text = '<thinking>razono</thinking>\n```xml\n<thinking>ejemplo</thinking>\n```\nfin';
    const out = normalizeThinkingTags(text);
    assert.ok(out.includes('<think>razono</think>'));
    assert.ok(out.includes('<thinking>ejemplo</thinking>'));
});

// ─── escapeHtml ───────────────────────────────────────────────────────────────

test('escapeHtml: escapa entidades', () => {
    assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
    assert.equal(escapeHtml(''), '');
});
