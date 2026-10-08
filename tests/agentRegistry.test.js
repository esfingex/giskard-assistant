// Tests unitarios del Agent Registry (src/core/agentRegistry.ts)
// node:test — lógica pura con fake de estado (sin vscode).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const reg = require('../out/core/agentRegistry.js');

function fakeState(initial = []) {
    let runs = initial;
    return {
        get: () => runs,
        set: (r) => {
            runs = r;
        }
    };
}

test('addRun: crea run en cola con id y createdAt', () => {
    const state = fakeState();
    const run = reg.addRun(state, { name: 'tarea', task: 'hacer X', model: 'm' });
    assert.equal(run.status, 'queued');
    assert.ok(run.id.startsWith('run_'));
    assert.ok(run.createdAt);
    assert.equal(state.get().length, 1);
});

test('listRuns: más recientes primero', () => {
    const state = fakeState([
        { id: 'a', name: 'A', task: 'x', model: 'm', status: 'done', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', name: 'B', task: 'y', model: 'm', status: 'queued', createdAt: '2026-02-01T00:00:00Z' }
    ]);
    const list = reg.listRuns(state);
    assert.equal(list[0].id, 'b');
    assert.equal(list[1].id, 'a');
});

test('updateRun: parchea el run y devuelve null si no existe', () => {
    const state = fakeState();
    const run = reg.addRun(state, { name: 'n', task: 't', model: 'm' });
    const upd = reg.updateRun(state, run.id, { status: 'running' });
    assert.equal(upd.status, 'running');
    assert.equal(reg.getRun(state, run.id).status, 'running');
    assert.equal(reg.updateRun(state, 'no-existe', { status: 'done' }), null);
});

test('removeRun: elimina solo el run pedido', () => {
    const state = fakeState();
    const a = reg.addRun(state, { name: 'a', task: 't', model: 'm' });
    const b = reg.addRun(state, { name: 'b', task: 't', model: 'm' });
    reg.removeRun(state, a.id);
    assert.deepEqual(state.get().map((r) => r.id), [b.id]);
});
