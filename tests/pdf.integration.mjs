// PDF editor browser tests against a built output (TEST_DIST, default dist/). npm run verify runs this after
// the shell build for the regular and candidate outputs; `npm run test:pdf` builds first. It never builds itself.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, process.env.TEST_DIST || 'dist');
const port = 4185;
const origin = `http://localhost:${port}`;

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
