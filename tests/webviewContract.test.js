/**
 * Drift guard — webviewContract.ts must stay the single source of truth.
 *
 * Assertions:
 *  1. Every message type SENT by the extension host (postMessage payloads in src/**.ts)
 *     exists in the HostToWebview contract.
 *  2. Every message type LISTENED for by the webview (case labels in media/*.js)
 *     exists in the contract OR in the documented dead-listener allowlist
 *     (listened but never sent — pending cleanup wave).
 *  3. Every message type SENT by the webview (vscode.postMessage in media/*.js)
 *     exists in the WebviewToHost contract.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// ── Allowlist (documented exceptions — every entry must justify itself) ─────
// Despachos internos de tool-calls en chatUtils.js (no son mensajes del host;
// envían toolSearch/toolGlob/toolExec, cubiertos por el contrato).
const DEAD_LISTENERS = new Set([
    'exec', 'glob', 'search'
]);

function readAll(dir, filter, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) readAll(full, filter, acc);
        else if (filter.test(entry.name)) acc.push(full);
    }
    return acc;
}

const contractSrc = fs.readFileSync(path.join(root, 'src/core/webviewContract.ts'), 'utf8');
const contractTypes = new Set(
    [...contractSrc.matchAll(/type:\s*'([a-zA-Z]+)'/g)].map(m => m[1])
);
assert.ok(contractTypes.size > 40, 'el contrato debe definir los dos union completos');

/** Collect `type: 'x'` sent inside postMessage payloads (bounded lookahead window). */
function collectSentTypes(file) {
    const src = fs.readFileSync(file, 'utf8');
    const types = [];
    let idx = 0;
    while ((idx = src.indexOf('postMessage(', idx)) !== -1) {
        const window = src.slice(idx, idx + 500);
        const m = window.match(/type:\s*'([a-zA-Z]+)'/);
        if (m) types.push(m[1]);
        idx += 12;
    }
    return types;
}

test('todo mensaje enviado por el host está en el contrato HostToWebview', () => {
    const files = readAll(path.join(root, 'src'), /\.ts$/);
    for (const file of files) {
        for (const t of collectSentTypes(file)) {
            assert.ok(
                contractTypes.has(t),
                `${path.relative(root, file)} envía type:'${t}' y NO está en webviewContract.ts`
            );
        }
    }
});

test('todo mensaje escuchado por el webview está en el contrato o en el allowlist', () => {
    const files = readAll(path.join(root, 'media'), /\.js$/);
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/case\s*'([a-zA-Z]+)'\s*:/g)) {
            const t = m[1];
            assert.ok(
                contractTypes.has(t) || DEAD_LISTENERS.has(t),
                `${path.relative(root, file)} escucha case '${t}' sin cobertura de contrato`
            );
        }
    }
});

test('todo mensaje enviado por el webview está en el contrato WebviewToHost', () => {
    const files = readAll(path.join(root, 'media'), /\.js$/);
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/vscode\.postMessage\(\s*\{\s*type:\s*'([a-zA-Z]+)'/g)) {
            const t = m[1];
            assert.ok(
                contractTypes.has(t) || DEAD_LISTENERS.has(t),
                `${path.relative(root, file)} envía vscode.postMessage type:'${t}' sin cobertura de contrato`
            );
        }
    }
});
