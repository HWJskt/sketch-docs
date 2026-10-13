// PDF editor browser tests against a built output (TEST_DIST, default dist/). npm run verify runs this after
// the shell build for the regular and candidate outputs; `npm run test:pdf` builds first. It never builds itself.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, process.env.TEST_DIST || 'dist');
const port = 4185;
const origin = `http://localhost:${port}`;
const fixture = name => readFile(resolve(root, 'tests/fixtures/pdf', name));

/** Opens a fixture through the editor's open button; the OS picker is replaced by an origin-private file. */
async function openPdf(page, name, { loaded = true } = {}) {
    const bytes = [...await fixture(name)];
    await page.evaluate(async ({ name, bytes }) => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(name, { create: true });
        const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
        window.showOpenFilePicker = async () => [handle];
    }, { name, bytes });
    await page.getByRole('button', { name: 'PDF 열기' }).click();
    // The name changes only when this file replaced the previous one; the page count is then the new one.
    if (loaded) await page.waitForFunction(name => document.querySelector('.pdf-editor .name')?.textContent === name && Number(document.querySelector('.pdf-editor')?.dataset.pages) > 0, name);
}
/**
 * Makes "다른 이름으로 저장" pick an origin-private file `name`. Its writable streams are counted, and with
 * `hold` the first write waits until window.__releaseWrite() is called.
 */
async function saveTarget(page, name, { hold = false } = {}) {
    await page.evaluate(async ({ name, hold }) => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(name, { create: true });
        const stream = await handle.createWritable(); await stream.close();
        window.__writables = 0;
        let release;
        window.__held = hold ? new Promise(resolve => { release = resolve; }) : null;
        window.__releaseWrite = () => release?.();
        const createWritable = handle.createWritable.bind(handle);
        handle.createWritable = async (...args) => { window.__writables++; if (window.__held) await window.__held; return createWritable(...args); };
        window.__saveTarget = handle;
        window.showSaveFilePicker = async () => handle;
    }, { name, hold });
}
const savedBytes = page => page.evaluate(async () => Array.from(new Uint8Array(await (await window.__saveTarget.getFile()).arrayBuffer())));
/** Opens a file previously written to the origin-private folder. */
async function reopen(page, name) {
    await page.evaluate(async name => { const handle = await (await navigator.storage.getDirectory()).getFileHandle(name); window.showOpenFilePicker = async () => [handle]; }, name);
    // data-opens counts documents opened; the name alone may already match (after Save As).
    const opens = Number(await page.locator('.pdf-editor').getAttribute('data-opens'));
    await page.getByRole('button', { name: 'PDF 열기' }).click();
    await page.waitForFunction(({ name, opens }) => { const editor = document.querySelector('.pdf-editor'); return Number(editor?.dataset.opens) > opens && editor.querySelector('.name')?.textContent === name && Number(editor.dataset.pages) > 0; }, { name, opens });
}

/** Draws one annotation of each of the six kinds on page 1 of fixture A, the rectangle in blue. */
async function drawAll(page) {
    const line = async text => page.locator('.pdf-editor span', { hasText: text }).first().boundingBox();
    const drag = async (x1, y1, x2, y2) => {
        await page.mouse.move(x1, y1); await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(x1 + (x2 - x1) * i / 10, y1 + (y2 - y1) * i / 10 + (i % 2) * 3);
        await page.mouse.up(); await page.waitForTimeout(300);
    };
    const across = box => drag(box.x + 2, box.y + box.height / 2, box.x + box.width - 2, box.y + box.height / 2);
    const tool = name => page.getByRole('button', { name, exact: true }).click();
    const first = await line('Page 1'), second = await line('Introduction text');
    await tool('형광펜'); await across(first);
    await tool('밑줄'); await across(second);
    await tool('취소선'); await across(second);
    await tool('펜'); await drag(second.x, second.y + 150, second.x + 150, second.y + 220);
    await page.getByRole('button', { name: '파랑', exact: true }).click();
    await tool('사각형'); await drag(second.x + 250, second.y + 150, second.x + 350, second.y + 220);
    await tool('메모'); await page.mouse.click(second.x + 450, second.y + 100);
    await page.getByRole('textbox', { name: '메모 추가…' }).waitFor();
    await page.keyboard.type('메모 내용');
    await page.mouse.click(second.x + 100, second.y + 400);
    await page.waitForTimeout(300);
}
const kinds = page => page.locator('.pdf-editor [data-pdf-annotation]').evaluateAll(items => items.filter(item => !('foreign' in item.dataset)).map(item => item.dataset.kind).sort());

