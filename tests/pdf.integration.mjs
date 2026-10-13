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

/** A page that records page errors and requests to other origins. */
async function open(browser, path) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(30000);
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(?:data|blob):/.test(url)) external.push(url); });
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
