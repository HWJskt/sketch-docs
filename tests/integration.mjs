import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dev = process.argv.includes('--dev');
const origin = 'http://localhost:4176';
const address = { host: 'localhost', port: 4176, strictPort: true };
const xml = bytes => strFromU8(unzipSync(new Uint8Array(bytes))['Contents/section0.xml']);
let server, browser;
try {
  if (dev) {
    server = await createServer({ root, server: address });
    await server.listen();
  } else server = await preview({ root, build: { outDir: resolve(root, process.env.TEST_DIST || 'dist') }, preview: address });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60000);
  const errors = [], dialogs = [], external = new Set();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm' || dialog.type() === 'beforeunload') await dialog.accept();
    else { dialogs.push(dialog.message()); await dialog.dismiss(); }
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url());
  });
  await page.goto(origin);
  await page.getByRole('link', { name: /Word 문서/ }).waitFor();
  assert.equal(await page.locator('.tiptap').count(), 0, 'chooser has no active editor');
  await page.getByRole('link', { name: /Word 문서/ }).click();
  const wordElement = page.locator('iframe[title="Word 문서 편집기"]');
  await wordElement.waitFor();
  const word = await (await wordElement.elementHandle()).contentFrame();
  assert(word, 'Word engine frame is present');
  const editor = word.locator('.tiptap').first();
  await editor.waitFor();
  if (!dev) {
    await page.context().setOffline(true);
    await Promise.all([word.waitForNavigation(), word.evaluate(() => location.reload())]);
    await word.locator('.tiptap').waitFor();
    await page.context().setOffline(false);
    console.log('Word engine reloads offline under the root service worker');
  }
  assert.equal(await word.locator('.ribbon-tab-file').textContent(), '파일');
  await editor.click();
  await page.keyboard.insertText('루트 Word 저장 검증 ABC 123');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.insertText('굵은 글자');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.press('Enter');
  await editor.evaluate(el => {
    const data = new DataTransfer();
    data.setData('text/html', '<table><tbody><tr style="height:96px"><td colwidth="100"><p>표 A</p></td><td colwidth="300"><p>표 B</p></td></tr><tr style="height:48px"><td colwidth="100"><p>표 C</p></td><td colwidth="300"><p>표 D</p></td></tr></tbody></table>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await editor.locator('table').waitFor();
  await word.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__saved = await directory.getFileHandle('root-word.docx', { create: true });
    window.showSaveFilePicker = async options => {
      if (!options.suggestedName.endsWith('.docx')) throw Error('Word mode must default to DOCX');
      return window.__saved;
    };
  });
  await word.locator('.ribbon-tab-file').click();
  await word.locator('[data-cmd="save"]').click();
  await word.waitForFunction(() => localStorage.getItem('edentext-doc-format') === 'docx'
    && document.querySelector('.doc-name-ext')?.textContent === '.docx'
    && !document.querySelector('.doc-dirty'));
  const wordBytes = await word.evaluate(async () => Array.from(new Uint8Array(await (await window.__saved.getFile()).arrayBuffer())));
  const documentXml = strFromU8(unzipSync(new Uint8Array(wordBytes))['word/document.xml']);
  assert(documentXml.includes('루트 Word 저장 검증 ABC 123'));
  assert(documentXml.includes('표 D'));
  console.log('Word iframe: Korean menu, DOCX default and text/table bytes verified');
  const checkConvertedWord = async bytes => {
    const entries = unzipSync(new Uint8Array(bytes));
    const section = strFromU8(entries['Contents/section0.xml']);
    const header = strFromU8(entries['Contents/header.xml']);
    assert(section.includes('루트 Word 저장 검증 ABC 123'));
    for (const text of ['굵은 글자', '표 A', '표 B', '표 C', '표 D']) assert(section.includes(text), `converted text: ${text}`);
    const structure = await word.evaluate(({ section, header }) => {
      const parser = new DOMParser();
      const body = parser.parseFromString(section, 'application/xml');
      const head = parser.parseFromString(header, 'application/xml');
      const all = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
      const run = all(body, 'run').find(e => all(e, 't').some(t => t.textContent.includes('굵은 글자')));
      const cp = all(head, 'charPr').find(e => e.getAttribute('id') === run?.getAttribute('charPrIDRef'));
      return {
        bold: !!cp && all(cp, 'bold').length > 0,
        sizes: all(body, 'cellSz').map(e => ({ width: Number(e.getAttribute('width')), height: Number(e.getAttribute('height')) })),
      };
    }, { section, header });
    assert.equal(structure.bold, true, 'bold run retains its referenced character style');
    assert.equal(structure.sizes.length, 4);
    assert.equal(structure.sizes[0].height, 96 * 75);
    assert.equal(structure.sizes[2].height, 48 * 75);
    assert(Math.abs(structure.sizes[1].width / structure.sizes[0].width - 3) < 0.001, 'column width ratio survives conversion');
  };
  for (const format of ['hwpx', 'hwp']) {
    await word.evaluate(async format => {
      const directory = await navigator.storage.getDirectory();
      window.__saved = await directory.getFileHandle('converted-word.' + format, { create: true });
      window.showSaveFilePicker = async () => window.__saved;
    }, format);
    await word.locator('.ribbon-tab-file').click();
    await word.locator(`[data-cmd="saveAs${format === 'hwpx' ? 'Hwpx' : 'Hwp'}"]`).click();
    await word.waitForFunction(format => document.querySelector('.doc-name-ext')?.textContent === '.' + format
      && document.querySelector('.doc-name-input')?.value === 'converted-word'
      && !document.querySelector('.hangul-saving') && !document.querySelector('.doc-dirty'), format);
    assert.deepEqual(dialogs, [], 'conversion reports no loss or failure');
    const converted = await word.evaluate(async () => Array.from(new Uint8Array(await (await window.__saved.getFile()).arrayBuffer())));
    if (format === 'hwpx') await checkConvertedWord(converted);
    else assert.deepEqual(converted.slice(0, 8), [208, 207, 17, 224, 161, 177, 26, 225]);
    await word.evaluate(() => { window.showOpenFilePicker = async () => [window.__saved]; });
    await word.locator('.ribbon-tab-file').click();
    await word.locator('[data-cmd="open"]').click();
    await word.getByRole('status').filter({ hasText: '파일을 열었습니다' }).waitFor();
    const nativeFrame = await (await word.locator('iframe[title="한글 문서 편집기"]').elementHandle()).contentFrame();
    assert(nativeFrame, 'converted file opens in the native overlay');
    const reopened = await nativeFrame.evaluate(() => Array.from(window.edentextHost.export('hwpx').bytes));
    await checkConvertedWord(reopened);
    await word.locator('.hangul-editor header summary').click();
    await word.getByRole('button', { name: '문서 형식 선택', exact: true }).click();
    await word.locator('.hangul-editor').waitFor({ state: 'hidden' });
    assert((await editor.textContent()).includes('루트 Word 저장 검증 ABC 123'), 'returning from native viewer retains Word document');
  }
  console.log('Word conversion: HWPX/HWP save, native reopen, bold, row heights and column widths verified');


  await page.goto(origin);
  await page.getByRole('link', { name: /한글 문서/ }).click();
  const status = text => page.getByRole('status').filter({ hasText: text });
  await status('새 문서입니다').waitFor();
  const frame = await (await page.locator('iframe[title="한글 문서 편집기"]').elementHandle()).contentFrame();
  assert(frame, 'native engine frame is present');
  const menu = async () => {
    const details = page.locator('.hangul-editor header details');
    if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
  };
  const action = async name => { await menu(); await page.getByRole('button', { name, exact: true }).click(); };
  const exportHwpx = () => frame.evaluate(() => Array.from(window.edentextHost.export('hwpx').bytes));
  await frame.locator('textarea').focus();
  await page.keyboard.insertText('한글 편집 검증 ABC 123');
  await page.keyboard.press('Enter');
  await frame.locator('button[data-cmd="table:create"]').click();
  await frame.locator('[data-row="1"][data-col="1"]').hover();
  await frame.locator('[data-row="1"][data-col="1"]').click();
  await frame.waitForFunction(() => window.edentextHost.dirty());
  for (const format of ['hwpx', 'hwp']) {
    const exported = await frame.evaluate(format => {
      const a = window.edentextHost.export(format);
      return { bytes: Array.from(a.bytes), loss: a.contentLoss, version: a.version };
    }, format);
    assert.equal(exported.loss.count, 0);
    assert(exported.version.revision > 0);
    if (format === 'hwp') assert.deepEqual(exported.bytes.slice(0, 8), [208, 207, 17, 224, 161, 177, 26, 225]);
    await frame.evaluate(async ({ bytes, format }) => window.edentextHost.open(new Uint8Array(bytes), 'roundtrip.' + format), { bytes: exported.bytes, format });
    const section = xml(await exportHwpx());
    assert(section.includes('한글 편집 검증 ABC 123'), format + ' retains text');
    assert(section.includes('rowCnt="2"') && section.includes('colCnt="2"'), format + ' retains 2x2 table');
    const version = await frame.evaluate(() => window.edentextHost.export('hwpx').version);
    await frame.locator('textarea').focus();
    await page.keyboard.insertText(' 추가');
    assert.equal(await frame.evaluate(v => window.edentextHost.acknowledge(v, 'old.hwpx'), version), false);
    assert.equal(await frame.evaluate(() => window.edentextHost.dirty()), true);
  }
  const intact = await frame.evaluate(() => window.edentextHost.state());
  const protectedBytes = await readFile(resolve(root, 'source/hop/third_party/rhwp/samples/hwp3-sample16-hwp5-2024-password-123456.hwp'));
  for (const [name, bytes] of [['broken.hwp', [1, 2, 3]], ['protected.hwp', Array.from(protectedBytes)]]) {
    assert.equal(await frame.evaluate(async ({ name, bytes }) => {
      try { await window.edentextHost.open(new Uint8Array(bytes), name); return false; } catch { return true; }
    }, { name, bytes }), true);
    const state = await frame.evaluate(() => window.edentextHost.state());
    assert.equal(state.epoch, intact.epoch);
    assert.equal(state.revision, intact.revision);
    assert.equal(state.dirty, true);
  }
  console.log('Native HWP/HWPX: text/table round trips, stale save and failed-open retention verified');

  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__saved = await directory.getFileHandle('native.hwpx', { create: true });
    window.showSaveFilePicker = async () => window.__saved;
  });
  await action('저장');
  await status('native.hwpx 저장 완료').waitFor();
  const saved = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__saved.getFile()).arrayBuffer())));
  assert(xml(saved).includes('한글 편집 검증 ABC 123'));
  assert.equal(await frame.evaluate(() => window.edentextHost.dirty()), false);
  await page.evaluate(async () => {
    const stream = await window.__saved.createWritable(); await stream.write('external change'); await stream.close();
  });
  await action('저장');
  await status('외부에서 변경').waitFor();
  assert.equal(await page.evaluate(async () => (await window.__saved.getFile()).text()), 'external change');
  await page.evaluate(async bytes => {
    const directory = await navigator.storage.getDirectory();
    window.__original = await directory.getFileHandle('original.hwpx', { create: true });
    const stream = await window.__original.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
    window.showOpenFilePicker = async () => [window.__original];
    window.showSaveFilePicker = async () => window.__original;
  }, saved);
  await action('열기…');
  await status('파일을 열었습니다').waitFor();
  await action('저장');
  await status('원본과 다른 파일').waitFor();
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__copy = await directory.getFileHandle('copy.hwpx', { create: true });
    window.showSaveFilePicker = async () => window.__copy;
  });
  await action('다른 이름으로 저장…');
  await status('copy.hwpx 저장 완료').waitFor();
  await frame.locator('textarea').focus();
  await page.keyboard.insertText(' 사본수정');
  await action('저장');
  await status('copy.hwpx 저장 완료').waitFor();
  const files = await page.evaluate(async () => ({
    original: Array.from(new Uint8Array(await (await window.__original.getFile()).arrayBuffer())),
    copy: Array.from(new Uint8Array(await (await window.__copy.getFile()).arrayBuffer())),
  }));
  assert.deepEqual(files.original, saved);
  assert(xml(files.copy).includes('사본수정'));
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__hwp = await directory.getFileHandle('native.hwp', { create: true });
    window.showSaveFilePicker = async () => window.__hwp;
  });
  await menu();
  await page.getByLabel('저장 형식').selectOption('hwp');
  await page.getByRole('button', { name: '다른 이름으로 저장…', exact: true }).click();
  await status('native.hwp 저장 완료').waitFor();
  const hwpSaved = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__hwp.getFile()).arrayBuffer())));
  assert.deepEqual(hwpSaved.slice(0, 8), [208, 207, 17, 224, 161, 177, 26, 225]);
  await frame.evaluate(bytes => window.edentextHost.open(new Uint8Array(bytes), 'native.hwp'), hwpSaved);
  assert(xml(await exportHwpx()).includes('사본수정'));
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  assert.deepEqual([...external], []);
  console.log('Root integration PASS: original protection, copy save, external modification detection; OS pickers remain manual');
} finally {
  await browser?.close();
  if (dev) await server?.close();
  else if (server) await new Promise((resolveClose, reject) => server.httpServer.close(error => error ? reject(error) : resolveClose()));
}
