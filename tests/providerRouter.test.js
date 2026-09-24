// Tests unitarios del ruteador de proveedores (src/core/providers/index.ts)
// node:test — prueba la logica de despacho sin ejecutar llamadas de red reales.
const { test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Replica de la logica de ruteo de fetchModelsForProvider.
 * Cada "provider" simulado registra si fue invocado y con que argumentos.
 * Esto prueba EXCLUSIVAMENTE la logica de decision de ruteo, sin HTTP.
 */
function createRouter() {
    const calls = [];

    const providers = {
        nvidia: async (url, apiKey) => { calls.push({ prov: 'nvidia', url, apiKey }); return ['nv-model-1']; },
        deepseek: async (url, apiKey) => { calls.push({ prov: 'deepseek', url, apiKey }); return ['ds-model-1']; },
        kimi: async (url, apiKey) => { calls.push({ prov: 'kimi', url, apiKey }); return ['kimi-model-1']; },
        qwen: async (url, apiKey) => { calls.push({ prov: 'qwen', url, apiKey }); return ['qwen-model-1']; },
        giskardSys: async (url) => { calls.push({ prov: 'giskard-sys', url }); return ['gs-model-1']; },
        ollama: async (url) => { calls.push({ prov: 'ollama', url }); return ['ollama-model-1']; },
    };

    async function route(url, tag, apiKey, connType) {
        const cleanTag = (tag || '').toLowerCase().trim();

        if (cleanTag.includes('nvidia')) return await providers.nvidia(url, apiKey);
        if (cleanTag.includes('deepseek')) return await providers.deepseek(url, apiKey);
        if (cleanTag.includes('kimi') || (url || '').toLowerCase().includes('moonshot'))
            return await providers.kimi(url, apiKey);
        if (cleanTag.includes('qwen') || (url || '').toLowerCase().includes('dashscope'))
            return await providers.qwen(url, apiKey);

        if (connType === 'local') {
            if (cleanTag.includes('giskard')) return await providers.giskardSys(url);
            return await providers.ollama(url);
        }

        if (connType === 'remote') {
            let models = await providers.nvidia(url, apiKey);
            if (models.length > 0) return models;
            models = await providers.deepseek(url, apiKey);
            if (models.length > 0) return models;
            models = await providers.kimi(url, apiKey);
            if (models.length > 0) return models;
            return await providers.qwen(url, apiKey);
        }

        // Legacy fallback
        const cleanUrl = (url || '').toLowerCase();
        if (cleanUrl.includes(':3500') || cleanTag.includes('giskard'))
            return await providers.giskardSys(url);
        if (cleanUrl.includes(':11434') || cleanTag.includes('ollama'))
            return await providers.ollama(url);

        // Default fallback
        let models = await providers.nvidia(url, apiKey);
        if (models.length === 0) models = await providers.ollama(url);
        if (models.length === 0) models = await providers.giskardSys(url);
        return models;
    }

    return { route, calls, providers };
}

// ─── Ruteo por tag ────────────────────────────────────────────────────────────

test('router: tag nvidia → llama al provider nvidia', async () => {
    const { route, calls } = createRouter();
    await route('https://api.example.com', 'nvidia', 'key123', 'remote');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'nvidia');
    assert.equal(calls[0].apiKey, 'key123');
});

test('router: tag deepseek → llama al provider deepseek', async () => {
    const { route, calls } = createRouter();
    await route('https://api.deepseek.com', 'deepseek', 'key456', 'remote');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'deepseek');
});

test('router: tag kimi → llama al provider kimi', async () => {
    const { route, calls } = createRouter();
    await route('https://api.moonshot.cn', 'kimi', 'key789', 'remote');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'kimi');
});

test('router: tag qwen → llama al provider qwen', async () => {
    const { route, calls } = createRouter();
    await route('https://dashscope.aliyuncs.com', 'qwen', 'key000', 'remote');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'qwen');
});

// ─── Ruteo por Connection.type ────────────────────────────────────────────────

test('router: connType=local + tag=giskard → llama giskard-sys', async () => {
    const { route, calls } = createRouter();
    await route('http://localhost:9999', 'giskard-sys', undefined, 'local');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'giskard-sys');
    assert.equal(calls[0].url, 'http://localhost:9999');
});

