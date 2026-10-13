// Step 0b of docs/plans/2026-10-13-pdf-viewer.md: installs svelte-pdf-mini in a scratch folder and
// checks the facts the plan depends on. Prints one JSON report; exit 1 when a required item fails.
// Usage: node scripts/pdf-probe/run.mjs --dir <scratch folder>
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

export const PACKAGE = 'svelte-pdf-mini@0.9.1';
// Build tools pinned to the versions the product uses.
const TOOLS = ['vite@8.0.14', '@sveltejs/vite-plugin-svelte@7.1.2'];
const SYMBOLS = {
    'svelte-pdf-mini': ['configurePdf', 'Document', 'Viewer', 'Zoom', 'PageNav', 'Find', 'Outline', 'Thumbnails', 'Annotations'],
    'svelte-pdf-mini/pdf-codec': ['exportPdf', 'importAnnotations', 'saveSupport', 'PdfSaveError'],
};
const here = import.meta.dirname;
const fixtures = resolve(here, '../../tests/fixtures/pdf');
const PORT = 4183;
const origin = `http://localhost:${PORT}`;

const arg = process.argv.indexOf('--dir');
if (arg < 0 || !process.argv[arg + 1]) { console.error('usage: node scripts/pdf-probe/run.mjs --dir <scratch folder>'); process.exit(2); }
const dir = resolve(process.argv[arg + 1]);
const report = { package: PACKAGE, dir, items: {} };
const item = (key, pass, data) => { report.items[key] = { pass, ...data }; };

// The folder is ours to overwrite and clear only if it is new, empty, or marked by an earlier run.
const MARK = '.pdf-probe-folder';
await mkdir(dir, { recursive: true });
const present = await readdir(dir);
if (present.length && !present.includes(MARK)) { console.error(`${dir} is not empty and was not created by this probe; choose a new folder`); process.exit(2); }
await writeFile(join(dir, MARK), 'Created by scripts/pdf-probe/run.mjs; safe to delete.\n');
// Lifecycle scripts stay off: the packages are only read and bundled.
await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'pdf-probe', private: true, type: 'module' }));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', PACKAGE, ...TOOLS], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
const require = createRequire(join(dir, 'package.json'));
const modules = join(dir, 'node_modules');
// Read from disk: packages whose `exports` omit package.json cannot be required for it.
const pkg = name => JSON.parse(readFileSync(join(modules, name, 'package.json'), 'utf8'));

// 1. Installed metadata, public symbols, asset paths.
{
    const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'));
    const entry = name => lock.packages[`node_modules/${name}`];
    const mini = pkg('svelte-pdf-mini');
    const missing = [];
    for (const [specifier, names] of Object.entries(SYMBOLS)) {
        const types = mini.exports[specifier === 'svelte-pdf-mini' ? '.' : `./${specifier.split('/')[1]}`].types;
        const declared = new Set();
        const visit = async file => {
            const text = await readFile(file, 'utf8');
            for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:function|class|const)\s+(\w+)|export\s*\{([^}]*)\}/g)) {
                if (match[1]) declared.add(match[1]);
                else for (const part of match[2].split(',')) declared.add(part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop());
            }
            for (const match of text.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) await visit(resolve(file, '..', match[1].replace(/\.js$/, '.d.ts')));
        };
        await visit(join(modules, 'svelte-pdf-mini', types));
        for (const name of names) if (!declared.has(name)) missing.push(`${specifier}:${name}`);
    }
    const pdfjs = join(modules, 'pdfjs-dist');
    const assets = {};
    for (const path of ['build/pdf.worker.min.mjs', 'cmaps/UniKS-UCS2-H.bcmap', 'standard_fonts', 'wasm', 'iccs']) assets[path] = await stat(join(pdfjs, path)).then(() => true, () => false);
    const runtime = Object.keys(mini.dependencies).map(name => ({ name, version: entry(name)?.version, license: pkg(name).license }));
    item('1-metadata', missing.length === 0 && Object.values(assets).every(Boolean), {
        version: mini.version, integrity: entry('svelte-pdf-mini').integrity, license: mini.license,
        peer: mini.peerDependencies, installedSvelte: entry('svelte').version, exports: Object.keys(mini.exports),
        dependencies: runtime, pdfjsVersion: pkg('pdfjs-dist').version, assets, missingSymbols: missing,
    });
}

