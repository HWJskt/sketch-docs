// src/xlsxBridge.ts against a fake engine window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createXlsxBridge, MAX_XLSX_BYTES, PROTOCOL } from '../src/xlsxBridge.ts';

const origin = 'https://docs.example';
function setup(options = {}) {
    const sent = [], events = { ready: [], failed: [], blocked: [], shown: [] };
    const engine = { postMessage: (data, to) => sent.push({ data, to }) };
    const bridge = createXlsxBridge({ target: () => engine, origin, timeoutMs: 50, onReady: v => events.ready.push(v), onFailed: e => events.failed.push(e), onBlocked: a => events.blocked.push(a), onShown: r => events.shown.push(r.name), ...options });
    const from = (data, extra = {}) => bridge.handle({ source: engine, origin, data: { protocol: PROTOCOL, ...data }, ...extra });
    return { bridge, engine, sent, events, from };
}
const bytes = new Uint8Array([1, 2, 3]);

test('only the engine frame on this origin, in this protocol, is heard', () => {
    const { bridge, engine, events, from } = setup();
    assert.equal(bridge.handle({ source: {}, origin, data: { protocol: PROTOCOL, type: 'sketch-xlsx:ready' } }), false, 'another window');
    assert.equal(bridge.handle({ source: engine, origin: 'https://evil.example', data: { protocol: PROTOCOL, type: 'sketch-xlsx:ready' } }), false, 'another origin');
    assert.equal(from({ type: 'sketch-xlsx:ready', protocol: 1 }), false, 'another protocol (the view-only bridge before editing)');
    assert.equal(bridge.ready, false);
    assert.equal(from({ type: 'sketch-xlsx:ready', version: '0.7.0' }), true);
    assert.equal(bridge.ready, true);
    assert.deepEqual(events.ready, ['0.7.0']);
});

test('an open waits for its own answer; answers to other requests are ignored', async () => {
    const { bridge, sent, from } = setup();
    from({ type: 'sketch-xlsx:ready' });
    const opening = bridge.open('a.xlsx', bytes);
    const { data, to } = sent[0];
    assert.equal(to, origin);
    assert.deepEqual({ ...data, bytes: [...new Uint8Array(data.bytes)] }, { type: 'sketch-xlsx:open', protocol: PROTOCOL, requestId: 1, epoch: 1, name: 'a.xlsx', bytes: [1, 2, 3] });
    assert.deepEqual([...bytes], [1, 2, 3], 'the caller keeps its bytes (a copy is transferred)');
    from({ type: 'sketch-xlsx:opened', requestId: 0, epoch: 1, ok: true, name: 'old.xlsx' });
    assert.equal(bridge.busy, true);
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'a.xlsx', sheets: ['품목', '메모'], warnings: [], docUid: 4 });
    assert.deepEqual(await opening, { ok: true, name: 'a.xlsx', sheets: ['품목', '메모'], warnings: [], docUid: 4 });
    assert.equal(bridge.busy, false);
});

test('a newer open supersedes an older one, and the older answer cannot replace it', async () => {
    const { bridge, from } = setup();
    from({ type: 'sketch-xlsx:ready' });
    const first = bridge.open('first.xlsx', bytes);
    const second = bridge.open('second.xlsx', bytes);
    assert.equal((await first).code, 'superseded');
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'first.xlsx' });
    assert.equal(bridge.busy, true, 'the first answer does not settle the second request');
    from({ type: 'sketch-xlsx:opened', requestId: 2, epoch: 2, ok: false, code: 'password', error: 'needs a password' });
    assert.deepEqual(await second, { ok: false, code: 'password', error: 'needs a password' });
});

test('a timeout reports failure, and a late answer still says what is shown, once', async () => {
    const { bridge, events, from } = setup();
    from({ type: 'sketch-xlsx:ready' });
    assert.equal((await bridge.open('slow.xlsx', bytes)).code, 'timeout');
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'slow.xlsx' });
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'slow.xlsx' });
    assert.deepEqual(events.shown, ['slow.xlsx']);
});

test('nothing is sent before the engine is ready or for a file over the limit; failures and refusals are reported', async () => {
    const { bridge, sent, events, from } = setup();
    assert.equal((await bridge.open('a.xlsx', bytes)).code, 'not-ready');
    from({ type: 'sketch-xlsx:ready' });
    assert.equal((await bridge.open('big.xlsx', { byteLength: MAX_XLSX_BYTES + 1 })).code, 'too-large');
    assert.equal(sent.length, 0);
    from({ type: 'sketch-xlsx:blocked', action: 'save', count: 1 });
    assert.deepEqual(events.blocked, ['save']);
    const opening = bridge.open('a.xlsx', bytes);
    from({ type: 'sketch-xlsx:failed', error: 'no WebGL' });
    assert.equal((await opening).code, 'error');
    assert.deepEqual(events.failed, ['no WebGL']);
    assert.equal(bridge.ready, false);
});

