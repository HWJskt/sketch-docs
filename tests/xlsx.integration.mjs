// The view-only Excel engine (GridCraft + overlays/gridcraft) in Chrome, driven through its bridge
// from a bare host page, so these checks hold whatever the product shell around it does.
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { assertTestLocale, launchArgs, testLocale } from './browser-locale.mjs';
import { resolve } from 'node:path';
import { brokenWorkbook, koreanWorkbook, otherWorkbook } from './xlsx-fixtures.mjs';
import { saveFailureEvidence } from './failure-evidence.mjs';
import { strFromU8, unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

const root = resolve(import.meta.dirname, '..');
const origin = 'http://localhost:4179';
const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:1200px;height:800px;border:0}</style>
<iframe id="engine" title="Excel" allow="clipboard-read; clipboard-write"></iframe>
<script>
  const frame = document.getElementById('engine');
  // ?mode=edit frames the editing engine; otherwise it is view-only.
  frame.src = './engines/gridcraft/index.html?host=sketch' + (new URLSearchParams(location.search).get('mode') === 'edit' ? '&mode=edit' : '');
  window.messages = [];
  addEventListener('message', event => { if (event.source === frame.contentWindow) messages.push(event.data); });
  // The engine's snapshot answer, with its bytes as a plain array (an ArrayBuffer does not survive page.evaluate).
  window.snapshot = (requestId, epoch) => new Promise(done => {
    const listen = event => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'sketch-xlsx:snapshot' || event.data.requestId !== requestId) return;
      removeEventListener('message', listen);
      done({ ...event.data, bytes: event.data.bytes instanceof ArrayBuffer ? [...new Uint8Array(event.data.bytes)] : null });
    };
    addEventListener('message', listen);
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:snapshot', protocol: 2, requestId, epoch }, location.origin);
  });
  window.post = message => frame.contentWindow.postMessage({ protocol: 2, ...message }, location.origin);
  window.send = (requestId, epoch, name, bytes, protocol = 2) => {
    const buffer = new Uint8Array(bytes).buffer;
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:open', protocol, requestId, epoch, name, bytes: buffer }, location.origin, [buffer]);
  };
