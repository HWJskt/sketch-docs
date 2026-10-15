import test from 'node:test';
import assert from 'node:assert/strict';
import { relocateAssets, toolVersionErrors } from '../scripts/gridcraft-build.mjs';

const pins = { rust: '1.99.0', trunk: '0.21.14', 'wasm-bindgen': '0.2.129', 'wasm-opt': '133' };
const lines = { rust: 'rustc 1.99.0 (b940084d7 2026-09-28)', trunk: 'trunk 0.21.14', 'wasm-bindgen': 'wasm-bindgen 0.2.129', 'wasm-opt': 'wasm-opt version 133' };

test('GridCraft builds only with the pinned tool versions', () => {
  assert.deepEqual(toolVersionErrors(pins, lines), []);
  assert.deepEqual(toolVersionErrors(pins, { ...lines, rust: 'rustc 1.92.0 (ded5c06cf 2025-12-08)' }), ['rust: need 1.99.0, found 1.92.0']);
  assert.deepEqual(toolVersionErrors(pins, { ...lines, trunk: '' }), ['trunk: need 0.21.14, found ""']);
  assert.equal(toolVersionErrors(pins, { ...lines, 'wasm-opt': 'wasm-opt version 134' }).length, 1);
});

test('Trunk output moves into assets/ with every reference, and unreferenced files stop the build', () => {
  const html = `<script type="module">import init from './app-1.js';\nawait init({ module_or_path: './app-1_bg.wasm' });</script><link rel="modulepreload" href="./app-1.js"><link rel="preload" href="./app-1_bg.wasm"><link rel="icon" href="./icon-2.ico">`;
  const moved = relocateAssets(html, ['app-1.js', 'app-1_bg.wasm', 'icon-2.ico']);
  assert.equal(moved.split('./assets/app-1.js').length - 1, 2);
  assert.equal(moved.split('./assets/app-1_bg.wasm').length - 1, 2);
  assert.ok(moved.includes('./assets/icon-2.ico'));
  assert.ok(!/["'(]\.\/app-1/.test(moved));
  assert.throws(() => relocateAssets(html, ['extra-3.js']), /does not reference extra-3\.js/);
  assert.throws(() => relocateAssets(html + '<a href="app-1.js">', ['app-1.js']), /without \.\//);
});