test('the shell learns which workbook the engine shows from every answer, even one it stopped waiting for', async () => {
    const shown = [];
    const { bridge, from } = setup({ onShown: result => shown.push(result.name) });
    from({ type: 'sketch-xlsx:ready' });
    assert.equal((await bridge.open('a.xlsx', bytes)).code, 'timeout');
    const second = bridge.open('b.xlsx', bytes);
    // The engine answers in order: the slow A opened, then B failed and A stays shown.
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'a.xlsx', sheets: ['A'] });
    from({ type: 'sketch-xlsx:opened', requestId: 2, epoch: 2, ok: false, code: 'error', error: 'bad' });
    assert.equal((await second).code, 'error');
    assert.deepEqual(shown, ['a.xlsx']);
    // An answer older than one already applied cannot move the shown workbook back.
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'a.xlsx' });
    assert.deepEqual(shown, ['a.xlsx']);
});

test('a snapshot resolves with its own answer only, and times out without one', async () => {
    const { bridge, sent, from } = setup();
    assert.deepEqual(await bridge.snapshot(), { ok: false, code: 'not-ready', error: 'Excel이 아직 준비되지 않았습니다.' });
    from({ type: 'sketch-xlsx:ready' });
    const opening = bridge.open('a.xlsx', bytes);
    from({ type: 'sketch-xlsx:opened', requestId: 1, epoch: 1, ok: true, name: 'a.xlsx', sheets: ['A'], warnings: [] });
    await opening;
    const taking = bridge.snapshot();
    const asked = sent.at(-1).data;
    assert.deepEqual(asked, { type: 'sketch-xlsx:snapshot', protocol: PROTOCOL, requestId: 2, epoch: 1 });
    from({ type: 'sketch-xlsx:snapshot', requestId: 2, epoch: 0, ok: true, docUid: 9, bytes: new Uint8Array([9]).buffer });
    from({ type: 'sketch-xlsx:snapshot', requestId: 3, epoch: 1, ok: true, docUid: 9, bytes: new Uint8Array([9]).buffer });
    from({ type: 'sketch-xlsx:snapshot', requestId: 2, epoch: 1, ok: true, docUid: 7, rev: 3, bytes: new Uint8Array([4, 5]).buffer });
    const result = await taking;
    assert.deepEqual({ ...result, bytes: [...result.bytes] }, { ok: true, id: 2, docUid: 7, rev: 3, bytes: [4, 5] });
    const failing = bridge.snapshot();
    from({ type: 'sketch-xlsx:snapshot', requestId: 3, epoch: 1, ok: false, error: 'No workbook is open.' });
    assert.deepEqual(await failing, { ok: false, code: 'error', error: 'No workbook is open.' });
    assert.equal((await bridge.snapshot()).code, 'timeout');
});

test('editing: the engine state and requests reach the shell; saved and discard name a snapshot; exports wait for their answer', async () => {
    const states = [], requests = [], blocked = [];
    const { bridge, sent, from } = setup({ onState: s => states.push(s), onRequest: r => requests.push(r), onBlocked: (a, c) => blocked.push([a, c]) });
    from({ type: 'sketch-xlsx:ready', mode: 'edit' });
    from({ type: 'sketch-xlsx:state', dirty: true, editing: false, rev: 2 });
    assert.deepEqual(states, [{ dirty: true, editing: false, rev: 2 }]);
    from({ type: 'sketch-xlsx:request', action: 'save' });
    from({ type: 'sketch-xlsx:request', action: 'open', name: 'b.xlsx', bytes: new Uint8Array([7]).buffer });
    from({ type: 'sketch-xlsx:request', action: 'format-disk' });
    assert.deepEqual(requests.map(r => r.file ? { ...r, file: { ...r.file, bytes: [...r.file.bytes] } } : r), [{ action: 'save' }, { action: 'open', file: { name: 'b.xlsx', bytes: [7] } }], 'an unknown action is not passed on');
    from({ type: 'sketch-xlsx:blocked', action: 'refused', command: 'file.new' });
    assert.deepEqual(blocked, [['refused', 'file.new']]);
    bridge.saved(5, 7);
    bridge.discard(6);
    assert.deepEqual(sent.slice(-2).map(m => m.data), [{ type: 'sketch-xlsx:saved', protocol: PROTOCOL, requestId: 5, epoch: 0, docUid: 7, name: undefined }, { type: 'sketch-xlsx:discard', protocol: PROTOCOL, requestId: 6 }]);
    const exporting = bridge.exportFile('csv');
    const asked = sent.at(-1).data;
    assert.deepEqual(asked, { type: 'sketch-xlsx:export', protocol: PROTOCOL, requestId: 1, epoch: 0, format: 'csv' });
    from({ type: 'sketch-xlsx:exported', requestId: 1, epoch: 0, ok: true, bytes: new Uint8Array([65]).buffer });
    const result = await exporting;
    assert.deepEqual({ ...result, bytes: [...result.bytes] }, { ok: true, bytes: [65] });
    assert.equal((await bridge.exportFile('pdf')).code, 'timeout');
});
