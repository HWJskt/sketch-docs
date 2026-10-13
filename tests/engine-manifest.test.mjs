import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cssRefs, engineManifest, entryRefs, wasmRefs } from '../scripts/engine-manifest.mjs';

test('entry references keep local scripts and styles only', () => {
  const html = '<script src="./theme.js"></script><link rel="stylesheet" href="./assets/a.css"><link rel="icon" href="./x.png"><a href="https://edentext.app/"></a><script type="module" crossorigin src="./assets/a.js"></script><script src="https://cdn.example/x.js"></script>';
  assert.deepEqual(entryRefs(html), ['./theme.js', './assets/a.css', './assets/a.js']);
});

test('WASM references are the hashed names Vite emits, not variable names', () => {
  assert.deepEqual(wasmRefs('x=new URL("rhwp_bg-DB8FleS8.wasm",import.meta.url);e.wasm;this.deps.wasm;"rhwp_bg-DB8FleS8.wasm"'), ['rhwp_bg-DB8FleS8.wasm']);
});

test('CSS references keep images and only the listed font families', () => {
  const css = '@font-face{font-family:Liberation Sans;src:url(./Sans-1.ttf)}@font-face{font-family:"Calibri";src:url(./Carlito.ttf)}@font-face{font-family:Inline;src:url(data:font/woff2;base64,AA)}.a{background:url(../images/icon.svg)}.b{background:url("data:image/svg+xml,%3Csvg%3E")}';
  assert.deepEqual(cssRefs(css, ['Liberation Sans']), ['./Sans-1.ttf', '../images/icon.svg']);
});

test('manifest lists required and warm files with sizes, and rejects missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-manifest-'));
  try {
    const put = async (path, text) => { await mkdir(join(dir, path, '..'), { recursive: true }); await writeFile(join(dir, path), text); };
    await put('engines/word/index.html', '<script type="module" src="./assets/w-12345678.js"></script><link rel="stylesheet" href="./assets/w.css">');
    await put('engines/word/assets/w-12345678.js', 'js');
    await put('engines/word/assets/w.css', '@font-face{font-family:Liberation Serif;src:url(./Serif.ttf)}');
    await put('engines/word/assets/Serif.ttf', 'font');
    await put('rhwp/index.html', '<script src="./init.js"></script><script type="module" src="./assets/r.js"></script><link href="./assets/r.css" rel="stylesheet">');
    await put('rhwp/init.js', 'i');
    await put('rhwp/assets/r.js', 'new URL("core-AbCdEfGh.wasm",import.meta.url)');
    await put('rhwp/assets/core-AbCdEfGh.wasm', 'wasm!');
    await put('rhwp/assets/r.css', '.i{background:url(../images/icon.svg)}');
    await put('rhwp/images/icon.svg', '<svg/>');
    const { engines } = await engineManifest(dir);
    assert.deepEqual(engines.word.required.map(file => file.path), ['engines/word/assets/w-12345678.js', 'engines/word/assets/w.css']);
    assert.deepEqual(engines.word.warm, [{ path: 'engines/word/assets/Serif.ttf', bytes: 4 }]);
    assert.deepEqual(engines.hwp.required.map(file => file.path), ['rhwp/assets/core-AbCdEfGh.wasm', 'rhwp/assets/r.css', 'rhwp/assets/r.js', 'rhwp/init.js']);
    assert.deepEqual(engines.hwp.warm.map(file => file.path), ['rhwp/images/icon.svg']);
    assert.equal(engines.hwp.requiredBytes, 5 + 39 + 44 + 1);
    await rm(join(dir, 'rhwp/assets/core-AbCdEfGh.wasm'));
    await assert.rejects(engineManifest(dir), /core-AbCdEfGh\.wasm is referenced but missing/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
