// src/fileAccess.ts with in-memory file handles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, writeIfUnchanged } from '../src/fileAccess.ts';

function handle(text, { failWrite = false, failClose = false } = {}) {
    const log = [];
    let contents = text;
    return {
        log, contents: () => contents,
        async getFile() { return new Blob([contents]); },
        async createWritable() {
            log.push('open');
            let pending;
            return {
                async write(bytes) { log.push('write'); if (failWrite) throw new Error('disk full'); pending = new TextDecoder().decode(bytes); },
                async close() { log.push('close'); if (failClose) throw new Error('close failed'); contents = pending; },
                async abort() { log.push('abort'); },
            };
        },
    };
}
const bytes = text => new TextEncoder().encode(text);

test('a file changed outside the editor is not opened for writing', async () => {
    const file = handle('changed elsewhere');
    await assert.rejects(writeIfUnchanged(file, bytes('mine'), await fingerprint(new Blob(['as opened']))), /외부에서 변경/);
    assert.deepEqual(file.log, []);
    assert.equal(file.contents(), 'changed elsewhere');
});

test('an unchanged file is replaced when the stream closes', async () => {
    const file = handle('as opened');
    await writeIfUnchanged(file, bytes('saved'), await fingerprint(new Blob(['as opened'])));
    assert.deepEqual(file.log, ['open', 'write', 'close']);
    assert.equal(file.contents(), 'saved');
});

test('a failed write or close aborts the stream and leaves the file as it was', async () => {
    for (const failure of [{ failWrite: true }, { failClose: true }]) {
        const file = handle('as opened', failure);
        await assert.rejects(writeIfUnchanged(file, bytes('saved'), await fingerprint(new Blob(['as opened']))));
        assert.equal(file.log.at(-1), 'abort');
        assert.equal(file.contents(), 'as opened');
    }
});
