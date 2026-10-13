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
async function openPdf(page, name) {
    const bytes = [...await fixture(name)];
    await page.evaluate(async ({ name, bytes }) => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(name, { create: true });
        const stream = await handle.createWritable(); await stream.write(new Uint8Array(bytes)); await stream.close();
        window.showOpenFilePicker = async () => [handle];
    }, { name, bytes });
    await page.getByRole('button', { name: 'PDF 열기' }).click();
    await page.waitForFunction(() => Number(document.querySelector('.pdf-editor')?.dataset.pages) > 0);
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
    ['the standalone PDF editor opens without requests to other origins', async browser => {
        const { page, errors, external } = await open(browser, '/pdf.html');
        await page.getByRole('region', { name: 'PDF 편집기' }).waitFor();
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
