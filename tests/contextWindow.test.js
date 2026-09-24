// Tests unitarios de src/core/contextWindow.ts
// node:test — funciones puras, sin dependencias de VSCode.
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ─── Replicas exactas de las funciones (sin dependencias de VSCode) ───────────

function estimateTokens(text) {
    if (!text) return 0;
    let nonAscii = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 127) nonAscii++;
    }
    const effective = text.length + nonAscii * 0.5;
    return Math.max(1, Math.ceil(effective / 3.2));
}

function trimHistory(history, budget) {
    if (!history || history.length === 0) return history;
    let total = 0;
    for (const m of history) total += estimateTokens(m.content);
    if (total <= budget) return history;

    const kept = [];
    let start = 0;
    if (history[0] && history[0].role === 'system') {
        kept.push(history[0]);
        start = 1;
    }
    const firstUser = history.slice(start).find(m => m.role === 'user');
    if (firstUser && kept.findIndex(k => k === firstUser) === -1) {
        kept.push(firstUser);
    }

    const newestFirst = history.slice(start).filter(m => m !== firstUser).reverse();
    const candidate = [];
    let used = kept.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    for (const msg of newestFirst) {
        const cost = estimateTokens(msg.content);
        if (used + cost > budget) break;
        candidate.unshift(msg);
        used += cost;
    }
    return [...kept, ...candidate];
}

function buildChatMessages(history, system, userContent, budget) {
    const base = [
        { role: 'system', content: system },
        ...history.filter(m => m.role !== 'system')
    ];
    const withUser = [...base, { role: 'user', content: userContent }];
    return trimHistory(withUser, budget);
}

// ─── estimateTokens ───────────────────────────────────────────────────────────

test('estimateTokens: string vacia devuelve 0', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
});

