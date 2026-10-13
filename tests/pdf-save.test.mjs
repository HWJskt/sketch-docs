// src/pdf/save.ts with in-memory file handles, a scripted exporter, a recorded lock and recovery store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from '../src/pdf/save.ts';
import { fingerprint } from '../src/fileAccess.ts';

const bytes = text => new TextEncoder().encode(text);
const text = data => new TextDecoder().decode(data);
const hashOf = async data => fingerprint(new Blob([data]));

function handle(initial, { failWrite = false, failCreate = false } = {}) {
    let contents = bytes(initial);
    const log = [];
    return {
        log, contents: () => text(contents),
        set(value) { contents = bytes(value); },
        async getFile() { return new Blob([contents]); },
        async createWritable() {
            log.push('open');
            if (failCreate) throw new DOMException('denied', 'NotAllowedError');
            let pending;
            return {
                async write(data) { log.push('write'); if (failWrite) throw new Error('disk full'); pending = data; },
                async close() { log.push('close'); contents = pending; },
                async abort() { log.push('abort'); },
            };
        },
    };
}
function setup({ refuse, hold } = {}) {
    const events = [];
    const exporter = { async run(original, annotations) {
        events.push(`export ${annotations.length}`);
        if (hold) await hold;
        if (refuse) return { id: 1, ok: false, reason: refuse };
        return { id: 1, ok: true, bytes: bytes(`${text(original)}+${annotations.map(item => item.id).join(',')}`) };
    } };
    const lock = async work => { events.push('lock'); try { return await work(); } finally { events.push('unlock'); } };
    const kept = [];
    const recovery = { failing: false, async keep(name, data, hash) { events.push(`keep ${name}`); if (this.failing) throw new Error('quota'); kept.push({ name, data: text(data), hash }); } };
    return { events, kept, recovery, saver: createSaver({ exporter, lock, recovery }) };
}
const job = async (target, extra = {}) => ({ epoch: 1, revision: 3, name: 'a.pdf', original: bytes('orig'), annotations: [{ id: 'n1' }], handle: target, hash: await hashOf(bytes(target.contents())), overwrite: true, ...extra });

test('overwriting: the original is kept for recovery once, then the export is written inside the lock', async () => {
    const { saver, events, kept } = setup();
    const file = handle('orig');
    const first = await saver.save(await job(file));
    assert.equal(first.ok, true);
    assert.equal(file.contents(), 'orig+n1');
    assert.deepEqual(kept, [{ name: 'a.pdf', data: 'orig', hash: await hashOf(bytes('orig')) }]);
    assert.deepEqual(events, ['export 1', 'lock', 'keep a.pdf', 'unlock']);
    assert.equal(first.hash, await hashOf(bytes('orig+n1')));
    assert.deepEqual([first.epoch, first.revision], [1, 3]);
    const second = await saver.save(await job(file, { original: bytes('orig+n1'), revision: 4 }));
    assert.equal(second.ok, true);
    assert.equal(kept.length, 1, 'the recovery copy is the file before the first overwrite');
});

test('if the recovery copy cannot be kept, the file is not opened for writing', async () => {
    const { saver, recovery } = setup();
    recovery.failing = true;
    const file = handle('orig');
    const outcome = await saver.save(await job(file));
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /원본을 보관하지 못해/);
    assert.deepEqual(file.log, []);
    assert.equal(file.contents(), 'orig');
});

test('Save As writes a new file without a recovery copy', async () => {
    const { saver, kept } = setup();
    const target = handle('');
    const outcome = await saver.save(await job(target, { overwrite: false }));
    assert.equal(outcome.ok, true);
    assert.equal(target.contents(), 'orig+n1');
    assert.deepEqual(kept, []);
});

test('a refused export writes nothing', async () => {
    const { saver, events } = setup({ refuse: '서명된 PDF는 저장하지 않습니다.' });
    const file = handle('orig');
    const outcome = await saver.save(await job(file));
    assert.deepEqual([outcome.ok, outcome.reason], [false, '서명된 PDF는 저장하지 않습니다.']);
    assert.deepEqual(file.log, []);
    assert.deepEqual(events, ['export 1']);
});

test('a file changed by another tab or program after opening is refused inside the lock', async () => {
    const { saver } = setup();
    const file = handle('orig');
    const request = await job(file);
    file.set('saved by another tab');
    const outcome = await saver.save(request);
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /외부에서 변경/);
    assert.equal(file.contents(), 'saved by another tab');
});

test('permission refusal and write failures leave the file as it was', async () => {
    for (const failure of [{ failCreate: true }, { failWrite: true }]) {
        const { saver } = setup();
        const file = handle('orig', failure);
        const outcome = await saver.save(await job(file));
        assert.equal(outcome.ok, false);
        assert.equal(file.contents(), 'orig');
    }
});

test('saves run one at a time; a queued save starts from what the previous one wrote', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const { saver, events } = setup({ hold });
    const file = handle('orig');
    // The editor's state after each save: the base bytes and hash the next save starts from.
    let base = { original: bytes('orig'), hash: await hashOf(bytes('orig')) };
    const request = (annotations, revision) => () => ({ epoch: 1, revision, name: 'a.pdf', annotations, handle: file, overwrite: true, ...base });
    const settle = outcome => { if (outcome.ok) base = { original: outcome.bytes, hash: outcome.hash }; return outcome; };
    const first = saver.save(request([{ id: 'n1' }], 3)).then(settle);
    const second = saver.save(request([{ id: 'n1' }, { id: 'n2' }], 5)).then(settle);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(events, ['export 1'], 'the second save waits for the first');
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual([one.ok, two.ok], [true, true]);
    assert.equal(file.contents(), 'orig+n1+n1,n2');
    assert.deepEqual(events, ['export 1', 'lock', 'keep a.pdf', 'unlock', 'export 2', 'lock', 'unlock']);
});

test('a save built before the previous one finished (stale base) is refused, not written over it', async () => {
    const { saver } = setup();
    const file = handle('orig');
    const stale = await job(file);
    assert.equal((await saver.save(await job(file))).ok, true);
    const outcome = await saver.save(stale);
    assert.equal(outcome.ok, false);
    assert.equal(file.contents(), 'orig+n1');
});
