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
const job = async (file, { overwrite = true, ...extra } = {}) => {
    const hash = await hashOf(bytes(file.contents()));
    return { epoch: 1, revision: 3, name: 'a.pdf', original: bytes('orig'), annotations: [{ id: 'n1' }], target: async () => ({ handle: file, hash, overwrite }), ...extra };
};

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
    const request = (annotations, revision) => () => ({ epoch: 1, revision, name: 'a.pdf', annotations, original: base.original, target: async () => ({ handle: file, hash: base.hash, overwrite: true }) });
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

test('a target changed elsewhere is refused before the recovery store is touched', async () => {
    const { saver, events, kept } = setup();
    const file = handle('orig');
    const request = await job(file);
    file.set('saved by another tab');
    assert.equal((await saver.save(request)).ok, false);
    assert.deepEqual(kept, []);
    assert.ok(!events.some(event => event.startsWith('keep')));
});

test('the target is asked for only after the export passed, and a cancelled choice writes nothing', async () => {
    const order = [];
    const exporter = { async run() { order.push('export'); return { id: 1, ok: true, bytes: bytes('out') }; } };
    const saver = createSaver({ exporter, lock: work => work(), recovery: { async keep() { order.push('keep'); } } });
    const outcome = await saver.save({ epoch: 1, revision: 1, name: 'a.pdf', original: bytes('orig'), annotations: [], target: async () => { order.push('target'); return null; } });
    assert.deepEqual([outcome.ok, outcome.cancelled], [false, true]);
    assert.deepEqual(order, ['export', 'target']);
    const refused = { async run() { return { id: 1, ok: false, reason: 'refused' }; } };
    let asked = false;
    await createSaver({ exporter: refused, lock: work => work(), recovery: { async keep() {} } }).save({ epoch: 1, revision: 1, name: 'a.pdf', original: bytes('orig'), annotations: [], target: async () => { asked = true; return null; } });
    assert.equal(asked, false, 'a refused export never opens the picker (it would empty an existing file)');
});

test('an exporter or a target that throws is a refusal, not an exception', async () => {
    const recovery = { async keep() {} };
    const broken = createSaver({ exporter: { run() { throw new Error('no worker'); } }, lock: work => work(), recovery });
    const one = await broken.save({ epoch: 1, revision: 1, name: 'a.pdf', original: bytes('o'), annotations: [], target: async () => null });
    assert.equal(one.ok, false); assert.match(one.reason, /no worker/);
    const { saver } = setup();
    const two = await saver.save({ ...(await job(handle('orig'))), target: async () => { throw new Error('picker failed'); } });
    assert.equal(two.ok, false); assert.match(two.reason, /picker failed/);
});

test('choosing the opened file in Save As keeps the original in memory for recovery, though the picker emptied it', async () => {
    const { saver, kept } = setup();
    const file = handle('');
    const outcome = await saver.save({ epoch: 1, revision: 1, name: 'a.pdf', original: bytes('orig'), annotations: [{ id: 'n1' }], target: async () => ({ handle: file, hash: await hashOf(bytes('')), overwrite: true }) });
    assert.equal(outcome.ok, true);
    assert.equal(file.contents(), 'orig+n1');
    assert.deepEqual(kept.map(item => item.data), ['orig']);
    assert.equal(kept[0].hash, await hashOf(bytes('orig')));
});

test('loss confirmation happens after successful export and before target selection; rejection writes nothing', async () => {
    const { saver, events } = setup();
    const file = handle('');
    let picked = 0;
    const request = await job(file, { overwrite: false, confirm: async () => { events.push('confirm'); return false; }, target: async () => { picked++; return null; } });
    const result = await saver.save(request);
    assert.equal(result.cancelled, true);
    assert.equal(picked, 0);
    assert.deepEqual(events, ['export 1', 'confirm']);
});

const pickerJob = (file, extra = {}) => ({
    epoch: 7, revision: 9, name: 'a.pdf', original: bytes('reconstructed'), pickerOriginal: bytes('original on disk'), annotations: [{ id: 'n1' }],
    target: async () => { file.set(''); return { handle: file, picked: true }; }, ...extra,
});
test('page picker saves the disk original before selection and immediately writes reconstruction under the lock', async () => {
    const file = handle('original on disk'), order = [];
    let locked = false;
    const saver = createSaver({ exporter: { async run(data) { order.push('export'); assert.equal(text(data), 'reconstructed'); return { ok: true, bytes: bytes('exported pages') }; } },
        lock: async work => { locked = true; try { return await work(); } finally { locked = false; } },
        recovery: { async keep(name, data, hash) { assert.equal(locked, true); order.push('keep'); assert.equal(text(data), 'original on disk'); assert.equal(hash, await hashOf(data)); } } });
    const outcome = await saver.save(pickerJob(file, { confirm: async () => { order.push('confirm'); return true; }, target: async () => {
        assert.equal(locked, true); order.push('pick'); file.set('');
        file.getFile = () => { assert.fail('no post-picker validation'); };
        return { handle: file, picked: true };
    } }));
    assert.equal(outcome.ok, true); assert.equal(file.contents(), 'exported pages');
    assert.deepEqual(order, ['export', 'confirm', 'keep', 'pick']);
    assert.deepEqual([outcome.epoch, outcome.revision], [7, 9]);
});
test('page picker never opens after recovery failure, loss refusal, or export refusal', async () => {
    for (const scenario of ['recovery', 'loss', 'export']) {
        const { saver, recovery, kept } = setup({ refuse: scenario === 'export' ? 'blocked' : undefined });
        recovery.failing = scenario === 'recovery';
        let picks = 0; const file = handle('original on disk');
        const outcome = await saver.save(pickerJob(file, { confirm: async () => scenario !== 'loss', target: async () => { picks++; file.set(''); return { handle: file, picked: true }; } }));
        assert.equal(outcome.ok, false); assert.equal(picks, 0); assert.equal(file.contents(), 'original on disk');
        assert.deepEqual(file.log, []); assert.equal(kept.length, 0);
    }
});
test('page picker cancellation keeps the disk original and saved snapshot identifiers', async () => {
    const { saver, kept } = setup(); const file = handle('original on disk');
    const outcome = await saver.save(pickerJob(file, { target: async () => null }));
    assert.equal(outcome.cancelled, true); assert.deepEqual([outcome.epoch, outcome.revision], [7, 9]);
    assert.equal(file.contents(), 'original on disk'); assert.equal(kept[0].data, 'original on disk');
});
test('page picker write failures retry the memory original and report recovery success or failure', async () => {
    for (const phase of ['create', 'write', 'close']) for (const restoreFails of [false, true]) {
        const { saver } = setup(); const file = handle('original on disk'); const create = file.createWritable;
        let attempts = 0;
        file.createWritable = async () => {
            attempts++; const fail = attempts === 1 || restoreFails;
            if (phase === 'create' && fail) throw new Error('injected create');
            const stream = await create();
            if (fail) stream[phase] = async () => { throw new Error(`injected ${phase}`); };
            return stream;
        };
        const outcome = await saver.save(pickerJob(file));
        assert.equal(outcome.ok, false); assert.equal(attempts, 2);
        assert.match(outcome.reason, /injected/);
        assert.match(outcome.reason, restoreFails ? /되쓰기도 실패/ : /원본 바이트로 되돌렸/);
        assert.equal(file.contents(), restoreFails ? '' : 'original on disk');
    }
});
