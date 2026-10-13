// src/pdf/recovery.ts with an in-memory directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryStore, RECOVERY_FOLDER } from '../src/pdf/recovery.ts';
import { fingerprint } from '../src/fileAccess.ts';

function directory({ corrupt = false, failWrite = false, failCreate = false } = {}) {
    const files = new Map(), folders = new Map();
    const dir = {
        files,
        async getDirectoryHandle(name) { if (!folders.has(name)) folders.set(name, directory({ corrupt, failWrite, failCreate })); return folders.get(name); },
        async getFileHandle(name, { create = false } = {}) {
            if (!files.has(name)) { if (!create) throw new DOMException('missing', 'NotFoundError'); files.set(name, new Uint8Array()); }
            return {
                kind: 'file',
                async getFile() { return new File([files.get(name)], name); },
                async createWritable() {
                    if (failCreate) throw new DOMException('denied', 'NotAllowedError');
                    let pending;
                    return { async write(data) { if (failWrite) throw new Error('quota'); pending = data; }, async close() { files.set(name, corrupt ? new Uint8Array([0]) : pending); }, async abort() {} };
                },
            };
        },
        async removeEntry(name) { files.delete(name); },
        async *[Symbol.asyncIterator]() { for (const name of files.keys()) yield [name, { kind: 'file' }]; },
    };
    return dir;
}
const bytes = text => new TextEncoder().encode(text);
const hash = async text => fingerprint(new Blob([bytes(text)]));

test('a kept copy is listed and reads back as the original', async () => {
    const root = directory();
    const store = createRecoveryStore(async () => root);
    await store.keep('report.pdf', bytes('original'), await hash('original'));
    const [copy] = await store.list();
    assert.equal(copy.name, 'report.pdf');
    assert.equal(await (await store.read(copy.file)).text(), 'original');
});

test('the newest copy per file (name and content) and five copies in all are kept', async () => {
    const root = directory();
    const store = createRecoveryStore(async () => root);
    await store.keep('a.pdf', bytes('a1'), await hash('a1'));
    await store.keep('a.pdf', bytes('a1'), await hash('a1'));
    assert.equal((await store.list()).length, 1, 'the same file kept twice is one copy');
    for (const name of ['b', 'c', 'd', 'e', 'f']) await store.keep(`${name}.pdf`, bytes(name), await hash(name));
    const copies = await store.list();
    assert.deepEqual(copies.map(copy => copy.name), ['f.pdf', 'e.pdf', 'd.pdf', 'c.pdf', 'b.pdf']);
    assert.equal((await root.getDirectoryHandle(RECOVERY_FOLDER)).files.size, 5);
});

test('a copy that does not read back with the expected hash is removed and the keep fails', async () => {
    const root = directory({ corrupt: true });
    const store = createRecoveryStore(async () => root);
    await assert.rejects(store.keep('a.pdf', bytes('original'), await hash('original')), /원본과 다릅니다/);
    assert.deepEqual(await store.list(), []);
});

test('a failed write leaves no copy and the keep fails', async () => {
    const root = directory({ failWrite: true });
    const store = createRecoveryStore(async () => root);
    await assert.rejects(store.keep('a.pdf', bytes('original'), await hash('original')), /quota/);
    assert.deepEqual(await store.list(), []);
});

test('two different files with the same name keep their own copies', async () => {
    const root = directory();
    const store = createRecoveryStore(async () => root);
    await store.keep('report.pdf', bytes('from folder A'), await hash('from folder A'));
    await store.keep('report.pdf', bytes('from folder B'), await hash('from folder B'));
    const copies = await store.list();
    assert.equal(copies.length, 2);
    assert.deepEqual((await Promise.all(copies.map(async copy => (await store.read(copy.file)).text()))).sort(), ['from folder A', 'from folder B']);
});

test('a copy whose stream cannot be opened leaves nothing behind', async () => {
    const root = directory({ failCreate: true });
    const store = createRecoveryStore(async () => root);
    await assert.rejects(store.keep('a.pdf', bytes('original'), await hash('original')), /denied/);
    assert.deepEqual(await store.list(), []);
});