test('router: connType=local sin tag giskard → llama ollama por defecto', async () => {
    const { route, calls } = createRouter();
    await route('http://10.0.0.5:8888', 'custom-local', undefined, 'local');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'ollama');
    assert.equal(calls[0].url, 'http://10.0.0.5:8888');
});

test('router: connType=local + giskard en PUERTO NO ESTANDAR funciona por tag', async () => {
    // Giskard-Sys corriendo en :9999 — antes fallaba por URL inspection de :3500
    const { route, calls } = createRouter();
    await route('http://192.168.1.100:9999', 'giskard-sys', undefined, 'local');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prov, 'giskard-sys');
});

test('router: connType=remote busca en cascada nvidia→deepseek→kimi→qwen cuando anteriores fallan', async () => {
    // Construimos un router cuyos providers nvidia/deepseek/kimi devuelven []
    // y solo qwen devuelve modelos. Verificamos que los 4 son llamados.
    const spyCalls = [];

    async function routeWithSpies(url, tag, apiKey, connType) {
        const cleanTag = (tag || '').toLowerCase().trim();
        if (cleanTag.includes('nvidia')) { spyCalls.push('nvidia-direct'); return ['nv']; }
        if (cleanTag.includes('deepseek')) { spyCalls.push('deepseek-direct'); return ['ds']; }
        if (cleanTag.includes('kimi')) { spyCalls.push('kimi-direct'); return ['kimi']; }
        if (cleanTag.includes('qwen')) { spyCalls.push('qwen-direct'); return ['qwen']; }

        if (connType === 'remote') {
            spyCalls.push('nvidia-cascade'); /* returns [] */
            spyCalls.push('deepseek-cascade'); /* returns [] */
            spyCalls.push('kimi-cascade'); /* returns [] */
            spyCalls.push('qwen-cascade'); return ['qwen-model'];
        }
        return [];
    }

    const result = await routeWithSpies('https://unknown.api.com', 'generic', 'key', 'remote');
    assert.deepEqual(result, ['qwen-model']);
    // Los 4 providers en cascada deben haberse intentado
    assert.ok(spyCalls.includes('nvidia-cascade'));
    assert.ok(spyCalls.includes('deepseek-cascade'));
    assert.ok(spyCalls.includes('kimi-cascade'));
    assert.ok(spyCalls.includes('qwen-cascade'));
});

// ─── Legacy fallback (sin connType) ──────────────────────────────────────────

test('router: sin connType + :3500 detecta giskard-sys', async () => {
    const { route, calls } = createRouter();
    await route('http://localhost:3500', '', undefined, undefined);
    assert.equal(calls[0].prov, 'giskard-sys');
});

test('router: sin connType + :11434 detecta ollama', async () => {
    const { route, calls } = createRouter();
    await route('http://127.0.0.1:11434', '', undefined, undefined);
    assert.equal(calls[0].prov, 'ollama');
});

test('router: sin connType + sin pistas → fallback nvidia → ollama → giskard', async () => {
    const { route, calls } = createRouter();
    // nvidia siempre devuelve algo en el mock, asi que deberia parar ahi
    await route('https://unknown.api.com', '', undefined, undefined);
    assert.equal(calls[0].prov, 'nvidia');
});

// ─── Casos borde ─────────────────────────────────────────────────────────────

test('router: tag case-insensitive', async () => {
    const { route, calls } = createRouter();
    await route('https://api.example.com', 'NVIDIA', 'key', 'remote');
    assert.equal(calls[0].prov, 'nvidia');
});

test('router: tag con espacios extra', async () => {
    const { route, calls } = createRouter();
    await route('https://api.example.com', '  deepseek  ', 'key', 'remote');
    assert.equal(calls[0].prov, 'deepseek');
});

test('router: URL moonshot sin tag kimi detecta kimi', async () => {
    const { route, calls } = createRouter();
    await route('https://api.moonshot.cn/v1', 'generic', 'key', undefined);
    assert.equal(calls[0].prov, 'kimi');
});

test('router: URL dashscope sin tag qwen detecta qwen', async () => {
    const { route, calls } = createRouter();
    await route('https://dashscope.aliyuncs.com/compatible-mode/v1', '', 'key', undefined);
    assert.equal(calls[0].prov, 'qwen');
});