</script>`;

// The first sheet's cells as a save writes them (engine output: values in <v>, strings shared).
function cellsOf(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const strings = [...strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join(''));
  const cells = {};
  for (const m of strFromU8(files['xl/worksheets/sheet1.xml']).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = /<v>([^<]*)<\/v>/.exec(m[3] ?? '')?.[1];
    cells[m[1]] = / t="s"/.test(m[2]) ? strings[Number(v)] : v;
  }
  return cells;
}

let server, browser, context;
// On a failure, every open page is kept: its screen, what has focus in it and in each of its frames, and the
// last messages the harness heard from the engine (verify's en-US round once timed out at "the refusals are
// reported" and two reruns passed; tests/failure-evidence.mjs).
async function keepEvidence(error) {
  for (const [i, open] of (context?.pages() ?? []).entries()) {
    await saveFailureEvidence({ name: `xlsx page ${i} ${new URL(open.url()).pathname}`, page: open, origin, error, extra: async () => ({
      focus: await Promise.all(open.frames().map(async frame => ({ frame: frame.url(), active: await frame.evaluate(() => {
        const e = document.activeElement;
        return e ? { tag: e.tagName, id: e.id || undefined, title: e.getAttribute('title') || undefined, hasFocus: document.hasFocus() } : null;
      }).catch(reason => String(reason)) }))),
      messages: await open.evaluate(() => (window.messages ?? []).slice(-15).map(m => ({ ...m, bytes: m.bytes ? `(${m.bytes.byteLength} bytes)` : undefined }))).catch(reason => String(reason)),
    }) });
  }
}
try {
  server = await preview({ root, build: { outDir: resolve(root, process.env.TEST_DIST || 'dist') }, preview: { host: 'localhost', port: 4179, strictPort: true } });
  browser = await chromium.launch({ channel: 'chrome', headless: true, ...launchArgs });
  // Service workers are blocked: once the shell registers one, its fetches bypass page.route (tests/regressions.mjs covers it).
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: testLocale || 'ko-KR', acceptDownloads: true, serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  await assertTestLocale(page);
  page.setDefaultTimeout(60000);
  const errors = [], external = new Set(), downloads = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('download', download => downloads.push(download.suggestedFilename()));
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url()); });
  await page.route(url => url.origin === origin && url.pathname === '/xlsx-harness.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: harness }));

  const messages = () => page.evaluate(() => window.messages);
  // The first engine message whose fields equal `fields`.
  const matches = (m, fields) => Object.entries(fields).every(([key, value]) => m[key] === value);
  const waitFor = async (fields, label) => {
    await page.waitForFunction(fields => window.messages.some(m => Object.entries(fields).every(([key, value]) => m[key] === value)), fields, { timeout: 60000 })
      .catch(async error => { throw new Error(`${label}: ${error.message}\n${JSON.stringify(await messages())}`); });
    return (await messages()).find(m => matches(m, fields));
  };
  const open = async (requestId, epoch, name, bytes) => {
    await page.evaluate(([r, e, n, b]) => window.send(r, e, n, b), [requestId, epoch, name, [...bytes]]);
    return waitFor({ type: 'sketch-xlsx:opened', requestId }, `answer to ${requestId}`);
  };
  const engine = page.locator('#engine');
  // A cell's text through the engine's own Copy (allowed in view-only). Right after refused keystrokes
  // the first Copy can leave the clipboard untouched (measured), so the cell is clicked again once.
  const copyOnce = async () => {
    await page.evaluate(() => navigator.clipboard.writeText('(empty)'));
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForFunction(async () => (await navigator.clipboard.readText()) !== '(empty)', null, { timeout: 5000 }).catch(() => {});
    return (await page.evaluate(() => navigator.clipboard.readText())).trim();
  };
  const cell = async address => {
    await select(address);
    const text = await copyOnce();
    if (text !== '(empty)') return text;
    await select(address === 'A1' ? 'B1' : 'A1');
    await select(address);
    return copyOnce();
  };
  // Clicks a cell (a selection, allowed in view-only) after leaving any in-cell editor. Positions are
  // GridCraft's default layout at this viewport: columns 51px from x=28, rows 16px from y=215.
  const select = async address => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
    await engine.click({ position: { x: 54 + 51 * column, y: 223 + 16.3 * row } });
  };

  await page.goto(origin + '/xlsx-harness.html');
  const ready = await waitFor({ type: 'sketch-xlsx:ready' }, 'ready');
  assert.equal(ready.protocol, 2);
  assert.equal(ready.mode, 'view');

  // Another protocol version is ignored.
  await page.evaluate(([b]) => window.send(99, 99, 'wrong.xlsx', b, 1), [[...koreanWorkbook()]]);
  const opened = await open(1, 1, '매출.xlsx', koreanWorkbook());
  assert.deepEqual({ ok: opened.ok, name: opened.name, sheets: opened.sheets, warnings: opened.warnings, epoch: opened.epoch, uid: typeof opened.docUid }, { ok: true, name: '매출.xlsx', sheets: ['매출', '메모'], warnings: [], epoch: 1, uid: 'number' });
  assert.equal((await messages()).filter(m => m.requestId === 99).length, 0, 'a message in another protocol is not answered');

  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'B2 holds the opened value');
  assert.equal(await cell('B4'), '3600', 'the formula result shows');
  await page.screenshot({ path: resolve(root, 'artifacts/xlsx-view.png') });

  // Edits, paste, cut, delete and save are refused; the workbook and the disk stay as opened.
  await select('B2');
  await page.keyboard.type('999');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await select('B2');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+x');
  await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  assert.equal(await cell('B2'), '1200', 'B2 is unchanged after typing, Delete, Cut and Paste');
  await waitFor({ type: 'sketch-xlsx:blocked', action: 'edit' }, 'the refusals are reported');
  assert.deepEqual(downloads, [], 'nothing was saved or downloaded');

  // A snapshot is the shown workbook as a save writes it; it opens again with the same sheets and values.
  const snapshot = await page.evaluate(() => window.snapshot(50, 1));
  assert.deepEqual({ ok: snapshot.ok, epoch: snapshot.epoch, uid: typeof snapshot.docUid, zip: snapshot.bytes?.slice(0, 4) }, { ok: true, epoch: 1, uid: 'number', zip: [0x50, 0x4b, 0x03, 0x04] });
  const again = await open(51, 51, '왕복.xlsx', snapshot.bytes);
  assert.deepEqual([again.ok, again.sheets, again.warnings], [true, ['매출', '메모'], []]);
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'the snapshot keeps B2');
  assert.equal(await cell('B4'), '3600', 'the snapshot keeps the formula result');

  // A file that cannot be opened leaves the shown workbook.
  const broken = await open(2, 2, 'broken.xlsx', brokenWorkbook());
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'error');
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('B2'), '1200', 'the shown workbook stays after a failed open');

  // Two opens in a row: each is answered, and the later workbook is shown alone.
  await page.evaluate(([a, b]) => { window.send(3, 3, 'first.xlsx', a); window.send(4, 4, 'second.xlsx', b); }, [[...koreanWorkbook()], [...otherWorkbook()]]);
  const second = await waitFor({ type: 'sketch-xlsx:opened', requestId: 4 }, 'second open');
  const first = await waitFor({ type: 'sketch-xlsx:opened', requestId: 3 }, 'first open');
  assert.deepEqual([first.ok, first.sheets], [true, ['매출', '메모']], 'the earlier open is answered too');
  assert.deepEqual(second.sheets, ['두번째']);
  await engine.click({ position: { x: 600, y: 500 } });
  assert.equal(await cell('A2'), '42');

  assert.deepEqual([...external], [], 'no request leaves this origin');
  assert.deepEqual(errors, [], 'page errors');

  // Editing (docs/plans/2026-10-15-xlsx-edit.md stage 1a): edits change the workbook and are reported as
  // state; a snapshot holds what is being typed; only `saved` for a snapshot makes it clean, and an edit
  // after the snapshot keeps it dirty; file shortcuts become requests to the shell, and nothing downloads.
  {
    await page.goto(origin + '/xlsx-harness.html?mode=edit');
    const editReady = await waitFor({ type: 'sketch-xlsx:ready' }, 'edit ready');
    assert.equal(editReady.mode, 'edit');
    const edited = await open(1, 1, '매출.xlsx', koreanWorkbook());
    assert.equal(edited.ok, true);
    const lastState = async () => (await messages()).filter(m => m.type === 'sketch-xlsx:state').at(-1);
    const waitState = async (fields, label) => {
      await page.waitForFunction(fields => {
        const state = window.messages.filter(m => m.type === 'sketch-xlsx:state').at(-1);
        return state && Object.entries(fields).every(([key, value]) => state[key] === value);
      }, fields, { timeout: 30000 }).catch(async error => { throw new Error(`${label}: ${error.message}\n${JSON.stringify(await lastState())}`); });
    };
    // Keys go to the engine only while its canvas has focus (verify's en-US round once lost keystrokes).
    const focused = async () => {
      const frame = page.frames().find(f => f.url().includes('/engines/gridcraft/'));
      const focus = await frame.evaluate(() => ({ tag: document.activeElement?.tagName, has: document.hasFocus() }));
      assert.deepEqual(focus, { tag: 'CANVAS', has: true }, 'the engine canvas has focus before typing');
    };
    const typeInto = async (address, text, commit = true) => {
      await select(address);
      await focused();
      // 50 ms between keys, as a person types: with none, the keys after the first one, which opens the
      // cell editor, were lost (measured 2026-10-15: "999" -> 9); recorded in the plan as a finding.
      await page.keyboard.type(text, { delay: 50 });
      if (commit) await page.keyboard.press('Enter');
    };
    const takeSnapshot = id => page.evaluate(id => window.snapshot(id, 1), id);
    // Cells read from a snapshot that is let go at once (a read must not count as a save).
    let readId = 900;
    const read = async () => {
      const shot = await takeSnapshot(++readId);
      await page.evaluate(id => window.post({ type: 'sketch-xlsx:discard', requestId: id }), readId);
      return cellsOf(shot.bytes);
    };
    await waitState({ dirty: false }, 'clean after opening');
    await typeInto('B2', '999');
    await waitState({ dirty: true, editing: false }, 'dirty after an edit');
    const afterEdit = await read();
    assert.equal(afterEdit.B2, '999', 'the edit is in the workbook');
    assert.equal(afterEdit.B4, '3399', 'the formula recalculates');
    const first = await takeSnapshot(60);
    assert.equal(first.ok, true);
    await page.evaluate(([id, uid]) => window.post({ type: 'sketch-xlsx:saved', requestId: id, epoch: 1, docUid: uid }), [60, first.docUid]);
    await waitState({ dirty: false }, 'clean once the snapshot is saved');
    // An edit after the snapshot is not covered by its `saved`. (ASCII: Korean typed through the headless
    // text agent sometimes left the cell editor open after Enter — a finding in the plan, checked by hand.)
    await typeInto('A2', 'pear');
    await waitState({ dirty: true, editing: false }, 'dirty again');
    const second = await takeSnapshot(61);
    await typeInto('A3', 'kaki');
    await waitState({ editing: false, rev: second.rev + 1 }, 'the later edit is in the workbook');
    await page.evaluate(([id, uid]) => window.post({ type: 'sketch-xlsx:saved', requestId: id, epoch: 1, docUid: uid }), [61, second.docUid]);
    await page.waitForTimeout(500);
    assert.equal((await lastState()).dirty, true, 'an edit made after the snapshot stays unsaved');
    // `saved` while a cell is still being typed in: the workbook is clean, the typing is still unsaved.
    const fourth = await takeSnapshot(64);
    await typeInto('A4', 'x', false);
    await waitState({ editing: true }, 'typing before the save lands');
    await page.evaluate(([id, uid]) => window.post({ type: 'sketch-xlsx:saved', requestId: id, epoch: 1, docUid: uid }), [64, fourth.docUid]);
    await waitState({ dirty: false, editing: true }, 'clean workbook, typing still pending');
    await page.keyboard.press('Escape');
    await waitState({ dirty: false, editing: false }, 'typing cancelled');
    await typeInto('A3', 'kaki2');
    await waitState({ dirty: true, editing: false }, 'dirty for the next checks');
    // A discarded snapshot changes nothing; a wrong document id is ignored.
    const third = await takeSnapshot(62);
    await page.evaluate(id => window.post({ type: 'sketch-xlsx:discard', requestId: id }), 62);
    await page.evaluate(([id, uid]) => window.post({ type: 'sketch-xlsx:saved', requestId: id, epoch: 1, docUid: uid + 1 }), [62, third.docUid]);
    await page.waitForTimeout(500);
    assert.equal((await lastState()).dirty, true, 'discard and a wrong document leave it unsaved');
    // What is being typed goes into the snapshot.
    await typeInto('C2', '77', false);
    await waitState({ editing: true }, 'typing in a cell');
    const typed = await takeSnapshot(63);
    assert.equal(typed.ok, true);
    const typedCells = cellsOf(typed.bytes);
    assert.equal(typedCells.C2, '77', 'the cell being typed in was committed into the snapshot');
    assert.deepEqual([typedCells.A2, typedCells.A3], ['pear', 'kaki2']);
    // File shortcuts ask the shell; nothing is downloaded or opened here.
    await select('A1');
    await focused();
    for (const key of ['ControlOrMeta+s', 'ControlOrMeta+Shift+s', 'F12', 'ControlOrMeta+o']) await page.keyboard.press(key);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.messages.filter(m => m.type === 'sketch-xlsx:request').length >= 4, null, { timeout: 30000 });
    assert.deepEqual((await messages()).filter(m => m.type === 'sketch-xlsx:request').map(m => m.action), ['save', 'saveAs', 'saveAs', 'open']);
    assert.deepEqual(downloads, [], 'nothing was downloaded');
    assert.deepEqual(errors, [], 'page errors (editing)');
  }

  // The product: the Excel view in the shell opens a picked file, edits it, and keeps the edit across editor switches.
  const product = await context.newPage();
  product.setDefaultTimeout(60000);
  product.on('pageerror', error => errors.push(String(error)));
  product.on('download', download => downloads.push(download.suggestedFilename()));
  // Opening another file over unsaved changes asks first; the test answers yes and records the question.
  const dialogs = [];
  product.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
  product.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url()); });
  await product.goto(origin + '/xlsx.html');
  // The engine's messages to the shell, kept for the failure evidence (tests/failure-evidence.mjs).
  await product.evaluate(() => { window.messages = []; addEventListener('message', event => { if (String(event.data?.type).startsWith('sketch-xlsx:')) window.messages.push(event.data); }); });
  await product.locator('.xlsx-viewer[data-ready="true"]').waitFor();
  const pick = async (name, bytes) => {
    await product.evaluate(async ([name, bytes]) => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
      const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
      window.showOpenFilePicker = async () => [handle];
    }, [name, [...bytes]]);
    await product.getByRole('button', { name: 'Excel 열기' }).click();
  };
  await pick('매출.xlsx', koreanWorkbook());
  await product.locator('.xlsx-viewer[data-sheets="2"]').waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx');
  assert.equal(await product.locator('.product-document-name').count(), 0, 'the header keeps its width: the name is in the toolbar');
  // The header floats over the toolbar's right end; nothing in the toolbar may sit under it.
  for (const width of [1280, 768, 375]) {
    await product.setViewportSize({ width, height: 900 });
    const header = await product.locator('.editor-shell > .product-header').boundingBox();
    for (const box of await product.locator('.xlsx-viewer .toolbar > *:not(input)').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { text: item.textContent, right: r.right, bottom: r.bottom }; }))) {
      assert.ok(box.right <= header.x || box.bottom <= header.y, `${width}px: "${box.text}" (right ${box.right}) is under the header from ${header.x}`);
    }
  }
  await product.setViewportSize({ width: 1280, height: 900 });
  const view = product.locator('iframe[title="Excel 보기"]');
  const productCell = async address => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await product.keyboard.press('Escape');
      const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
      if (attempt) await view.click({ position: { x: 54, y: 223 } });
      await view.click({ position: { x: 54 + 51 * column, y: 223 + 16.3 * row } });
      await product.evaluate(() => navigator.clipboard.writeText('(empty)'));
      await product.keyboard.press('ControlOrMeta+c');
      await product.waitForFunction(async () => (await navigator.clipboard.readText()) !== '(empty)', null, { timeout: 5000 }).catch(() => {});
      const text = (await product.evaluate(() => navigator.clipboard.readText())).trim();
      if (text !== '(empty)') return text;
    }
    return '(empty)';
  };
  assert.equal(await productCell('B2'), '1200');
  await product.keyboard.type('5');
  await product.keyboard.press('Enter');
  await product.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor();
  await product.getByRole('button', { name: 'PDF', exact: true }).click();
  await product.locator('.pdf-editor').waitFor();
  await product.getByRole('button', { name: 'Excel', exact: true }).click();
  await product.locator('.xlsx-viewer[data-sheets="2"]').waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx', 'the workbook stays across editor switches');
  assert.equal(await productCell('B2'), '5', 'the edit stays across editor switches');
  await product.screenshot({ path: resolve(root, 'artifacts/xlsx-product.png') });
  await pick('notes.txt', new TextEncoder().encode('plain'));
  await product.getByRole('alert').filter({ hasText: 'XLSX 파일만 열 수 있습니다.' }).waitFor();
  await pick('fake.xlsx', new TextEncoder().encode('not a zip'));
  await product.getByRole('alert').filter({ hasText: 'XLSX 형식이 아닙니다' }).waitFor();
  await pick('protected.xlsx', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
  await product.getByRole('alert').filter({ hasText: '암호가 걸린 통합 문서이거나' }).waitFor();
  await pick('broken.xlsx', brokenWorkbook());
  await product.getByRole('alert').filter({ hasText: '파일을 열지 못했습니다.' }).waitFor();
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '매출.xlsx', 'a refused or failed file keeps the shown workbook');
  assert.equal(await productCell('B2'), '5');
  assert.ok(dialogs.length >= 1 && dialogs.every(text => text.includes('저장하지 않은 변경')), 'opening over unsaved changes asked first');

  // Saving (stage 1b). The pickers hand out files in the origin's private storage (OPFS) in place of the
  // user's disk; a save picker may refuse once (an expired click), cancel, or give a file that fails to write.
  const fileBytes = name => product.evaluate(async n => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).arrayBuffer())], name);
  const savePicker = (name, mode = 'ok') => product.evaluate(([n, m]) => {
    let refused = false;
    window.showSaveFilePicker = async () => {
      if (m === 'abort') throw new DOMException('cancelled', 'AbortError');
      if (m === 'expired' && !refused) { refused = true; throw new DOMException('no activation', 'SecurityError'); }
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(n, { create: true });
      // A real handle (so it compares with isSameEntry) whose writes fail.
      if (m === 'broken') handle.createWritable = async () => { throw new DOMException('disk full', 'QuotaExceededError'); };
      return handle;
    };
  }, [name, mode]);
  // The engine has the edit in its workbook (not just typed): keys sent in the same frame as the Enter that
  // closes the cell editor were dropped (plan F1), so a shortcut waits for this.
  const committed = () => product.waitForFunction(() => { const s = window.messages.filter(m => m.type === 'sketch-xlsx:state').at(-1); return s && s.dirty && !s.editing; }, null, { timeout: 30000 });
  const unsavedShown = () => product.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).count();
  // "Still unsaved" is checked after the engine had time to report a change of state (a wrong `saved` would).
  const stillUnsaved = async label => { await product.waitForTimeout(700); assert.equal(await unsavedShown(), 1, label); };
  const settled = () => product.locator('.xlsx-viewer[data-saving="false"]').waitFor();
  const click = label => product.getByRole('button', { name: label, exact: true }).click();
  // What the opened file holds now (a fixture zipped twice differs in its timestamps, so it is read back).
  const original = await fileBytes('매출.xlsx');
  const recoveryCount = () => product.evaluate(async () => { let n = 0; for await (const _ of (await (await navigator.storage.getDirectory()).getDirectoryHandle('sketch-docs-xlsx-recovery', { create: true })).keys()) n++; return n; });
  assert.equal(await unsavedShown(), 1, 'B2 = 5 is unsaved');
  // Cancelled: nothing written, still unsaved.
  await savePicker('취소.xlsx', 'abort');
  await click('다른 이름으로 저장');
  await settled();
  await stillUnsaved('a cancelled save leaves the changes unsaved');
  // A file that fails to write: still unsaved, the error is shown.
  await savePicker('실패.xlsx', 'broken');
  await click('다른 이름으로 저장');
  await product.getByRole('alert').filter({ hasText: '저장하지 못했습니다. disk full' }).waitFor();
  await stillUnsaved('a failed write leaves the changes unsaved');
  // Save As after an expired click: one more click, then a new file with the edit; the opened file is untouched.
  await savePicker('복사본.xlsx', 'expired');
  await click('다른 이름으로 저장');
  await product.getByRole('button', { name: '저장할 위치 고르기' }).click();
  await product.getByRole('status').filter({ hasText: '저장했습니다: 복사본.xlsx' }).waitFor();
  await settled();
  await product.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor({ state: 'detached' });
  assert.equal(cellsOf(await fileBytes('복사본.xlsx')).B2, '5');
  assert.deepEqual(await fileBytes('매출.xlsx'), original, 'the opened file is untouched by Save As');
  assert.equal(await product.locator('.xlsx-viewer .name').textContent(), '복사본.xlsx', 'the next save goes to the new file');
  // Ctrl+S (inside the engine) saves into that file.
  await productCell('B3');
  await product.keyboard.type('7', { delay: 50 });
  await product.keyboard.press('Enter');
  await committed();
  await product.keyboard.press('ControlOrMeta+s');
  // The notice from the Save As is still shown; the save is done when the changes are no longer unsaved.
  await product.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor({ state: 'detached' });
  await settled();
  assert.deepEqual([cellsOf(await fileBytes('복사본.xlsx')).B2, cellsOf(await fileBytes('복사본.xlsx')).B3], ['5', '7']);
  // Changed elsewhere since: refused, the file keeps what the other program wrote.
  await product.evaluate(async () => { const h = await (await navigator.storage.getDirectory()).getFileHandle('복사본.xlsx'); const w = await h.createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close(); });
  await productCell('B3');
  await product.keyboard.type('8', { delay: 50 });
  await product.keyboard.press('Enter');
  await committed();
  await click('저장');
  await product.getByRole('alert').filter({ hasText: '외부에서 변경되었습니다' }).waitFor();
  assert.deepEqual(await fileBytes('복사본.xlsx'), [1, 2, 3], 'a file changed elsewhere is not overwritten');
  await stillUnsaved('a refused save leaves the changes unsaved');
  // Exports: new files, the workbook stays unsaved and keeps its file.
  await savePicker('표.csv');
  await click('CSV로 내보내기');
  await product.getByRole('status').filter({ hasText: '내보냈습니다: 표.csv' }).waitFor();
  assert.match(new TextDecoder().decode(new Uint8Array(await fileBytes('표.csv'))), /사과,5\r?\n배,8/);
  await savePicker('표.pdf');
  await click('PDF로 내보내기');
  await product.getByRole('status').filter({ hasText: '내보냈습니다: 표.pdf' }).waitFor();
  assert.deepEqual((await fileBytes('표.pdf')).slice(0, 5), [...new TextEncoder().encode('%PDF-')]);
  await stillUnsaved('an export is not a save');
  // Save As onto the opened file, cancelled at the warning: its original goes back (kept in OPFS first), and the
  // changes stay unsaved.
  await pick('매출.xlsx', koreanWorkbook());
  await product.locator('.xlsx-viewer .name').filter({ hasText: '매출.xlsx' }).waitFor();
  await productCell('B2');
  await product.keyboard.type('6', { delay: 50 });
  await product.keyboard.press('Enter');
  await committed();
  const kept = await recoveryCount();
  const reopened = await fileBytes('매출.xlsx');
  await savePicker('매출.xlsx');
  await click('다른 이름으로 저장');
  await product.getByRole('dialog', { name: '원본 파일에 저장' }).getByRole('button', { name: '취소' }).click();
  await product.getByRole('alert').filter({ hasText: '원래 내용으로 되돌렸습니다' }).waitFor();
  assert.deepEqual(await fileBytes('매출.xlsx'), reopened, 'the opened file holds its original again');
  assert.equal(await recoveryCount(), kept + 1, 'the original was kept before being written back');
  await stillUnsaved('a restored original leaves the changes unsaved');
  // B1: the engine's Open (Ctrl+O inside it) asks the shell, which asks about the unsaved changes and opens the picked file.
  const asked = dialogs.length;
  await pick('두번째.xlsx', otherWorkbook());
  await product.locator('.xlsx-viewer .name').filter({ hasText: '두번째.xlsx' }).waitFor();
  assert.equal(dialogs.length, asked + 1, 'the toolbar Open asked about the unsaved changes');
  await product.evaluate(async bytes => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('매출.xlsx', { create: true });
    window.showOpenFilePicker = async () => [handle];
  }, []);
  await view.click({ position: { x: 600, y: 500 } });
  await product.keyboard.press('ControlOrMeta+o');
  await product.locator('.xlsx-viewer .name').filter({ hasText: '매출.xlsx' }).waitFor();
  assert.equal(await productCell('B2'), '1200', 'the engine Open opened the picked file');
  assert.deepEqual(downloads, [], 'nothing was downloaded (product)');
  assert.deepEqual([...external], [], 'no request leaves this origin (product)');
  assert.deepEqual(errors, [], 'page errors (product)');

  // Recovery copies and tabs on the same file (stage 3, plan §3.6). Tabs of one browser share the origin's
  // private storage, its locks and its broadcast channel; `?draft-idle=1500` shortens the pause before a copy.
  {
    const drafts = async tab => tab.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sketch-docs-xlsx-drafts', { create: true });
      const found = [];
      for await (const [file, entry] of dir) if (file.endsWith('.json')) found.push({ ...JSON.parse(await (await entry.getFile()).text()), key: file.slice(0, -5) });
      return found;
    });
    const draftBytes = (tab, key) => tab.evaluate(async key => [...new Uint8Array(await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sketch-docs-xlsx-drafts')).getFileHandle(`${key}.xlsx`)).getFile()).arrayBuffer())], key);
    const openTab = async () => {
      const tab = await context.newPage();
      tab.setDefaultTimeout(60000);
      tab.on('pageerror', error => errors.push(String(error)));
      tab.on('download', download => downloads.push(download.suggestedFilename()));
      tab.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
      tab.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url()); });
      await tab.goto(origin + '/xlsx.html?draft-idle=1500');
      await tab.evaluate(() => { window.messages = []; addEventListener('message', event => { if (String(event.data?.type).startsWith('sketch-xlsx:')) window.messages.push(event.data); }); });
      await tab.locator('.xlsx-viewer[data-ready="true"]').waitFor();
      return tab;
    };
    // One workbook written once: a fixture made again differs in its zip timestamps, so it would be another file.
    const book = koreanWorkbook();
    await product.evaluate(async bytes => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle('복구.xlsx', { create: true });
      const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
    }, [...book]);
    const openBook = async tab => {
      await tab.evaluate(async () => { const handle = await (await navigator.storage.getDirectory()).getFileHandle('복구.xlsx'); window.showOpenFilePicker = async () => [handle]; });
      await tab.getByRole('button', { name: 'Excel 열기' }).click();
      await tab.locator('.xlsx-viewer[data-sheets="2"] .name').filter({ hasText: '복구.xlsx' }).waitFor();
    };
    const typeIn = async (tab, address, text) => {
      const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
      await tab.keyboard.press('Escape');
      await tab.locator('iframe[title="Excel 보기"]').click({ position: { x: 54 + 51 * column, y: 223 + 16.3 * row } });
      await tab.keyboard.type(text, { delay: 50 });
      await tab.keyboard.press('Enter');
      await tab.waitForFunction(() => { const s = window.messages.filter(m => m.type === 'sketch-xlsx:state').at(-1); return s && s.dirty && !s.editing; }, null, { timeout: 30000 });
    };
    const offered = tab => tab.locator('.xlsx-viewer .offer');
    const othersShown = tab => tab.locator('.xlsx-viewer .others');
    const waitDrafts = async (tab, count, label) => {
      for (let i = 0; i < 100 && (await drafts(tab)).length !== count; i++) await tab.waitForTimeout(200);
      assert.equal((await drafts(tab)).length, count, label);
    };

    // An edit is copied after the pause; the copy holds the edit.
    const first = await openTab();
    await openBook(first);
    await waitDrafts(first, 0, 'no copy before an edit');
    await typeIn(first, 'B2', '11');
    await waitDrafts(first, 1, 'a copy after the pause');
    const [copy] = await drafts(first);
    assert.deepEqual([copy.name, cellsOf(await draftBytes(first, copy.key)).B2], ['복구.xlsx', '11']);
    const copyBytes = await draftBytes(first, copy.key);

    // A second tab on the same file: both are told; the first tab's copy is not offered and stays as it was.
    const second = await openTab();
    await openBook(second);
    await othersShown(second).waitFor();
    await othersShown(first).waitFor();
    await second.waitForTimeout(1000);
    assert.equal(await offered(second).count(), 0, 'a copy a live tab holds is not offered');
    assert.deepEqual(await draftBytes(second, copy.key), copyBytes, 'the other tab\'s copy is untouched');

    // The first tab closes; opening the file again offers its copy, and restoring shows the edit, unsaved.
    await first.close();
    await openBook(second);
    await offered(second).waitFor();
    assert.equal(await othersShown(second).count(), 0, 'the closed tab is no longer listed');
    await second.screenshot({ path: resolve(root, 'artifacts/xlsx-draft-offer.png') });
    await second.getByRole('button', { name: '복구', exact: true }).click();
    await second.getByRole('status').filter({ hasText: '복구 사본을 열었습니다' }).waitFor();
    await second.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor();
    assert.equal(await offered(second).count(), 0);
    const restoredShot = await second.evaluate(() => new Promise(done => {
      // The shown workbook, read the way the harness does (a snapshot let go at once).
      const frame = document.querySelector('iframe[title="Excel 보기"]').contentWindow;
      const listen = event => { if (event.data?.type !== 'sketch-xlsx:snapshot' || event.data.requestId !== 7001) return; removeEventListener('message', listen); frame.postMessage({ type: 'sketch-xlsx:discard', protocol: 2, requestId: 7001 }, location.origin); done([...new Uint8Array(event.data.bytes)]); };
      addEventListener('message', listen);
      frame.postMessage({ type: 'sketch-xlsx:snapshot', protocol: 2, requestId: 7001, epoch: window.messages.filter(m => m.type === 'sketch-xlsx:opened').at(-1).epoch }, location.origin);
    }));
    assert.equal(cellsOf(restoredShot).B2, '11', 'the restored workbook holds the edit');
    assert.equal((await drafts(second)).length, 1, 'the restored copy is kept until saved');
    // Saved: the copy goes.
    await second.evaluate(() => { window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('복구-저장.xlsx', { create: true }); });
    await second.getByRole('button', { name: '다른 이름으로 저장', exact: true }).click();
    await second.getByRole('status').filter({ hasText: '저장했습니다: 복구-저장.xlsx' }).waitFor();
    await second.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor({ state: 'detached' });
    await waitDrafts(second, 0, 'a saved workbook leaves no copy');
    await second.close();

    // A copy that is not wanted: Discard (asked first) removes it.
    const third = await openTab();
    await openBook(third);
    await typeIn(third, 'B3', '22');
    await waitDrafts(third, 1, 'the third tab\'s copy');
    await third.close();
    const fourth = await openTab();
    await openBook(fourth);
    await offered(fourth).waitFor();
    const asked = dialogs.length;
    await fourth.getByRole('button', { name: '버리기', exact: true }).click();
    await offered(fourth).waitFor({ state: 'detached' });
    assert.equal(dialogs.length, asked + 1, 'discarding asked first');
    await waitDrafts(fourth, 0, 'a discarded copy is removed');
    // Undoing back to the opened workbook leaves nothing to recover: no copy stays.
    await typeIn(fourth, 'B3', '33');
    await waitDrafts(fourth, 1, 'the fourth tab\'s copy');
    await fourth.keyboard.press('ControlOrMeta+z');
    await fourth.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' }).waitFor({ state: 'detached' });
    await waitDrafts(fourth, 0, 'a clean workbook leaves no copy');
    await fourth.close();

    // Saving over the opened file (stage 2, decision Q2 ②): the warning names what goes with the measured names;
    // Cancel writes nothing; Save keeps the original in OPFS first, then writes; a kept original goes back; a file
    // changed elsewhere, a copy that cannot be kept and a second tab's save are refused.
    const styled = [...await readFile(resolve(root, 'tests/fixtures/xlsx-roundtrip/03-styles.xlsx'))];
    const putFile = (tab, name, bytes) => tab.evaluate(async ([n, b]) => { const h = await (await navigator.storage.getDirectory()).getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(new Uint8Array(b)); await w.close(); }, [name, bytes]);
    const fileOf = (tab, name) => tab.evaluate(async n => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).arrayBuffer())], name);
    const kept = tab => tab.evaluate(async () => { const out = []; for await (const [file, entry] of await (await navigator.storage.getDirectory()).getDirectoryHandle('sketch-docs-xlsx-recovery', { create: true })) out.push([file, [...new Uint8Array(await (await entry.getFile()).arrayBuffer())]]); return out.sort(); });
    const openFile = async (tab, name) => {
      await tab.evaluate(async n => { const h = await (await navigator.storage.getDirectory()).getFileHandle(n); window.showOpenFilePicker = async () => [h]; }, name);
      await tab.getByRole('button', { name: 'Excel 열기' }).click();
      await tab.locator('.xlsx-viewer[data-sheets="1"] .name').filter({ hasText: name }).waitFor();
    };
    const warning = tab => tab.getByRole('dialog', { name: '원본 파일에 저장' });
    const answer = async (tab, label) => { await warning(tab).waitFor(); await warning(tab).getByRole('button', { name: label }).click(); };
    const unsavedIn = tab => tab.locator('.xlsx-viewer .status').filter({ hasText: '저장하지 않은 변경' });
    const saveIn = tab => tab.getByRole('button', { name: '저장', exact: true }).click();
    const overwrite = await openTab();
    await putFile(overwrite, '서식.xlsx', styled);
    await openFile(overwrite, '서식.xlsx');
    await typeIn(overwrite, 'C2', '42');
    const keptBefore = await kept(overwrite);
    // The warning lists what fixture 03 measurably loses (docs/xlsx-roundtrip-losses.md): the rich text in A7 and
    // the creation date. Cancel: nothing written or kept, still unsaved.
    await saveIn(overwrite);
    await warning(overwrite).waitFor();
    assert.deepEqual(await warning(overwrite).locator('li').allTextContents(), ['셀 안 부분 서식 1곳', '만든 날짜']);
    await warning(overwrite).getByText('행·열 삽입·삭제나 시트 변경을 했다면 다른 시트·연결된 내용의 셀 참조가 어긋날 수 있습니다.').waitFor();
    await overwrite.screenshot({ path: resolve(root, 'artifacts/xlsx-overwrite-warning.png') });
    await answer(overwrite, '취소');
    await overwrite.getByRole('status').filter({ hasText: '저장하지 않았습니다.' }).waitFor();
    assert.deepEqual(await fileOf(overwrite, '서식.xlsx'), styled, 'a cancelled warning writes nothing');
    assert.deepEqual(await kept(overwrite), keptBefore, 'a cancelled warning keeps nothing');
    await unsavedIn(overwrite).waitFor();
    // Write permission refused: nothing asked, nothing written.
    await overwrite.evaluate(() => { FileSystemFileHandle.prototype.requestPermission = async () => 'denied'; });
    await saveIn(overwrite);
    await overwrite.getByRole('alert').filter({ hasText: '쓸 권한이 없어' }).waitFor();
    await overwrite.evaluate(() => { delete FileSystemFileHandle.prototype.requestPermission; });
    assert.equal(await warning(overwrite).count(), 0);
    assert.deepEqual(await fileOf(overwrite, '서식.xlsx'), styled);
    // The original cannot be kept (the copies' folder is a file): nothing is written.
    await overwrite.evaluate(async () => { const root = await navigator.storage.getDirectory(); await root.removeEntry('sketch-docs-xlsx-recovery', { recursive: true }).catch(() => {}); await root.getFileHandle('sketch-docs-xlsx-recovery', { create: true }); });
    await saveIn(overwrite);
    await answer(overwrite, '그래도 저장');
    await overwrite.getByRole('alert').filter({ hasText: '저장하지 못했습니다.' }).waitFor();
    assert.deepEqual(await fileOf(overwrite, '서식.xlsx'), styled, 'no copy, no write');
    await unsavedIn(overwrite).waitFor();
    await overwrite.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('sketch-docs-xlsx-recovery'));
    // Saved over: the original is kept, byte for byte, and the file holds the edit.
    await saveIn(overwrite);
    await answer(overwrite, '그래도 저장');
    await overwrite.getByRole('status').filter({ hasText: '저장했습니다: 서식.xlsx' }).waitFor();
    await unsavedIn(overwrite).waitFor({ state: 'detached' });
    assert.equal(cellsOf(await fileOf(overwrite, '서식.xlsx')).C2, '42');
    const keptOnce = await kept(overwrite);
    assert.deepEqual(keptOnce.map(([, bytes]) => bytes), [styled], 'the original was kept before it was overwritten');
    // The next save goes straight in (the file is now what this editor wrote); no second copy.
    await typeIn(overwrite, 'C3', '43');
    await saveIn(overwrite);
    await unsavedIn(overwrite).waitFor({ state: 'detached' });
    assert.equal(cellsOf(await fileOf(overwrite, '서식.xlsx')).C3, '43');
    assert.deepEqual(await kept(overwrite), keptOnce);
    // The kept original goes back over the file, which opens again.
    await overwrite.evaluate(async () => { const h = await (await navigator.storage.getDirectory()).getFileHandle('서식.xlsx'); window.showSaveFilePicker = async () => h; });
    await overwrite.getByRole('button', { name: '보관한 원본' }).click();
    await overwrite.getByRole('region', { name: '보관한 원본' }).getByRole('button', { name: /^서식\.xlsx · / }).click();
    await overwrite.getByRole('status').filter({ hasText: '저장 전 원본으로 되돌리고 다시 열었습니다' }).waitFor();
    assert.deepEqual(await fileOf(overwrite, '서식.xlsx'), styled, 'the kept original is back byte for byte');
    // Changed elsewhere after opening: refused after the warning, the file keeps the other program's bytes, nothing kept.
    await typeIn(overwrite, 'C2', '44');
    await putFile(overwrite, '서식.xlsx', [1, 2, 3]);
    await saveIn(overwrite);
    await answer(overwrite, '그래도 저장');
    await overwrite.getByRole('alert').filter({ hasText: '외부에서 변경되었습니다' }).waitFor();
    assert.deepEqual(await fileOf(overwrite, '서식.xlsx'), [1, 2, 3], 'a file changed elsewhere is not overwritten');
    assert.deepEqual(await kept(overwrite), keptOnce, 'nothing kept for a refused save');
    await unsavedIn(overwrite).waitFor();
    await overwrite.close();
    // Two tabs save over the same file: the first is written, the second is refused.
    const left = await openTab(), right = await openTab();
    await putFile(left, '동시.xlsx', styled);
    await openFile(left, '동시.xlsx');
    await openFile(right, '동시.xlsx');
    await typeIn(left, 'C2', '1');
    await typeIn(right, 'C2', '2');
    await saveIn(left);
    await answer(left, '그래도 저장');
    await left.getByRole('status').filter({ hasText: '저장했습니다: 동시.xlsx' }).waitFor();
    await saveIn(right);
    await answer(right, '그래도 저장');
    await right.getByRole('alert').filter({ hasText: '외부에서 변경되었습니다' }).waitFor();
    assert.equal(cellsOf(await fileOf(left, '동시.xlsx')).C2, '1', 'the second tab did not overwrite the first');
    await left.close();
    await right.close();
    assert.deepEqual(downloads, [], 'nothing was downloaded (recovery)');
    assert.deepEqual([...external], [], 'no request leaves this origin (recovery)');
    assert.deepEqual(errors, [], 'page errors (recovery)');
  }

  await product.close();

  // Outside the product the engine does not start.
  const alone = await context.newPage();
  await alone.goto(origin + '/engines/gridcraft/index.html?host=sketch');
  await alone.waitForURL(url => new URL(url).pathname === '/xlsx.html');
  await alone.route(origin + '/framed-without-host.html', route => route.fulfill({ contentType: 'text/html', body: '<iframe src="./engines/gridcraft/index.html"></iframe>' }));
  await alone.goto(origin + '/framed-without-host.html');
  await alone.frameLocator('iframe').getByText('This page opens inside Sketch Docs.').waitFor();
  console.log('XLSX VIEW CHECKS PASSED');
} catch (error) {
  await keepEvidence(error);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