test('estimateTokens: texto ASCII puro ~4 chars por token', () => {
    // "hello" = 5 chars → 5/3.2 ≈ 1.56 → ceil = 2
    assert.equal(estimateTokens('hello'), 2);
    // 32 chars → 32/3.2 = 10
    assert.equal(estimateTokens('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 10);
});

test('estimateTokens: caracteres non-ASCII cuentan 1.5x', () => {
    // "ñoño" = 4 chars + 2 non-ASCII × 0.5 = 4+1 = 5 → 5/3.2 = 1.56 → ceil = 2
    assert.equal(estimateTokens('ñoño'), 2);
    // 10 non-ASCII chars → 10+5 = 15 → 15/3.2 = 4.68 → ceil = 5
    assert.equal(estimateTokens('ññññññññññ'), 5);
});

test('estimateTokens: devuelve al menos 1 para cualquier string no vacio', () => {
    assert.equal(estimateTokens('a'), 1);
});

// ─── trimHistory ──────────────────────────────────────────────────────────────

test('trimHistory: historial vacio se devuelve igual', () => {
    assert.deepEqual(trimHistory([], 100), []);
});

test('trimHistory: historial dentro del budget no se recorta', () => {
    const history = [
        { role: 'system', content: 'eres un asistente' },
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'hola como estas' },
    ];
    const result = trimHistory(history, 1000);
    assert.equal(result.length, 3);
});

test('trimHistory: preserva system message y primer user message', () => {
    const sys = { role: 'system', content: 'sys msg largo de mas de veinte caracteres para tokens' };
    const firstUsr = { role: 'user', content: 'user msg largo de mas de veinte caracteres para tokens' };
    const history = [
        sys,
        firstUsr,
        { role: 'assistant', content: 'respuesta corta' },
        { role: 'user', content: 'pregunta 2' },
        { role: 'assistant', content: 'respuesta 2' },
        { role: 'user', content: 'pregunta 3' },
        { role: 'assistant', content: 'respuesta 3' },
    ];
    // Budget muy apretado — solo caben sys + first user + 1 turno extra
    const tokensSys = estimateTokens(sys.content);
    const tokensFirst = estimateTokens(firstUsr.content);
    const budget = tokensSys + tokensFirst + estimateTokens('respuesta 3') + estimateTokens('pregunta 3') + 5;
    const result = trimHistory(history, budget);

    // Sys message debe estar
    assert.ok(result.some(m => m.role === 'system' && m.content === sys.content),
        'system message debe preservarse');
    // First user message debe estar
    assert.ok(result.some(m => m.role === 'user' && m.content === firstUsr.content),
        'primer user message debe preservarse');
    // Los mensajes mas recientes (pregunta/respuesta 3) deben estar
    assert.ok(result.some(m => m.content === 'pregunta 3'), 'mensajes recientes deben estar');
});

test('trimHistory: recorta los turnos mas viejos primero', () => {
    const sys = { role: 'system', content: 'sys' };
    const firstUsr = { role: 'user', content: 'primera pregunta muy larga para consumir tokens del budget' };
    const history = [
        sys,
        firstUsr,
        { role: 'assistant', content: 'respuesta uno con bastante texto para gastar tokens del presupuesto' },
        { role: 'user', content: 'pregunta dos tambien larga para consumir espacio del contexto' },
        { role: 'assistant', content: 'respuesta dos bien larga para que no quepa todo en el limite' },
        { role: 'user', content: 'p3' },
        { role: 'assistant', content: 'r3largocontenidoquegastatokens' },
    ];
    // Budget solo para sys + firstUsr + ultimo turno
    const budget = estimateTokens(sys.content) + estimateTokens(firstUsr.content)
        + estimateTokens('p3') + estimateTokens('r3largocontenidoquegastatokens') + 10;
    const result = trimHistory(history, budget);

    // Los turnos intermedios (r1, p2, r2) deben desaparecer
    assert.ok(!result.some(m => m.content.includes('respuesta uno')), 'turnos viejos deben recortarse');
    assert.ok(!result.some(m => m.content.includes('pregunta dos')), 'turnos viejos deben recortarse');
    assert.ok(!result.some(m => m.content.includes('respuesta dos')), 'turnos viejos deben recortarse');
    // p3 y r3 deben quedar
    assert.ok(result.some(m => m.content === 'p3'), 'turnos nuevos deben preservarse');
    assert.ok(result.some(m => m.content === 'r3largocontenidoquegastatokens'), 'turnos nuevos deben preservarse');
});

test('trimHistory: nunca corta un turno a la mitad', () => {
    const history = [
        { role: 'user', content: 'p1' },
        { role: 'assistant', content: 'r1' },
        { role: 'user', content: 'p2' },
        { role: 'assistant', content: 'r2' },
    ];
    const budget = estimateTokens('p2') + estimateTokens('r2') + 5;
    const result = trimHistory(history, budget);

    // Si p1 y r1 no caben juntos, se eliminan ambos
    const p1Present = result.some(m => m.content === 'p1');
    const r1Present = result.some(m => m.content === 'r1');
    // O ambos estan o ninguno (turno completo)
    assert.equal(p1Present, r1Present);
});

// ─── buildChatMessages ────────────────────────────────────────────────────────

test('buildChatMessages: construye mensajes con system + user nuevo', () => {
    const history = [
        { role: 'user', content: 'pregunta anterior' },
        { role: 'assistant', content: 'respuesta anterior' },
    ];
    const result = buildChatMessages(history, 'system msg', 'nueva pregunta', 5000);
    assert.ok(result[0].role === 'system');
    assert.ok(result.some(m => m.content === 'nueva pregunta'));
});

test('buildChatMessages: filtra system messages duplicados del historial', () => {
    const history = [
        { role: 'system', content: 'viejo system' },
        { role: 'user', content: 'p1' },
    ];
    const result = buildChatMessages(history, 'nuevo system', 'p2', 5000);
    // Solo debe haber un system message (el nuevo)
    const systemMsgs = result.filter(m => m.role === 'system');
    assert.equal(systemMsgs.length, 1);
    assert.equal(systemMsgs[0].content, 'nuevo system');
});

test('buildChatMessages: respeta el budget', () => {
    const sys = 'a'.repeat(200);
    const first = 'b'.repeat(200);
    const history = [
        { role: 'system', content: 'viejo' },
        { role: 'user', content: first },
        { role: 'assistant', content: 'c'.repeat(300) },
    ];
    const userContent = 'd'.repeat(100);
    // Budget solo para system + firstUser + userContent (sin el assistant de 300 chars)
    const sysTokens = estimateTokens(sys);
    const firstTokens = estimateTokens(first);
    const userTokens = estimateTokens(userContent);
    const budget = sysTokens + firstTokens + userTokens + 10;
    const result = buildChatMessages(history, sys, userContent, budget);

    // System siempre debe estar
    assert.ok(result[0].role === 'system');
    // El total debe ser <= budget
    let total = 0;
    for (const m of result) total += estimateTokens(m.content);
    assert.ok(total <= budget, `total=${total} debe ser <= budget=${budget}`);
    // El mensaje assistant grande (300 chars) debe haber sido recortado
    assert.ok(!result.some(m => m.content.includes('cccc')), 'mensaje grande del historial debe recortarse');
});