// 0 and 5. Fixtures open in pdf.js; pdf-lib reads what detection and the preservation check need.
const pdfjs = await import(pathToFileURL(join(modules, 'pdfjs-dist/legacy/build/pdf.mjs')).href);
const pdfLib = await import(pathToFileURL(require.resolve('@cantoo/pdf-lib')).href);
const codec = await import(pathToFileURL(join(modules, 'svelte-pdf-mini/dist/core/pdf-codec/index.js')).href);
{
    const expected = { 'a-basic.pdf': 3 };
    const pages = {};
    for (const name of (await readdir(fixtures)).sort()) {
        const data = () => new Uint8Array(readFileSync(join(fixtures, name)));
        const options = { cMapUrl: join(modules, 'pdfjs-dist/cmaps/'), cMapPacked: true, verbosity: 0 };
        let task = pdfjs.getDocument({ ...options, data: data() }), document, password = false;
        try { document = await task.promise; }
        catch (error) {
            if (error.name !== 'PasswordException') { pages[name] = String(error); continue; }
            password = true;
            task = pdfjs.getDocument({ ...options, data: data(), password: 'test' });
            document = await task.promise;
        }
        pages[name] = { pages: document.numPages, password };
        await task.destroy();
    }
    const wrong = Object.entries(pages).filter(([name, got]) => got.pages !== (expected[name] ?? 1) || got.password !== (name === 'd-encrypted.pdf'));
    item('0-fixtures', wrong.length === 0, { pages });
}
{
    const { PDFDocument, PDFName, PDFDict, PDFArray } = pdfLib;
    const load = (name, options = {}) => PDFDocument.load(readFileSync(join(fixtures, name)), { updateMetadata: false, ...options });
    const fieldValue = async name => {
        const doc = await load(name);
        const fields = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('Fields'), PDFArray);
        return fields.lookup(0, PDFDict).get(PDFName.of('V')) !== undefined;
    };
    const signed = await fieldValue('c1-signed.pdf');
    const emptySignature = await fieldValue('c2-empty-signature.pdf');
    // Loading without a password must fail; the message is recorded for the detection code.
    let encryptedLoadError = '';
    try { await load('d-encrypted.pdf'); } catch (error) { encryptedLoadError = String(error?.message ?? error); }
    const encryptedMarked = (await load('d-encrypted.pdf', { ignoreEncryption: true })).isEncrypted;
    const image = (await load('e-image.pdf')).getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).has(PDFName.of('Im1'));
    const f = await load('f-page-attributes.pdf');
    const pageAttributes = ['UserUnit', 'Group'].every(key => f.getPage(0).node.get(PDFName.of(key)) !== undefined);
    const catalogAttributes = ['PageLabels', 'XSketchTest'].every(key => f.catalog.get(PDFName.of(key)) !== undefined);
    // The export's final cross-reference: page 1 of A carries the original 2 annotations plus ours.
    const { ANNOTATIONS } = await import(pathToFileURL(join(here, 'app/src/annotations.js')).href);
    const output = await codec.exportPdf(new Uint8Array(readFileSync(join(fixtures, 'a-basic.pdf'))), ANNOTATIONS);
    const exported = await PDFDocument.load(output, { updateMetadata: false });
    const annots = exported.getPage(0).node.Annots()?.size() ?? 0;
    const support = { c1: await codec.saveSupport(readFileSync(join(fixtures, 'c1-signed.pdf'))), d: await codec.saveSupport(readFileSync(join(fixtures, 'd-encrypted.pdf'))) };
    item('5-pdf-lib', signed && !emptySignature && encryptedLoadError !== '' && encryptedMarked && image && pageAttributes && catalogAttributes && annots >= 8, {
        signed, emptySignature, encryptedLoadError, encryptedMarked, image, pageAttributes, catalogAttributes,
        exportedPage1Annots: annots, librarySaveSupport: support,
    });
}

