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

test('ko-sketch.json becomes a Rust match with escapes Rust accepts, and duplicates or blanks fail', async () => {
  const { koSketchSource } = await import('../scripts/gridcraft-build.mjs');
  const source = koSketchSource([{ en: 'Watch\nWindow', ko: '조사식\n창' }, { en: 'Say "hi"', ko: ' 분리' }]);
  assert.ok(source.includes('"Watch\\nWindow" => "조사식\\n창",'));
  assert.ok(source.includes('"Say \\"hi\\"" =>'));
  assert.ok(source.includes('_ => return None,'));
  assert.ok(!/\\u[0-9a-f]{4}/.test(source), 'JSON \\uXXXX escapes are rewritten as Rust \\u{XXXX}');
  assert.throws(() => koSketchSource([{ en: 'A', ko: '가' }, { en: 'A', ko: '나' }]), /listed twice/);
  assert.throws(() => koSketchSource([{ en: 'A', ko: '' }]), /bad entry/);
});

test('only display literals in widget calls are wrapped for translation', async () => {
  const { wrapLine } = await import('../scripts/xlsx-wrap-tr.mjs');
  const wrap = line => wrapLine(line).line;
  assert.equal(wrap('ui.label("Find what:");'), 'ui.label(crate::i18n::t("Find what:"));');
  assert.equal(wrap('ui.selectable_value(&mut by, "values".into(), "Cell Values");'), 'ui.selectable_value(&mut by, "values".into(), crate::i18n::t("Cell Values"));', 'the value argument stays');
  assert.equal(wrap('ui.label(lang.tr("Done"));'), 'ui.label(lang.tr("Done"));', 'already translated');
  assert.equal(wrap('ui.label(format!("{} of {}", a, b));'), 'ui.label(format!("{} of {}", a, b));');
  assert.equal(wrap('ui.label(format!("Rows: {n}", n = "All"));'), 'ui.label(format!("Rows: {n}", n = "All"));', 'inside format!');
  assert.equal(wrap('ui.hyperlink_to("Source", "https://example.invalid");'), 'ui.hyperlink_to(crate::i18n::t("Source"), "https://example.invalid");');
  assert.equal(wrap('let x = "Not a widget";'), 'let x = "Not a widget";');
  assert.equal(wrap('ui.label(egui::RichText::new("Recent").strong());'), 'ui.label(egui::RichText::new(crate::i18n::t("Recent")).strong());');
});
