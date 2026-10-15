import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { assertTestLocale, launchArgs } from './browser-locale.mjs';
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
  browser = await chromium.launch({ channel: 'chrome', headless: true, ...launchArgs });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await assertTestLocale(page);
  page.setDefaultTimeout(60000);
  const errors = [], dialogs = [], external = new Set();
  let cancelExit = false, exitPrompts = 0;
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload' && cancelExit) { exitPrompts++; await dialog.dismiss(); return; }
    if (dialog.type() === 'confirm' || dialog.type() === 'beforeunload') await dialog.accept();
    else { dialogs.push(dialog.message()); await dialog.dismiss(); }
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.add(request.url());
  });
  await page.addInitScript(() => {
    if (location.pathname.endsWith('/rhwp/print.html')) {
      window.print = () => {
        parent.__printed = { html: document.documentElement.outerHTML, title: document.title, pages: document.querySelectorAll('body > div').length };
      };
    }
  });
  await page.goto(origin);
  await page.getByRole('link', { name: /Word 문서/ }).waitFor();
  assert.equal(await page.locator('.tiptap').count(), 0, 'chooser has no active editor');
  await page.getByRole('button', { name: '프로그램 정보 · 라이선스 및 소스 코드' }).click();
  await page.getByRole('dialog').waitFor();
  const sourceLink = page.getByRole('link', { name: '이 버전의 소스 코드 (GitHub)' });
  await sourceLink.waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Sketch Docs' }).count(), 1);
  const release = await (await page.request.get(origin + '/legal/release.json')).json();
  assert.equal(release.name, 'Sketch Docs');
  assert.match(release.source.url, /^https:\/\/github\.com\/HWJskt\/sketch-docs\/tree\/[0-9a-f]{40}$/);
  assert.equal(await sourceLink.getAttribute('href'), release.source.url);
  await page.getByRole('dialog').locator('summary').click();
  for (const item of release.upstreams) {
    for (const href of [item.url, item.mirrorUrl]) {
      assert.match(href, new RegExp(`^https://github\\.com/[^/]+/${item.name}/tree/${item.commit}$`));
      assert.equal(await page.getByRole('dialog').locator(`a[href="${href}"]`).count(), 1, href);
    }
  }
  for (const url of [release.licenseUrl, release.noticesUrl]) {
    assert.equal((await page.request.head(new URL(url, origin).href)).status(), 200);
  }
  await page.screenshot({path:'/tmp/sketch-docs-about.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert(await page.getByRole('button', { name: '프로그램 정보 · 라이선스 및 소스 코드' }).evaluate(el => el === document.activeElement));
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
  assert.equal(await word.locator('.rb-logo-btn:visible, .ribbon-tabs > .lang-wrap:visible, .ribbon-tabs > .appearance-wrap:visible').count(), 0);
  assert.equal(await word.locator('.doc-name input').count(), 0);
  assert.match(await word.getByRole('combobox').first().getAttribute('placeholder'), /^메뉴검색/);

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
  assert.equal(await word.locator('.ribbon-tabs .doc-name-label').textContent(), 'root-word');
  await page.locator('.engine:not([hidden]) iframe').contentFrame().getByRole('button', {name:'프로그램 정보 및 라이선스',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  assert((await page.getByRole('dialog').textContent()).includes('Steffen Becker'));
  await page.getByRole('button', {name:'EdenText 정보',exact:true}).click();
  await word.getByRole('link', {name:/GitHub/}).waitFor();
  await page.keyboard.press('Escape');
  console.log('Word iframe: Korean menu, DOCX default and text/table bytes verified');
  await word.locator('.ribbon-tab-file').click();
  assert.equal(await word.locator('[data-cmd="saveAsHwpx"], [data-cmd="saveAsHwp"]').count(), 0, 'Word offers no Hangul Save As formats');
  assert.equal(await word.locator('[data-cmd="saveAsDocx"]').count(), 1);
  assert.equal(await word.locator('[data-cmd="saveAsOdt"]').count(), 1);
  assert.equal(await word.locator('[data-cmd="about"]').count(), 0, 'About is available through the shared information button');
  assert.equal(await word.locator('.ribbon-tab-file').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');

  await page.keyboard.press('Escape');
  const header = page.locator('.engine:not([hidden]) iframe').contentFrame().locator('.product-header');
  const switchWord = header.getByRole('button', {name:'Word', exact:true});
  const switchHangul = header.getByRole('button', {name:'한글', exact:true});
  const headerBounds = await header.boundingBox();
  const buttonRects = () => header.locator('button').evaluateAll(buttons => buttons.map(button => {const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const wordButtonRects = await buttonRects();
  assert.equal(await word.locator('.sketch-menu-row').evaluate(el => el.getBoundingClientRect().height),36);
  await page.screenshot({path:'/tmp/sketch-docs-word-compact.png'});
  assert.equal((await wordElement.boundingBox()).y, 0, 'Word iframe recovers the extra header height');

  await editor.click();
  await page.keyboard.insertText(' 전환 보존');
  const retainedWord = await editor.textContent();
  await switchHangul.click();
  assert.equal(await switchHangul.getAttribute('aria-pressed'), 'true');
  assert.equal(new URL(page.url()).pathname, '/hwp.html');
  const hangulBounds = await header.boundingBox();
  assert.equal(hangulBounds.x + hangulBounds.width, headerBounds.x + headerBounds.width);
  assert.deepEqual(await buttonRects(), wordButtonRects, 'all four button rectangles (W, 한, PDF, info) are identical across editors');
  assert.equal(await header.locator('..').evaluate(el => el.getBoundingClientRect().height),36);
  assert.equal(1440 - (wordButtonRects.at(-1).x + wordButtonRects.at(-1).width),10, 'info right padding adds 4px to previous 6px');
  assert.equal(await wordElement.evaluate(el => el.parentElement.inert), true);

  const status = text => page.getByRole('status').filter({ hasText: text });
  await status('새 문서입니다').waitFor();
  const frame = await (await page.locator('iframe[title="한글 문서 편집기"]').elementHandle()).contentFrame();
  assert(frame, 'native engine frame is present');
  const toggle = frame.locator('#toolbox-basic-toggle');
  const nameRect = await header.locator('.product-document-meta').boundingBox();
  const toggleRect = await toggle.boundingBox();
  assert(toggleRect.x >= nameRect.x + nameRect.width, 'Hangul collapse follows the file name');
  assert(toggleRect.x + toggleRect.width <= wordButtonRects[0].x, 'collapse precedes editor selection');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const menu = async () => {
    const details = frame.locator('.product-file-menu');
    if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
  };
  const action = async name => { await menu(); await frame.getByRole('button', { name, exact: true }).click(); };
  const fileBox = await frame.locator('.product-file-menu summary').boundingBox();
  const editBox = await frame.locator('[data-menu="edit"] > .menu-title').boundingBox();
  assert(fileBox && editBox && fileBox.x + fileBox.width <= editBox.x + 1 && Math.abs(fileBox.y - editBox.y) < 2, 'File sits directly left of Edit on the same menu row');
  await frame.locator('[data-menu="edit"] > .menu-title').click();
  await frame.locator('.product-file-menu summary').hover();
  await frame.waitForFunction(() => document.querySelector('.product-file-menu').open && !document.querySelector('[data-menu="edit"]').classList.contains('open'));
  await frame.locator('.product-file-dropdown button').first().hover();
  assert.equal(await frame.locator('.product-file-menu').evaluate(el => el.open), true, 'moving into File submenu keeps it open');
  await frame.locator('[data-menu="insert"] > .menu-title').hover();
  await frame.waitForFunction(() => !document.querySelector('.product-file-menu').open && document.querySelector('[data-menu="insert"]').classList.contains('open'));
  await frame.locator('.product-file-menu summary').hover();
  await frame.waitForFunction(() => document.querySelector('.product-file-menu').open && !document.querySelector('[data-menu="insert"]').classList.contains('open'));
  await menu();
  await page.keyboard.press('Escape');
  await frame.waitForFunction(() => !document.querySelector('.product-file-menu').open);
  await menu();
  await frame.locator('[data-menu="edit"] > .menu-title').click();
  await frame.waitForFunction(() => !document.querySelector('.product-file-menu').open);
  await menu();
  await frame.waitForFunction(() => !document.querySelector('[data-menu="edit"]').classList.contains('open'));
  assert.equal(await frame.locator('.product-file-menu select').count(), 0, 'formats are separate menu actions');
  const saveItems = frame.locator('.product-file-dropdown button');
  const undoShortcut = await frame.locator('[data-cmd="edit:undo"] .md-shortcut').first().textContent();
  const saveShortcut = await frame.getByRole('button',{name:'저장',exact:true}).locator('.md-shortcut').textContent();
  assert.equal(saveShortcut,undoShortcut.replace('Z','S'),'File menu follows native OS shortcut notation');
  const boxes = await saveItems.evaluateAll(items => items.map(el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,height:r.height}; }));
  for (let i=1;i<boxes.length;i++) assert(boxes[i].x === boxes[0].x && boxes[i].y >= boxes[i-1].y + boxes[i-1].height, 'File actions form one vertical column');
  assert.equal(await frame.locator('.product-file-dropdown button').first().evaluate(el => {
    const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), true, 'File dropdown is actually painted outside its menu row');
  await page.screenshot({ path: '/tmp/edentext-hangul-file-menu.png' });
  await page.keyboard.press('Escape');
  const exportHwpx = () => frame.evaluate(() => Array.from(window.edentextHost.export('hwpx').bytes));
  await frame.locator('textarea').focus();
  await page.keyboard.insertText('한글 편집 검증 ABC 123');
  await page.keyboard.press('Enter');
  await frame.locator('button[data-cmd="table:create"]').click();
  await frame.locator('[data-row="1"][data-col="1"]').hover();
  await frame.locator('[data-row="1"][data-col="1"]').click();
  await frame.waitForFunction(() => window.edentextHost.dirty());
  const retainedHangul = xml(await exportHwpx());
  assert.equal(await frame.getByRole('button', {name:'문서 형식 선택',exact:true}).count(), 0);
  const commandCatalog = await frame.evaluate(() => window.rhwpStudio.automation.listCommands());
  assert(commandCatalog.some(command => command.label.includes('표') && typeof command.enabled === 'boolean'));
  console.log('Hangul searchable command catalog:', commandCatalog.length);
  await frame.locator('.product-document-dirty').waitFor();
  const beforePrint = await frame.evaluate(() => window.edentextHost.state());
  await frame.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+p');
  await frame.waitForFunction(() => !!window.__printed);
  await status('인쇄 창을 닫았습니다').waitFor();
  const printed = await frame.evaluate(() => window.__printed);
  assert(printed.html.includes('<svg') && /<(path|text)\b/.test(printed.html), 'print uses document SVG including glyphs');
  const printPreview = await browser.newPage({viewport:{width:900,height:1200}});
  try {
    await printPreview.setContent(printed.html);
    assert.equal(await printPreview.locator('svg').count(), 1);
    await printPreview.screenshot({path:'/tmp/sketch-hangul-print.png'});
    await printPreview.pdf({path:'/tmp/sketch-hangul-print.pdf',preferCSSPageSize:true});
  } finally { await printPreview.close(); }
  assert(!printed.html.includes('product-header'), 'editor chrome is not printed');
  assert.deepEqual(await frame.evaluate(() => window.edentextHost.state()), beforePrint, 'print preserves dirty and revision');
  assert.equal(await frame.locator('#rhwp-print-surface').count(), 0, 'print frame is cleaned up');

  await switchWord.click();
  assert.equal(await editor.textContent(), retainedWord);
  assert.equal(await switchWord.getAttribute('aria-pressed'), 'true');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+z');
  assert(!(await editor.textContent()).includes('전환 보존'), 'Word undo history survives editor switches');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  assert.equal(await editor.textContent(), retainedWord);
  assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', {cancelable:true}))), true, 'hidden Hangul and Word changes prevent unload');
  cancelExit = true;
  const beforeExit = page.url();
  await page.goto(origin).catch(error => { assert.match(String(error), /ERR_ABORTED/); });
  assert.equal(exitPrompts, 1, 'real navigation opens browser unsaved changes prompt');
  assert.equal(page.url(), beforeExit, 'cancelling exit retains the editing session');
  cancelExit = false;
  await page.goBack();
  await switchHangul.waitFor();
  assert.equal(await switchHangul.getAttribute('aria-pressed'), 'true');
  assert.equal(xml(await exportHwpx()), retainedHangul);
  await page.goForward();
  assert.equal(await switchWord.getAttribute('aria-pressed'), 'true');
  await word.evaluate(() => { window.showSaveFilePicker = () => new Promise((resolve,reject) => {window.__cancelPicker = () => reject(new DOMException('cancel', 'AbortError'));}); });
  await word.locator('.ribbon-tab-file').click();
  await word.locator('[data-cmd="saveAsDocx"]').click();
  await word.waitForFunction(() => document.querySelector('.product-header nav button').disabled);
  assert(await switchHangul.isDisabled(), 'pending Word file operation blocks switching');
  await word.waitForFunction(() => typeof window.__cancelPicker === 'function');
  await word.evaluate(() => window.__cancelPicker());
  await word.waitForFunction(() => !document.querySelector('.product-header nav button').disabled);
  await switchHangul.click();
  assert.equal(xml(await exportHwpx()), retainedHangul);
  await header.getByRole('button', {name:'프로그램 정보 및 라이선스',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  const narrow = await header.boundingBox();
  assert(narrow.x >= 0 && narrow.x + narrow.width <= 390);
  await menu();
  assert.equal(await frame.locator('.product-file-dropdown button').first().evaluate(el => {
    const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), true, 'Narrow File dropdown escapes horizontal scrolling');
  await page.screenshot({path:'/tmp/sketch-docs-hangul-narrow.png'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  console.log('Shared header: text/table sessions, history, busy guard, About and narrow layout verified');
  for (const format of ['hwpx', 'hwp']) {
    const exported = await frame.evaluate(format => {
      const a = window.edentextHost.export(format);
      return { bytes: Array.from(a.bytes), loss: a.contentLoss, version: a.version };
    }, format);
    assert.equal(exported.loss.count, 0);
    assert(exported.version.revision > 0);
    if (format === 'hwp') assert.deepEqual(exported.bytes.slice(0, 8), [208, 207, 17, 224, 161, 177, 26, 225]);
    await frame.evaluate(async ({ bytes, format }) => window.edentextHost.open(new Uint8Array(bytes), 'roundtrip.' + format), { bytes: exported.bytes, format });
    await frame.waitForFunction(format => document.querySelector('.product-document-name')?.textContent === 'roundtrip.' + format, format);
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
  await frame.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+s');
  await status('native.hwpx 저장 완료').waitFor();
  const saved = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__saved.getFile()).arrayBuffer())));
  assert(xml(saved).includes('한글 편집 검증 ABC 123'));
  assert.equal(await frame.evaluate(() => window.edentextHost.dirty()), false);
  await frame.locator('.product-document-dirty').waitFor({state:'hidden'});
  assert.equal(await frame.locator('.product-document-name').textContent(),'native.hwpx');
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
    // Like Chrome, the save picker empties an existing file when it is chosen.
    window.showSaveFilePicker = async () => { const stream = await window.__original.createWritable(); await stream.close(); return window.__original; };
  }, saved);
  await frame.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+o');
  await status('파일을 열었습니다').waitFor();
  await action('저장');
  await status('원본과 다른 파일').waitFor();
  assert.match(await page.getByRole('status').filter({ hasText: '원본과 다른 파일' }).first().textContent(), /비워진 원본은 열 때의 내용으로 되돌렸습니다/);
  assert.deepEqual(await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__original.getFile()).arrayBuffer()))), saved, 'the emptied original is written back');
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__copy = await directory.getFileHandle('copy.hwpx', { create: true });
    window.showSaveFilePicker = async () => window.__copy;
  });
  await frame.locator('textarea').focus();
  await page.keyboard.press('ControlOrMeta+Shift+s');
  await status('copy.hwpx 저장 완료').waitFor();
  assert.equal(await frame.locator('.product-document-name').textContent(), 'copy.hwpx');
  await frame.locator('textarea').focus();
  await page.keyboard.insertText(' 사본수정');
  await frame.locator('.product-document-dirty').waitFor();
  assert.deepEqual(await buttonRects(),wordButtonRects,'filename and dirty label do not move any button');
  await action('저장');
  await status('copy.hwpx 저장 완료').waitFor();
  assert.equal(await frame.locator('.product-document-name').textContent(), 'copy.hwpx');
  // Save As onto the current copy again: the picker empties it, and the save still goes through. The first
  // picker call fails as it does once the click no longer counts, so a second click picks the target.
  await page.evaluate(() => {
    window.__pickerCalls = 0;
    window.showSaveFilePicker = async () => {
      window.__pickerCalls++;
      if (window.__pickerCalls === 1) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError');
      const stream = await window.__copy.createWritable(); await stream.close(); return window.__copy;
    };
  });
  await frame.locator('textarea').focus();
  await page.keyboard.insertText(' 재선택');
  await page.keyboard.press('ControlOrMeta+Shift+s');
  await page.getByRole('button', { name: '저장할 위치 고르기' }).click();
  await status('copy.hwpx 저장 완료').waitFor();
  assert.equal(await page.evaluate(() => window.__pickerCalls), 2);
  assert(xml(await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__copy.getFile()).arrayBuffer())))).includes('재선택'), 'the second Save As onto the copy wrote the new text');
  const files = await page.evaluate(async () => ({
    original: Array.from(new Uint8Array(await (await window.__original.getFile()).arrayBuffer())),
    copy: Array.from(new Uint8Array(await (await window.__copy.getFile()).arrayBuffer())),
  }));
  assert.deepEqual(files.original, saved);
  assert(xml(files.copy).includes('사본수정'));
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('cancel', 'AbortError'); }; });
  await menu();
  await frame.getByRole('button', { name: '다른 이름으로 저장 (.hwp)', exact: true }).click();
  await status('취소했습니다').waitFor();
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new Error('picker must not open for the existing target'); }; });
  await frame.locator('textarea').focus();
  await page.keyboard.insertText(' 취소후저장');
  await page.keyboard.press('ControlOrMeta+s');
  await status('copy.hwpx 저장 완료').waitFor();
  assert(xml(await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__copy.getFile()).arrayBuffer())))).includes('취소후저장'), 'cancelled .hwp Save As keeps the HWPX target');
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    window.__hwp = await directory.getFileHandle('native.hwp', { create: true });
    window.showSaveFilePicker = async () => window.__hwp;
  });
  await menu();
  await frame.getByRole('button', { name: '다른 이름으로 저장 (.hwp)', exact: true }).click();
  await status('native.hwp 저장 완료').waitFor();
  const hwpSaved = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.__hwp.getFile()).arrayBuffer())));
  assert.deepEqual(hwpSaved.slice(0, 8), [208, 207, 17, 224, 161, 177, 26, 225]);
  await frame.evaluate(bytes => window.edentextHost.open(new Uint8Array(bytes), 'native.hwp'), hwpSaved);
  assert(xml(await exportHwpx()).includes('사본수정'));
  await switchWord.click();
  assert.equal(await editor.textContent(), retainedWord);
  await word.locator('.ribbon-tab-file').click();
  await word.locator('[data-cmd="save"]').click();
  await word.waitForFunction(() => !window.sketchWord.state().busy && !window.sketchWord.state().dirty);
  const preservedWordBytes = await word.evaluate(async () => Array.from(new Uint8Array(await (await window.__saved.getFile()).arrayBuffer())));
  assert(strFromU8(unzipSync(new Uint8Array(preservedWordBytes))['word/document.xml']).includes('전환 보존'), 'Word saves to its original target after Hangul Save As');
  await switchHangul.click();
  assert(xml(await exportHwpx()).includes('사본수정'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = await cdp.send('Performance.getMetrics');
  console.log('Both engines retained, JS heap bytes (excludes WASM/GPU):', metrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value);
  await cdp.detach();
  await page.screenshot({path:'/tmp/sketch-docs-hangul.png'});
  const isolated = await browser.newContext();
  try {
    const failurePage = await isolated.newPage();
    failurePage.setDefaultTimeout(30000);
    await failurePage.route('**/rhwp/index.html?*', route => route.fulfill({contentType:'text/html',body:'<p>Engine unavailable</p>'}));
    await failurePage.goto(origin + '/word.html');
    const failureWord = failurePage.frameLocator('iframe[title="Word 문서 편집기"]');
    const draft = failureWord.locator('.tiptap').first();
    await draft.waitFor();
    await draft.click();
    await failurePage.keyboard.insertText('실패 후에도 보존');
    await failureWord.getByRole('button',{name:'한글',exact:true}).click();
    await failurePage.getByRole('status').filter({hasText:'한글 편집기를 불러오지 못했습니다'}).waitFor();
    await failurePage.getByRole('button',{name:'Word',exact:true}).click();
    assert((await draft.textContent()).includes('실패 후에도 보존'));
    console.log('Hangul load failure preserves Word session');
  } finally { await isolated.close(); }
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  assert.deepEqual([...external], []);
  console.log('Root integration PASS: original protection, copy save, external modification detection; OS pickers remain manual');
} finally {
  await browser?.close();
  if (dev) await server?.close();
  else if (server) await new Promise((resolveClose, reject) => server.httpServer.close(error => error ? reject(error) : resolveClose()));
}
