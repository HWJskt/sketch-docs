// src/pdf/exporter.ts with scripted workers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExporter } from '../src/pdf/exporter.ts';

function workers() {
    const started = [];
    const start = () => {
        const worker = { messages: [], terminated: false, onmessage: null, onerror: null,
            postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; },
            answer(result) { this.onmessage?.({ data: result }); } };
        started.push(worker);
        return worker;
    };
    return { started, start };
}
const bytes = new Uint8Array([1, 2, 3]);

test('a request resolves with the worker answer for its id', { timeout: 5000 }, async () => {
    const { started, start } = workers();
    const exporter = createExporter({ start });
    const pending = exporter.run(bytes, [{ id: 'a' }]);
    const [{ id }] = started[0].messages;
    started[0].answer({ id, ok: true, bytes: new Uint8Array([9]) });
    assert.deepEqual(await pending, { id, ok: true, bytes: new Uint8Array([9]) });
    assert.equal(started.length, 1);
});

test('a request over the limit is refused, the worker replaced, and its late answer ignored', { timeout: 5000 }, async () => {
    const { started, start } = workers();
    const exporter = createExporter({ start, limitMs: 50 });
    const slow = await exporter.run(bytes, []);
    assert.equal(slow.ok, false);
    assert.match(slow.reason, /초가 넘게 걸려 중단/);
    assert.equal(started[0].terminated, true);
    started[0].answer({ id: slow.id, ok: true, bytes });
    const next = exporter.run(bytes, []);
    assert.equal(started.length, 2, 'a new worker for the next save');
    const [{ id }] = started[1].messages;
    started[1].answer({ id, ok: true, bytes });
    assert.equal((await next).ok, true);
});

test('a worker error refuses what it was doing and the next save starts a new worker', { timeout: 5000 }, async () => {
    const { started, start } = workers();
    const exporter = createExporter({ start });
    const pending = exporter.run(bytes, []);
    started[0].onerror({ message: 'boom' });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.reason, /멈췄습니다\. boom/);
    void exporter.run(bytes, []);
    assert.equal(started.length, 2);
    exporter.dispose();
});

test('answers with an unknown id are ignored', { timeout: 5000 }, async () => {
    const { started, start } = workers();
    const exporter = createExporter({ start });
    const pending = exporter.run(bytes, []);
    started[0].answer({ id: 999, ok: true, bytes });
    const [{ id }] = started[0].messages;
    started[0].answer({ id, ok: false, reason: 'refused' });
    assert.deepEqual(await pending, { id, ok: false, reason: 'refused' });
});

test('the bytes sent are a copy, so the caller keeps the original', { timeout: 5000 }, async () => {
    const { started, start } = workers();
    const exporter = createExporter({ start });
    void exporter.run(bytes, []);
    assert.notEqual(started[0].messages[0].bytes, bytes);
    assert.deepEqual(started[0].messages[0].bytes, bytes);
    exporter.dispose();
});