/** Painted (non-white) pixels on the first page canvas once rendering settles. */
async function ink(page) {
    let count = 0;
    for (let i = 0, last = -1; i < 40; i++, last = count) {
        await page.waitForTimeout(250);
        count = await page.evaluate(() => {
            const canvas = document.querySelector('.pdf-editor canvas');
            if (!canvas?.width) return 0;
            const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            let painted = 0;
            for (let p = 0; p < data.length; p += 4) if (data[p + 3] > 0 && data[p] + data[p + 1] + data[p + 2] < 600) painted++;
            return painted;
        });
        if (count > 0 && count === last) break;
    }
    return count;
}

/** A page that records page errors and requests to other origins; confirm dialogs are accepted unless a test answers them. */
async function open(browser, path, { answerDialogs = true } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(30000);
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(?:data|blob):/.test(url)) external.push(url); });
    if (answerDialogs) page.on('dialog', dialog => dialog.accept());
    await page.goto(origin + path);
    return { page, errors, external };
}

const scenarios = [
    ['the PDF editor opens in the shell without requests to other origins', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'PDF', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
    }],
    ['a PDF opens and its first page is drawn', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-pages'), '3');
        assert.ok(await ink(page) > 1000, 'page 1 has painted text');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
    }],
    ['Korean CID text is drawn with character maps from our deployment, and a missing map leaves the page blank', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        const cmaps = [];
        page.on('response', response => { if (response.url().includes('/cmaps/')) cmaps.push(`${response.status()} ${new URL(response.url()).pathname}`); });
        await openPdf(page, 'b-korean-cid.pdf');
        assert.ok(await ink(page) > 200, 'Korean glyphs are painted');
        assert.ok(cmaps.some(line => /^200 \/pdfjs\/[\d.]+\/cmaps\/UniKS-UCS2-H\.bcmap$/.test(line)), cmaps.join(', '));
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
        // The check above must be able to fail: without the map pdf.js opens the file but draws nothing.
        const broken = await open(browser, '/pdf.html');
        await broken.page.route('**/cmaps/**', route => route.fulfill({ status: 404, body: '' }));
        await openPdf(broken.page, 'b-korean-cid.pdf');
        assert.equal(await ink(broken.page), 0, 'no glyphs without the character map');
        await broken.page.close();
    }],
    ['zoom in and out, and fit the page width or the whole page', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        const editor = page.locator('.pdf-editor');
        const state = async () => ({ zoom: Number(await editor.getAttribute('data-zoom')), mode: await editor.getAttribute('data-zoom-mode') });
        // Width and height of page 1 and of the scrolling area, in CSS pixels.
        const sizes = () => page.evaluate(() => {
            const canvas = document.querySelector('.pdf-editor canvas').getBoundingClientRect();
            const viewport = document.querySelector('.pdf-editor .viewport');
            return { page: [canvas.width, canvas.height], view: [viewport.clientWidth, viewport.clientHeight] };
        });
        const settle = async () => { await page.waitForTimeout(600); return sizes(); };
        const start = await state();
        assert.equal(start.mode, 'page-width');
        const width = await settle();
        assert.ok(width.page[0] > width.view[0] * 0.85 && width.page[0] <= width.view[0], `page width fills the view: ${JSON.stringify(width)}`);
        await page.getByRole('button', { name: '확대' }).click();
        await page.waitForFunction(before => Number(document.querySelector('.pdf-editor').dataset.zoom) > before, start.zoom);
        assert.equal((await state()).mode, 'manual');
        await page.getByRole('button', { name: '축소' }).click();
        await page.getByRole('button', { name: '축소' }).click();
        await page.waitForFunction(before => Number(document.querySelector('.pdf-editor').dataset.zoom) < before, start.zoom);
        await page.getByRole('button', { name: '쪽 전체' }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.zoomMode === 'page-fit');
        const fit = await settle();
        assert.ok(fit.page[1] <= fit.view[1] && fit.page[1] > fit.view[1] * 0.85, `the whole page fits the height: ${JSON.stringify(fit)}`);
        assert.ok(fit.page[0] < width.page[0], 'a portrait page is narrower when the whole page fits');
        await page.getByRole('button', { name: '쪽 너비' }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.zoomMode === 'page-width');
        assert.ok(Math.abs((await settle()).page[0] - width.page[0]) < 2, 'page width again');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['move between pages with the previous/next buttons and the page number box', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        const at = n => page.waitForFunction(n => document.querySelector('.pdf-editor').dataset.page === String(n), n);
        await at(1);
        await page.getByRole('button', { name: '다음 쪽' }).click(); await at(2);
        await page.getByRole('button', { name: '다음 쪽' }).click(); await at(3);
        assert.ok(await page.getByRole('button', { name: '다음 쪽' }).isDisabled(), 'no page after the last');
        await page.getByRole('button', { name: '이전 쪽' }).click(); await at(2);
        const box = page.getByRole('textbox', { name: '쪽 (1–3)' });
        await box.fill('1'); await box.press('Enter'); await at(1);
        assert.equal(await box.inputValue(), '1');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['find ignores case and accents: "Résumé" and "resume" find the same matches', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        const input = page.getByRole('searchbox', { name: '문서에서 찾기' });
        const count = page.locator('.find-count');
        const total = async query => {
            await input.fill(query);
            await page.waitForFunction(() => /^\d+ \/ \d+$/.test(document.querySelector('.find-count')?.textContent.trim() ?? ''));
            return Number((await count.textContent()).trim().split('/')[1]);
        };
        const accented = await total('Résumé');
        const plain = await total('resume');
        assert.equal(accented, 2, 'page 1 "Résumé" and page 2 "resume"');
        assert.equal(plain, accented);
        await page.getByRole('button', { name: '다음 결과' }).click();
        await page.waitForFunction(() => document.querySelector('.find-count').textContent.trim() === '2 / 2');
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.page === '2');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['the outline lists the document headings and jumps to their page', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.getByRole('button', { name: '목차' }).click();
        const outline = page.getByRole('complementary', { name: '목차' });
        await outline.getByRole('treeitem').nth(1).waitFor();
        assert.deepEqual((await outline.getByRole('treeitem').allTextContents()).map(text => text.trim()), ['Introduction', 'Chapter 2']);
        await outline.getByRole('treeitem', { name: 'Chapter 2' }).getByRole('button').click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.page === '2');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['thumbnails show every page and jump to the one clicked', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.getByRole('button', { name: '썸네일' }).click();
        const items = page.getByRole('complementary', { name: '썸네일' }).getByRole('option');
        await items.nth(2).waitFor();
        assert.deepEqual((await items.allTextContents()).map(text => text.trim()), ['1', '2', '3']);
        await page.waitForFunction(() => document.querySelector('.panel [data-pdf-thumbnail][data-rendered] canvas'), null, { timeout: 15000 });
        await items.nth(2).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.page === '3');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['selected text is copied to the clipboard', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await openPdf(page, 'a-basic.pdf');
        const line = page.locator('.pdf-editor [data-pdf-text-layer] span', { hasText: 'Introduction text' }).first();
        await line.waitFor();
        await line.selectText();
        await page.keyboard.press('ControlOrMeta+C');
        await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('Introduction text'));
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['print hands the PDF to the browser print dialog', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        // Counts print() calls from any frame (the PDF is printed from a hidden frame).
        await page.exposeFunction('__printed', () => { page.__prints = (page.__prints ?? 0) + 1; });
        await page.context().addInitScript(() => { window.print = () => { window.top.__printed?.() ?? window.__printed?.(); }; });
        await openPdf(page, 'a-basic.pdf');
        const before = page.frames().length;
        await page.getByRole('button', { name: '인쇄' }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(frame => frame.src.startsWith('blob:')));
        for (let i = 0; i < 40 && !page.__prints; i++) await page.waitForTimeout(250);
        assert.equal(page.__prints, 1, `print called once (frames ${before} -> ${page.frames().length})`);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['an encrypted PDF asks for its password, asks again when it is wrong, then opens', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        await openPdf(page, 'd-encrypted.pdf', { loaded: false });
        const field = page.getByLabel('암호로 보호된 PDF입니다. 암호를 입력하세요.');
        await field.fill('wrong');
        await page.getByRole('button', { name: '열기', exact: true }).click();
        const again = page.getByLabel('암호가 틀렸습니다. 다시 입력하세요.');
        await again.waitFor();
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-pages'), '0');
        await again.fill('test');
        await page.getByRole('button', { name: '열기', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.pages === '1');
        assert.ok(await ink(page) > 200, 'the decrypted page is drawn');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
    }],
    ['switching to Word and Hangul and back keeps the open PDF, its page and name', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.getByRole('button', { name: '다음 쪽' }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.page === '2');
        assert.equal(await page.getByLabel('현재 파일 이름').textContent(), 'a-basic.pdf');
        await page.getByRole('button', { name: 'Word', exact: true }).click();
        await page.locator('iframe[title="Word 문서 편집기"]').contentFrame().locator('.tiptap').first().waitFor({ timeout: 60000 });
        await page.locator('iframe[title="Word 문서 편집기"]').contentFrame().locator('.product-header').getByRole('button', { name: '한글', exact: true }).click();
        await page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor({ timeout: 60000 });
        await page.locator('iframe[title="한글 문서 편집기"]').contentFrame().locator('.product-header').getByRole('button', { name: 'PDF', exact: true }).click();
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-page'), '2');
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-pages'), '3');
        assert.equal(await page.getByLabel('현재 파일 이름').textContent(), 'a-basic.pdf');
        assert.ok(await ink(page) > 1000, 'the page is still drawn');
        assert.equal(new URL(page.url()).pathname, '/pdf.html');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['a slow earlier open never replaces a later one, and a failed read keeps the open document', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        const slow = [...await fixture('e-image.pdf')], later = [...await fixture('c2-empty-signature.pdf')];
        await page.evaluate(async ({ slow, later }) => {
            const directory = await navigator.storage.getDirectory();
            const write = async (name, bytes) => { const handle = await directory.getFileHandle(name, { create: true }); const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close(); return handle; };
            const slowHandle = await write('slow.pdf', slow), laterHandle = await write('later.pdf', later);
            let release;
            window.__releaseSlow = new Promise(resolve => { release = resolve; });
            window.__release = release;
            const held = { getFile: async () => { await window.__releaseSlow; return slowHandle.getFile(); } };
            const queue = [held, laterHandle, { getFile: async () => { throw new Error('read failed'); } }];
            window.showOpenFilePicker = async () => [queue.shift()];
        }, { slow, later });
        const button = page.getByRole('button', { name: 'PDF 열기' });
        await button.click();
        await button.click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.pages === '1' && document.querySelector('.pdf-editor .name').textContent === 'later.pdf');
        await page.evaluate(() => window.__release());
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.pdf-editor .name').textContent(), 'later.pdf', 'the slow first choice arrived late and was ignored');
        await button.click();
        await page.getByRole('alert').filter({ hasText: 'read failed' }).waitFor();
        assert.equal(await page.locator('.pdf-editor .name').textContent(), 'later.pdf');
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-pages'), '1', 'the open document is untouched');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['opening another file starts at page width again, so the zoom shown is the zoom used', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.getByRole('button', { name: '확대' }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.zoomMode === 'manual');
        await openPdf(page, 'e-image.pdf');
        assert.equal(await page.locator('.pdf-editor').getAttribute('data-zoom-mode'), 'page-width');
        await page.waitForTimeout(600);
        const fit = await page.evaluate(() => {
            const canvas = document.querySelector('.pdf-editor canvas').getBoundingClientRect().width;
            return { canvas, view: document.querySelector('.pdf-editor .viewport').clientWidth, shown: document.querySelector('.pdf-editor .zoom').textContent };
        });
        assert.ok(fit.canvas > fit.view * 0.85 && fit.canvas <= fit.view, JSON.stringify(fit));
        assert.equal(fit.shown, `${Math.round(Number(await page.locator('.pdf-editor').getAttribute('data-zoom')) * 100)}%`);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['print is unavailable until the document is open (for example while its password is asked)', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'd-encrypted.pdf', { loaded: false });
        await page.getByLabel('암호로 보호된 PDF입니다. 암호를 입력하세요.').waitFor();
        assert.ok(await page.getByRole('button', { name: '인쇄' }).isDisabled());
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['in a 600px wide window the view tools wrap and stay on screen', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await page.setViewportSize({ width: 600, height: 800 });
        await openPdf(page, 'a-basic.pdf');
        for (const control of [page.getByRole('searchbox', { name: '문서에서 찾기' }), page.getByRole('button', { name: '다음 결과' }), page.getByRole('button', { name: '인쇄' })]) {
            const box = await control.boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= 600, `${await control.getAttribute('aria-label') ?? await control.textContent()} at ${JSON.stringify(box)}`);
        }
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['without the File System Access API the file input opens a PDF', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await page.evaluate(() => { delete window.showOpenFilePicker; });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'PDF 열기' }).click();
        await (await chooser).setFiles(resolve(root, 'tests/fixtures/pdf/a-basic.pdf'));
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.pages === '3');
        assert.equal(await page.locator('.pdf-editor input[type=file]').inputValue(), '', 'cleared so the same file can be chosen again');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['annotations already in the file are shown read-only and do not make the document unsaved', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('.product-document-dirty').count(), 0, 'no unsaved marker in the header');
        assert.ok(await page.getByRole('button', { name: '실행 취소' }).isDisabled());
        assert.ok(await page.getByRole('button', { name: '다시 실행' }).isDisabled());
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['the six annotation kinds are drawn, and undo and redo take them all away and back', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        await drawAll(page);
        const six = ['highlight', 'ink', 'note', 'rect', 'strikeout', 'underline'];
        assert.deepEqual(await kinds(page), six);
        assert.equal(await page.locator('.pdf-editor [data-pdf-annotation][data-kind=rect]').getAttribute('data-color'), 'blue');
        assert.equal(await page.locator('.pdf-editor [data-pdf-annotation][data-kind=highlight]').getAttribute('data-color'), 'yellow');
        assert.equal(await page.locator('.product-document-dirty').count(), 1, 'unsaved marker');
        // The new note keeps its text: opening it shows the text again.
        await page.getByRole('button', { name: '선택', exact: true }).click();
        await page.locator('.pdf-editor [data-pdf-annotation][data-kind=note]:not([data-foreign])').click({ force: true });
        await page.getByText('메모 내용').first().waitFor();
        await page.keyboard.press('Escape');
        const undo = page.getByRole('button', { name: '실행 취소' }), redo = page.getByRole('button', { name: '다시 실행' });
        for (let i = 0; i < 20 && !await undo.isDisabled(); i++) await undo.click();
        assert.deepEqual(await kinds(page), []);
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('.product-document-dirty').count(), 0, 'back to the opened file');
        for (let i = 0; i < 20 && !await redo.isDisabled(); i++) await redo.click();
        assert.deepEqual(await kinds(page), six);
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        assert.ok(await ink(page) > 1000, 'the page is still drawn under the annotations');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['annotations can be drawn on signed and encrypted PDFs too', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        const rectangle = async () => {
            const box = await page.locator('.pdf-editor canvas').first().boundingBox();
            await page.getByRole('button', { name: '사각형', exact: true }).click();
            await page.mouse.move(box.x + 100, box.y + 300); await page.mouse.down();
            await page.mouse.move(box.x + 180, box.y + 360, { steps: 8 }); await page.mouse.up();
            await page.locator('.pdf-editor [data-pdf-annotation][data-kind=rect]').waitFor({ state: 'attached' });
        };
        await openPdf(page, 'c1-signed.pdf');
        await rectangle();
        await openPdf(page, 'd-encrypted.pdf', { loaded: false });
        await page.getByLabel('암호로 보호된 PDF입니다. 암호를 입력하세요.').fill('test');
        await page.getByRole('button', { name: '열기', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor').dataset.pages === '1' && document.querySelector('.pdf-editor .name').textContent === 'd-encrypted.pdf');
        await page.waitForTimeout(500);
        await rectangle();
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['PDF annotations, unsaved state and undo history survive switching to Word and Hangul and back', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        await drawAll(page);
        const before = await kinds(page);
        await page.getByRole('button', { name: 'Word', exact: true }).click();
        const word = page.locator('iframe[title="Word 문서 편집기"]').contentFrame();
        await word.locator('.tiptap').first().waitFor({ timeout: 60000 });
        await word.locator('.tiptap').first().click();
        await page.keyboard.insertText('워드 전환 시험');
        await word.locator('.product-header').getByRole('button', { name: '한글', exact: true }).click();
        await page.getByRole('status').filter({ hasText: '새 문서입니다' }).waitFor({ timeout: 60000 });
        await page.locator('iframe[title="한글 문서 편집기"]').contentFrame().locator('.product-header').getByRole('button', { name: 'PDF', exact: true }).click();
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
        assert.deepEqual(await kinds(page), before);
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        // The last steps were the note and its text: undo until one annotation is gone, then redo all.
        let undone = 0;
        while ((await kinds(page)).length === before.length && undone < 3) { await page.getByRole('button', { name: '실행 취소' }).click(); undone++; }
        assert.equal((await kinds(page)).length, before.length - 1, `undo removed one annotation after ${undone} steps`);
        for (let i = 0; i < undone; i++) await page.getByRole('button', { name: '다시 실행' }).click();
        assert.deepEqual(await kinds(page), before, 'history continues after switching back');
        await page.getByRole('button', { name: 'Word', exact: true }).click();
        assert.match(await word.locator('.tiptap').first().textContent(), /워드 전환 시험/, 'the Word document kept its text');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['Save As writes the six annotations into a new PDF that opens with them, and the document is saved', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        await drawAll(page);
        const six = await kinds(page);
        await saveTarget(page, 'saved-as.pdf');
        await page.getByRole('button', { name: '다른 이름으로 저장' }).click();
        await page.getByRole('status').filter({ hasText: 'saved-as.pdf에 저장했습니다' }).waitFor({ timeout: 60000 });
        assert.equal(await page.locator('.product-document-dirty').count(), 0, 'saved');
        assert.equal(await page.getByLabel('현재 파일 이름').textContent(), 'saved-as.pdf');
        assert.equal(Buffer.from(await savedBytes(page)).subarray(0, 5).toString(), '%PDF-');
        await reopen(page, 'saved-as.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        await page.waitForFunction(count => document.querySelectorAll('.pdf-editor [data-pdf-annotation]:not([data-foreign])').length === count, six.length);
        assert.deepEqual(await kinds(page), six);
        assert.equal(await page.locator('.pdf-editor [data-pdf-annotation][data-kind=rect]').getAttribute('data-color'), 'blue');
        assert.equal(await page.locator('.product-document-dirty').count(), 0, 'reopened: nothing unsaved');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        await page.close();
    }],
    ['signed and encrypted PDFs are not saved: the reason is shown and the target is never opened for writing', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        const rectangle = async () => {
            const box = await page.locator('.pdf-editor canvas').first().boundingBox();
            await page.getByRole('button', { name: '사각형', exact: true }).click();
            await page.mouse.move(box.x + 100, box.y + 300); await page.mouse.down();
            await page.mouse.move(box.x + 180, box.y + 360, { steps: 8 }); await page.mouse.up();
        };
        await openPdf(page, 'c1-signed.pdf');
        await rectangle();
        await saveTarget(page, 'signed-copy.pdf');
        await page.getByRole('button', { name: '다른 이름으로 저장' }).click();
        await page.getByRole('alert').filter({ hasText: '서명된 PDF는 저장하지 않습니다' }).waitFor({ timeout: 60000 });
        assert.equal(await page.evaluate(() => window.__writables), 0);
        assert.equal((await savedBytes(page)).length, 0);
        assert.equal(await page.locator('.product-document-dirty').count(), 1, 'still unsaved');
        await openPdf(page, 'd-encrypted.pdf', { loaded: false });
        await page.getByLabel('암호로 보호된 PDF입니다. 암호를 입력하세요.').fill('test');
        await page.getByRole('button', { name: '열기', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.pdf-editor .name').textContent === 'd-encrypted.pdf' && document.querySelector('.pdf-editor').dataset.pages === '1');
        await page.waitForTimeout(500);
        await rectangle();
        await saveTarget(page, 'encrypted-copy.pdf');
        await page.getByRole('button', { name: '다른 이름으로 저장' }).click();
        await page.getByRole('alert').filter({ hasText: '암호로 보호된 PDF는 저장하지 않습니다' }).waitFor({ timeout: 60000 });
        assert.equal(await page.evaluate(() => window.__writables), 0);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['an annotation added while saving stays unsaved afterwards', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'e-image.pdf');
        const box = await page.locator('.pdf-editor canvas').first().boundingBox();
        const rectangle = async (x, y) => {
            await page.getByRole('button', { name: '사각형', exact: true }).click();
            await page.mouse.move(box.x + x, box.y + y); await page.mouse.down();
            await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 8 }); await page.mouse.up();
        };
        await rectangle(100, 100);
        await saveTarget(page, 'while-saving.pdf', { hold: true });
        await page.getByRole('button', { name: '다른 이름으로 저장' }).click();
        await page.waitForFunction(() => window.__writables === 1);
        await rectangle(300, 300);
        await page.evaluate(() => window.__releaseWrite());
        await page.getByRole('status').filter({ hasText: 'while-saving.pdf에 저장했습니다' }).waitFor({ timeout: 60000 });
        assert.equal(await page.locator('.product-document-dirty').count(), 1, 'the second rectangle is not in the file');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['Ctrl+S saves back into the opened file, after keeping the original once for recovery', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').waitFor({ state: 'attached' });
        const box = await page.locator('.pdf-editor canvas').first().boundingBox();
        const rectangle = async (x, y) => {
            await page.getByRole('button', { name: '사각형', exact: true }).click();
            await page.mouse.move(box.x + x, box.y + y); await page.mouse.down();
            await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 8 }); await page.mouse.up();
        };
        const fileBytes = () => page.evaluate(async () => Array.from(new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle('a-basic.pdf')).getFile()).arrayBuffer())));
        const copies = () => page.evaluate(async () => {
            const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('sketch-docs-recovery', { create: true });
            const found = [];
            for await (const [name, entry] of folder) found.push({ name, bytes: Array.from(new Uint8Array(await (await entry.getFile()).arrayBuffer())) });
            return found;
        });
        const original = [...await fixture('a-basic.pdf')];
        await rectangle(100, 400);
        await page.keyboard.press('ControlOrMeta+S');
        await page.getByRole('status').filter({ hasText: 'a-basic.pdf에 저장했습니다' }).waitFor({ timeout: 60000 });
        assert.equal(await page.locator('.product-document-dirty').count(), 0);
        assert.notDeepEqual(await fileBytes(), original, 'the opened file was written');
        let kept = await copies();
        assert.equal(kept.length, 1);
        assert.match(kept[0].name, /--a-basic\.pdf$/);
        assert.deepEqual(kept[0].bytes, original, 'the recovery copy is the file before the save');
        await rectangle(300, 400);
        await page.getByRole('button', { name: '저장', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.product-document-dirty') && /저장했습니다/.test(document.querySelector('.pdf-editor .saved')?.textContent ?? ''));
        kept = await copies();
        assert.equal(kept.length, 1, 'still only the original');
        await reopen(page, 'a-basic.pdf');
        await page.waitForFunction(() => document.querySelectorAll('.pdf-editor [data-pdf-annotation][data-kind=rect]').length === 2);
        assert.equal(await page.locator('.pdf-editor [data-pdf-annotation="fixture-existing-note"]').count(), 1);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['a file changed elsewhere after opening is not overwritten', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'e-image.pdf');
        const box = await page.locator('.pdf-editor canvas').first().boundingBox();
        await page.getByRole('button', { name: '사각형', exact: true }).click();
        await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down();
        await page.mouse.move(box.x + 160, box.y + 140, { steps: 8 }); await page.mouse.up();
        await page.evaluate(async () => { const handle = await (await navigator.storage.getDirectory()).getFileHandle('e-image.pdf'); const stream = await handle.createWritable(); await stream.write('changed elsewhere'); await stream.close(); });
        await page.keyboard.press('ControlOrMeta+S');
        await page.getByRole('alert').filter({ hasText: '외부에서 변경' }).waitFor({ timeout: 60000 });
        assert.equal(await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('e-image.pdf')).getFile()).text()), 'changed elsewhere');
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['two tabs saving the same file at once: one is written, the other is refused and stays unsaved', async browser => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        try {
            const bytes = [...await fixture('e-image.pdf')];
            const tabs = [];
            for (const index of [0, 1]) {
                const page = await context.newPage();
                await page.goto(origin + '/pdf.html');
                if (index === 0) await page.evaluate(async bytes => { const handle = await (await navigator.storage.getDirectory()).getFileHandle('shared.pdf', { create: true }); const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close(); }, bytes);
                await reopen(page, 'shared.pdf');
                const box = await page.locator('.pdf-editor canvas').first().boundingBox();
                await page.getByRole('button', { name: '사각형', exact: true }).click();
                await page.mouse.move(box.x + 100 + index * 200, box.y + 100); await page.mouse.down();
                await page.mouse.move(box.x + 160 + index * 200, box.y + 140, { steps: 8 }); await page.mouse.up();
                tabs.push(page);
            }
            await Promise.all(tabs.map(page => page.getByRole('button', { name: '저장', exact: true }).click()));
            const results = await Promise.all(tabs.map(async page => {
                await page.waitForFunction(() => document.querySelector('.pdf-editor .saved') || document.querySelector('.pdf-editor [role=alert]'), null, { timeout: 60000 });
                return { saved: await page.locator('.pdf-editor .saved').count(), refused: await page.getByRole('alert').filter({ hasText: '외부에서 변경' }).count(), dirty: await page.locator('.product-document-dirty').count() };
            }));
            assert.deepEqual(results.map(r => r.saved).sort(), [0, 1], JSON.stringify(results));
            const loser = results.find(r => r.saved === 0);
            assert.deepEqual([loser.refused, loser.dirty], [1, 1]);
        } finally { await context.close(); }
    }],
    ['the original kept before the first overwrite can be restored to a new file', async browser => {
        const { page, errors } = await open(browser, '/pdf.html');
        await openPdf(page, 'a-basic.pdf');
        await page.getByRole('button', { name: '저장 전 원본 복원' }).click();
        await page.getByRole('region', { name: '보관한 원본' }).getByText('보관한 원본이 없습니다').waitFor();
        await page.getByRole('button', { name: '저장 전 원본 복원' }).click();
        const box = await page.locator('.pdf-editor canvas').first().boundingBox();
        await page.getByRole('button', { name: '사각형', exact: true }).click();
        await page.mouse.move(box.x + 100, box.y + 400); await page.mouse.down();
        await page.mouse.move(box.x + 160, box.y + 440, { steps: 8 }); await page.mouse.up();
        await page.keyboard.press('ControlOrMeta+S');
        await page.getByRole('status').filter({ hasText: 'a-basic.pdf에 저장했습니다' }).waitFor({ timeout: 60000 });
        await page.getByRole('button', { name: '저장 전 원본 복원' }).click();
        await saveTarget(page, 'restored.pdf');
        await page.getByRole('region', { name: '보관한 원본' }).getByRole('button', { name: /^a-basic\.pdf · / }).click();
        await page.getByRole('status').filter({ hasText: 'restored.pdf(으)로 저장했습니다' }).waitFor();
        assert.deepEqual(await savedBytes(page), [...await fixture('a-basic.pdf')], 'the restored file is the original');
        assert.deepEqual(errors, []);
        await page.close();
    }],
    ['unsaved annotations: opening another PDF, going back to the start page and closing the tab ask first', async browser => {
        const { page, errors } = await open(browser, '/', { answerDialogs: false });
        const dialogs = [];
        let answer = false;
        page.on('dialog', async dialog => { dialogs.push(dialog.type()); await (answer ? dialog.accept() : dialog.dismiss()); });
        await page.getByRole('link', { name: /PDF 문서/ }).click();
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
        await openPdf(page, 'a-basic.pdf');
        const box = await page.locator('.pdf-editor canvas').first().boundingBox();
        await page.getByRole('button', { name: '사각형', exact: true }).click();
        await page.mouse.move(box.x + 100, box.y + 400); await page.mouse.down();
        await page.mouse.move(box.x + 160, box.y + 440, { steps: 8 }); await page.mouse.up();
        await page.locator('.product-document-dirty').waitFor();
        // Another PDF: cancelled, the document and its unsaved state stay.
        await page.evaluate(() => { window.__opened = 0; const previous = window.showOpenFilePicker; window.showOpenFilePicker = async (...args) => { window.__opened++; return previous(...args); }; });
        await page.getByRole('button', { name: 'PDF 열기' }).click();
        await page.waitForTimeout(300);
        assert.deepEqual(dialogs, ['confirm']);
        assert.equal(await page.evaluate(() => window.__opened), 0, 'no file picker after cancelling');
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        // Back to the start page: cancelled, still in the editor.
        await page.goBack();
        await page.waitForTimeout(500);
        assert.deepEqual(dialogs, ['confirm', 'confirm']);
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
        assert.equal(await page.locator('.pdf-editor .name').textContent(), 'a-basic.pdf');
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        // Leaving the page (closing the tab or going elsewhere): the browser asks; staying keeps everything.
        // page.close({ runBeforeUnload }) did not raise the prompt in headless Chrome; a real navigation does.
        const here = page.url();
        await page.goto(origin + '/word.html').catch(error => assert.match(String(error), /ERR_ABORTED/));
        assert.equal(dialogs.at(-1), 'beforeunload');
        assert.equal(page.url(), here);
        assert.equal(await page.locator('.product-document-dirty').count(), 1);
        // Accepting another PDF opens it.
        answer = true;
        await openPdf(page, 'e-image.pdf');
        assert.equal(await page.locator('.product-document-dirty').count(), 0);
        assert.deepEqual(errors, []);
        page.removeAllListeners('dialog');
        await page.close();
    }],
];

let server, browser;
try {
    server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { host: 'localhost', port, strictPort: true } });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const [name, run] of scenarios) {
        await run(browser);
        console.log(`PASS pdf: ${name}`);
    }
} finally {
    await browser?.close();
    await server?.close();
}
