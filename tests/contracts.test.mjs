import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, writeArtifact } from '../src/hangulFiles.ts';

const artifact = (text = 'saved') => ({
  bytes: new TextEncoder().encode(text),
  contentLoss: { schemaVersion: 1, outputFormat: 'hwpx', count: 0, losses: [] },
  version: { epoch: 1, revision: 2, dirty: true },
});
function handleFor(initial, failWrite = false) {
  let bytes = new TextEncoder().encode(initial);
  const events = [];
  return {
    events,
    async getFile() { return new File([bytes], 'test.hwpx'); },
    async createWritable() {
      events.push('create');
      let staged;
      return {
        async write(value) { events.push('write'); if (failWrite) throw new Error('disk full'); staged = value; },
        async close() { events.push('close'); bytes = staged; },
        async abort() { events.push('abort'); },
      };
    },
  };
}

test('successful write stores the exact artifact only after the original fingerprint matches', async () => {
  const handle = handleFor('before');
  const before = await fingerprint(await handle.getFile());
  await writeArtifact(handle, artifact('한글 & 😀'), before);
  assert.equal(await (await handle.getFile()).text(), '한글 & 😀');
  assert.deepEqual(handle.events, ['create', 'write', 'close']);
  assert.notEqual(await fingerprint(await handle.getFile()), before);
});

test('loss reports and external modifications prevent opening a writable stream', async () => {
  for (const report of [
    { schemaVersion: 2, count: 0, losses: [] },
    { schemaVersion: 1, count: 1, losses: [] },
    { schemaVersion: 1, count: 0, losses: [{ kind: 'unsupported' }] },
  ]) {
    const handle = handleFor('original');
    const value = artifact(); value.contentLoss = { ...value.contentLoss, ...report };
    await assert.rejects(writeArtifact(handle, value, await fingerprint(await handle.getFile())), /내용 손실/);
    assert.deepEqual(handle.events, []);
    assert.equal(await (await handle.getFile()).text(), 'original');
  }
  const changed = handleFor('external edit');
  await assert.rejects(writeArtifact(changed, artifact(), await fingerprint(new File(['original'], 'test.hwpx'))), /외부에서 변경/);
  assert.deepEqual(changed.events, []);
  assert.equal(await (await changed.getFile()).text(), 'external edit');
});

test('failed writing aborts the stream and retains the previous file', async () => {
  const handle = handleFor('original', true);
  await assert.rejects(writeArtifact(handle, artifact(), await fingerprint(await handle.getFile())), /disk full/);
  assert.deepEqual(handle.events, ['create', 'write', 'abort']);
  assert.equal(await (await handle.getFile()).text(), 'original');
});


test('file shortcuts use native Mac and Windows modifiers, including Korean keyboard codes', async () => {
  const { fileShortcut, shortcutLabel } = await import('../src/hangulShortcuts.ts');
  for (const mac of [true, false]) {
    const base = {key:'ㄴ',code:'KeyS',metaKey:mac,ctrlKey:!mac,shiftKey:false,altKey:false,isComposing:false};
    assert.equal(fileShortcut(base, mac), 'save');
    assert.equal(fileShortcut({...base,shiftKey:true}, mac), 'saveAs');
    assert.equal(fileShortcut({...base,code:'KeyO'}, mac), 'open');
    assert.equal(fileShortcut({...base,code:'KeyP'}, mac), 'print');
    assert.equal(fileShortcut({...base,isComposing:true}, mac), null);
    assert.equal(fileShortcut({...base,altKey:true}, mac), null);
    assert.equal(fileShortcut({...base,metaKey:!mac,ctrlKey:mac}, mac), null);
  }
  assert.equal(shortcutLabel('save', true), '⌘S');
  assert.equal(shortcutLabel('saveAs', true), '⌘⇧S');
  assert.equal(shortcutLabel('open', false), 'Ctrl+O');
});

test('upstream replacements insert overlay text literally, including $ sequences', async () => {
  const { exact } = await import('../scripts/build-engines.mjs');
  assert.equal(exact('a<x>b', '<x>', "s.replace(/$&$'$`$1/, '$$')"), "as.replace(/$&$'$`$1/, '$$')b");
  assert.throws(() => exact('<x><x>', '<x>', 'y'), /Upstream contract changed/);
  assert.throws(() => exact('none', '<x>', 'y'), /Upstream contract changed/);
});