// 2, 3, 4, 6 in Chrome: build the probe app with the scratch folder's Vite and serve it.
const app = join(dir, 'app');
await rm(app, { recursive: true, force: true });
await cp(join(here, 'app'), app, { recursive: true });
const pub = join(app, 'public');
await cp(fixtures, join(pub, 'fixtures'), { recursive: true });
for (const path of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await cp(join(modules, 'pdfjs-dist', path), join(pub, 'pdfjs', path), { recursive: true });
await cp(join(modules, 'pdfjs-dist/build/pdf.worker.min.mjs'), join(pub, 'pdfjs/pdf.worker.min.mjs'));
execFileSync(process.execPath, [join(modules, 'vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: app, stdio: ['ignore', 'ignore', 'inherit'] });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.json': 'application/json' };
const dist = join(app, 'dist');
const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, origin).pathname);
    const file = join(dist, path === '/' ? 'index.html' : path);
    try {
        if (!file.startsWith(dist)) throw new Error('outside');
        const body = await readFile(file);
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
});
let browser;
try {
    await new Promise(done => server.listen(PORT, 'localhost', done));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const render = async query => {
        const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
        const requests = [], errors = [];
        page.on('request', request => requests.push(request.url()));
        page.on('pageerror', error => errors.push(String(error)));
        const cmaps = [];
        page.on('response', response => { if (response.url().includes('cmaps')) cmaps.push(`${response.status()} ${new URL(response.url()).pathname}`); });
        await page.goto(`${origin}/index.html?${query}`);
        await page.waitForFunction(() => window.__probe?.loaded || window.__probe?.error, null, { timeout: 30000 }).catch(() => {});
        // Painted pixels on the first page canvas, sampled until the count settles.
        let ink = 0;
        for (let i = 0, last = -1; i < 30; i++, last = ink) {
            await page.waitForTimeout(300);
            ink = await page.evaluate(() => {
                const canvas = document.querySelector('canvas');
                if (!canvas || !canvas.width) return 0;
                const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
                let count = 0;
                for (let p = 0; p < data.length; p += 4) if (data[p + 3] > 0 && data[p] + data[p + 1] + data[p + 2] < 600) count++;
                return count;
            });
            if (ink > 0 && ink === last) break;
        }
        const state = await page.evaluate(() => window.__probe);
        await page.close();
        return { state, ink, external: requests.filter(url => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')), cmaps, errors };
    };
    const korean = await render('f=b-korean-cid.pdf');
    const plain = await render('f=a-basic.pdf');
    const missingCmap = await render('f=b-korean-cid.pdf&cmap=missing');
    item('2-render', korean.state?.loaded && korean.ink > 200 && korean.external.length === 0 && korean.cmaps.some(line => line.startsWith('200 ') && line.includes('UniKS-UCS2-H')), {
        korean, plainInk: plain.ink, plainExternal: plain.external,
        // Not required: what a wrong cMap directory does, so step 4a can write the mutation check.
        missingCmap: { ink: missingCmap.ink, cmaps: missingCmap.cmaps, state: missingCmap.state, errors: missingCmap.errors },
    });
    const encrypted = await render('f=d-encrypted.pdf&pw=test');
    item('6-password', encrypted.state?.loaded && encrypted.ink > 200 && encrypted.external.length === 0, encrypted);

    const page = await browser.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`${origin}/codec.html`);
    const result = await page.evaluate(() => window.__codec);
    await page.close();
    const external = requests.filter(url => !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:'));
    item('3-codec-worker', !result.error && result.problems.length === 0 && result.comparisonCatches === 7 && external.length === 0, { ...result, external });
    item('4-incremental', true, { incrementalPrefix: result.incrementalPrefix, note: 'recorded only' });
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}

const required = ['0-fixtures', '1-metadata', '2-render', '3-codec-worker', '5-pdf-lib', '6-password'];
report.pass = required.every(key => report.items[key]?.pass);
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

