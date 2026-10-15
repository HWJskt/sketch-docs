// src/xlsx/drafts.ts with an in-memory directory and Node's own Web Locks (one lock manager, as tabs of one origin share).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, draftKey, holdLock, DRAFT_FOLDER, DRAFT_LIMIT } from '../src/xlsx/drafts.ts';

function directory({ corrupt = false } = {}) {
    const files = new Map(), folders = new Map();
    return {
        files,
        async getDirectoryHandle(name) { if (!folders.has(name)) folders.set(name, directory({ corrupt })); return folders.get(name); },
        async getFileHandle(name, { create = false } = {}) {
            if (!files.has(name)) { if (!create) throw new DOMException('missing', 'NotFoundError'); files.set(name, new Uint8Array()); }
            return {
                kind: 'file',
                async getFile() { return new File([files.get(name)], name); },
                async createWritable() {
                    let pending;
                    return { async write(data) { pending = data; }, async close() { files.set(name, corrupt && name.endsWith('.xlsx') ? new Uint8Array([0]) : pending); }, async abort() {} };
                },
            };
        },
        async removeEntry(name) { if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError'); },
        async *[Symbol.asyncIterator]() { for (const name of [...files.keys()]) yield [name, { kind: 'file' }]; await this.afterList?.(); },
    };
}
const bytes = text => new TextEncoder().encode(text);
const meta = (name, source, tab) => ({ name, source, tab, engine: '0.1.0', docUid: 1, epoch: 1, rev: 3, snapshotMs: 12 });
// A lock let go is free a moment later, not at once.
const gone = () => new Promise(done => setTimeout(done, 10));
let tabs = 0;
// A tab: its own id and its copy's key, holding the lock as a live tab does.
async function tab(store, name = '매출.xlsx', source = 'a'.repeat(64), content = 'edited') {
    const id = `t${++tabs}`, key = draftKey(name, source, id);
    const release = await holdLock(key);
    await store.write(key, meta(name, source, id), bytes(content));
    return { key, release };
}

test('a written copy is listed with its description and reads back', async () => {
    const root = directory();
    const store = createDraftStore(async () => root);
    const live = await tab(store);
    const [draft] = await store.list();
    assert.deepEqual([draft.key, draft.name, draft.rev, draft.size], [live.key, '매출.xlsx', 3, 6]);
    assert.equal(new TextDecoder().decode(await store.read(draft)), 'edited');
    live.release();
});

test('a copy another tab holds is not claimed; once that tab is gone it is, by one tab only', async () => {
    const store = createDraftStore((root => async () => root)(directory()));
    const other = await tab(store);
    assert.equal(await store.claim('매출.xlsx', 'a'.repeat(64)), null, 'the editing tab still holds its copy');
    other.release();
    await gone();
    const claimed = await store.claim('매출.xlsx', 'a'.repeat(64));
    assert.equal(claimed?.draft.key, other.key);
    assert.equal(await store.claim('매출.xlsx', 'a'.repeat(64)), null, 'a claimed copy is not offered twice');
    claimed.release();
});

test('only copies of the same file (name and opened content) are claimed, never the tab\'s own', async () => {
    const store = createDraftStore((root => async () => root)(directory()));
    const own = await tab(store);
    for (const other of [await tab(store, '다른.xlsx'), await tab(store, '매출.xlsx', 'b'.repeat(64))]) other.release();
    own.release();
    await gone();
    assert.equal(await store.claim('매출.xlsx', 'a'.repeat(64), own.key), null);
});

test('a copy removed by its tab before the lock was taken is not claimed', async () => {
    const root = directory();
    const store = createDraftStore(async () => root);
    const other = await tab(store);
    // Its tab removes it and lets go right after the claiming tab read the list.
    const folder = await root.getDirectoryHandle(DRAFT_FOLDER);
    folder.afterList = async () => { folder.afterList = undefined; await store.remove(other.key); other.release(); await gone(); };
    assert.equal(await store.claim('매출.xlsx', 'a'.repeat(64)), null);
});

test('a copy that does not read back as written is removed and the write fails', async () => {
    const root = directory({ corrupt: true });
    const store = createDraftStore(async () => root);
    const key = draftKey('a.xlsx', 'c'.repeat(64), 'tx');
    await assert.rejects(store.write(key, meta('a.xlsx', 'c'.repeat(64), 'tx'), bytes('edited')), /다릅니다/);
    assert.deepEqual(await store.list(), []);
    assert.equal((await root.getDirectoryHandle(DRAFT_FOLDER)).files.size, 0);
});

test('a copy changed after it was written does not read', async () => {
    const root = directory();
    const store = createDraftStore(async () => root);
    const live = await tab(store);
    (await root.getDirectoryHandle(DRAFT_FOLDER)).files.set(`${live.key}.xlsx`, bytes('tampered'));
    await assert.rejects(store.read((await store.list())[0]), /손상/);
    live.release();
});

test('past the limit the oldest copies no tab holds are removed; held ones stay', async () => {
    const root = directory();
    const store = createDraftStore(async () => root);
    const held = await tab(store, 'held.xlsx');
    const written = [];
    for (let i = 0; i < DRAFT_LIMIT + 2; i++) {
        await gone();
        const copy = await tab(store, `${i}.xlsx`);
        copy.release();
        written.push(copy.key);
    }
    const keys = (await store.list()).map(d => d.key);
    // 13 written: the held one is the oldest and stays, so one more than the limit is left.
    assert.ok(keys.includes(held.key), 'the copy a live tab holds is kept past the limit');
    assert.equal(keys.length, DRAFT_LIMIT + 1, `${keys.length} copies`);
    assert.deepEqual(written.filter(key => !keys.includes(key)), written.slice(0, 2), 'the two oldest unheld copies went');
    held.release();
});

test('a workbook left without its description is removed by the next write, unless a tab holds it', async () => {
    const root = directory();
    const store = createDraftStore(async () => root);
    const folder = await root.getDirectoryHandle(DRAFT_FOLDER);
    folder.files.set('aaaaaaaaaaaaaaaa--gone--x.xlsx', bytes('left over'));
    const heldKey = 'bbbbbbbbbbbbbbbb--live--y';
    folder.files.set(`${heldKey}.xlsx`, bytes('being written'));
    const held = await holdLock(heldKey);
    const live = await tab(store);
    assert.ok(!folder.files.has('aaaaaaaaaaaaaaaa--gone--x.xlsx'), 'the orphan no tab holds went');
    assert.ok(folder.files.has(`${heldKey}.xlsx`), 'a tab still writing keeps its file');
    held();
    live.release();
});
