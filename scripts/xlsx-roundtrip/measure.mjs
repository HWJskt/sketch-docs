// Round-trip loss measurement through the product's own path (docs/plans/2026-10-15-xlsx-edit.md stage 0b):
// each .xlsx in <dir> is opened in the built Excel engine over the bridge, snapshotted (what a save writes),
// and compared with src/xlsx/compare.ts; the snapshot is then opened and snapshotted once more, to see
// whether a file the engine wrote comes back unchanged. Needs a build (npm run build, or TEST_DIST).
// node --import ./tests/ts-resolve.mjs scripts/xlsx-roundtrip/measure.mjs <dir> [report.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { compareWorkbooks } from '../../src/xlsx/compare.ts';

const root = resolve(import.meta.dirname, '../..');
const [dir, reportPath] = process.argv.slice(2);
if (!dir) throw new Error('usage: measure.mjs <dir with .xlsx files> [report.json]');
const origin = 'http://localhost:4180';
const harness = `<!doctype html><meta charset="utf-8"><iframe id="engine" style="width:1200px;height:800px;border:0" src="./engines/gridcraft/index.html?host=sketch"></iframe>
<script>
  const frame = document.getElementById('engine');
  window.ready = new Promise(done => addEventListener('message', event => { if (event.source === frame.contentWindow && event.data?.type === 'sketch-xlsx:ready') done(); }));
  const answer = (type, requestId) => new Promise(done => {
    const listen = event => { if (event.source === frame.contentWindow && event.data?.type === type && event.data.requestId === requestId) { removeEventListener('message', listen); done(event.data); } };
    addEventListener('message', listen);
  });
  window.roundTrip = async (requestId, name, bytes) => {
    const buffer = new Uint8Array(bytes).buffer;
    const opened = answer('sketch-xlsx:opened', requestId);
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:open', protocol: 1, requestId, epoch: requestId, name, bytes: buffer }, location.origin, [buffer]);
    const result = await opened;
    if (!result.ok) return { opened: result };
    const snapshot = answer('sketch-xlsx:snapshot', requestId + 0.5);
    frame.contentWindow.postMessage({ type: 'sketch-xlsx:snapshot', protocol: 1, requestId: requestId + 0.5, epoch: requestId }, location.origin);
    const shot = await snapshot;
    return { opened: result, ok: shot.ok, error: shot.error, bytes: shot.bytes instanceof ArrayBuffer ? [...new Uint8Array(shot.bytes)] : null };
  };
</script>`;

let server, browser;
const report = [];
try {
    server = await preview({ root, build: { outDir: resolve(root, process.env.TEST_DIST || 'dist') }, preview: { host: 'localhost', port: 4180, strictPort: true } });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await (await browser.newContext({ locale: 'ko-KR', serviceWorkers: 'block' })).newPage();
    await page.route(origin + '/roundtrip-harness.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: harness }));
    await page.goto(origin + '/roundtrip-harness.html');
    await page.evaluate(() => window.ready);
    let id = 0;
    const trip = async (name, bytes) => {
        const result = await page.evaluate(([i, n, b]) => window.roundTrip(i, n, b), [++id, name, [...bytes]]);
        if (!result.opened.ok) return { error: `open: ${result.opened.code} ${result.opened.error}` };
        if (!result.ok) return { error: `snapshot: ${result.error}`, warnings: result.opened.warnings };
        return { bytes: new Uint8Array(result.bytes), warnings: result.opened.warnings };
    };
    for (const file of readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.includes('.roundtrip')).sort()) {
        const original = new Uint8Array(readFileSync(join(dir, file)));
        const first = await trip(file, original);
        const entry = { file, warnings: first.warnings ?? [], error: first.error };
        if (first.bytes) {
            writeFileSync(join(dir, file.replace(/\.xlsx$/, '.roundtrip.xlsx')), first.bytes);
            entry.differences = compareWorkbooks(original, first.bytes);
            const second = await trip(file, first.bytes);
            entry.stable = second.bytes ? compareWorkbooks(first.bytes, second.bytes) : second.error;
        }
        report.push(entry);
        console.log(`${file}: ${entry.error ?? `${entry.differences.length} differences, ${Array.isArray(entry.stable) ? entry.stable.length : entry.stable} on the second trip`}${entry.warnings.length ? `, warnings: ${entry.warnings.join(' / ')}` : ''}`);
    }
} finally {
    await browser?.close();
    await new Promise(done => server ? server.httpServer.close(done) : done());
}
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`measured ${report.length} files from ${basename(resolve(dir))}`);
