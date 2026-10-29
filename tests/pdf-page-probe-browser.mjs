import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright-core';
const server = await createServer({ configFile: false, plugins: [svelte()], optimizeDeps: { entries: ['tests/pdf-page-probe-entry.mjs'], exclude: ['pdfjs-dist'] }, server: { port: 4196, strictPort: true } });
let browser;
try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', e => { errors.push(String(e)); console.log('PAGE ERROR', String(e)); }); page.on('console', m => console.log('BROWSER', m.text()));
    await page.goto('http://localhost:4196/tests/pdf-page-probe.html');
    await page.getByText('A', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output')?.dataset.imports === '1');
    assert.equal(await page.locator('output').getAttribute('data-pages'), '3');
    await page.getByText('controlled', { exact: true }).click();
    await page.getByText('add', { exact: true }).click();
    assert.equal(await page.locator('output').getAttribute('data-ids'), 'controlled,added');
    await page.getByText('undo', { exact: true }).click();
    assert.equal(await page.locator('output').getAttribute('data-ids'), 'controlled');
    await page.getByText('E', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output')?.dataset.imports === '2');
    assert.equal(await page.locator('output').getAttribute('data-pages'), '1');
    assert.equal(await page.locator('output').getAttribute('data-ids'), '');
    assert.equal(await page.locator('output').getAttribute('data-undo'), 'false');
    assert.deepEqual(errors, []);
    console.log('PASS controlled annotations and src replacement: pages, import, history reset; failed 0 skipped 0');
} finally { await browser?.close(); await server.close(); }
