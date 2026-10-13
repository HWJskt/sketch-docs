// DoD 8 of docs/plans/2026-10-13-pdf-viewer.md: the start page, Word, Hangul and the shell never load
// PDF library code; it arrives only with the PdfEditor chunk. Reads the build's .vite/ metadata, so
// npm run verify runs it right after the shell build. Usage: node tests/bundle-boundary.mjs <outDir>
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDF_ENTRY } from '../scripts/pdf-manifest.mjs';

export const PDF_PACKAGES = /(?:^|\/)node_modules\/(?:svelte-pdf-mini|pdfjs-dist|@cantoo\/pdf-lib)\//;
export const ENTRIES = ['index.html', 'word.html', 'hwp.html', 'pdf.html'];

/** Chunks the entries reach through static and dynamic imports without passing through the PDF editor. */
export function shellChunks(manifest) {
    const files = new Set();
    const visit = key => {
        if (key === PDF_ENTRY) return;
        const chunk = manifest[key];
        assert.ok(chunk, `${key} is not in the Vite build manifest`);
        if (files.has(chunk.file)) return;
        files.add(chunk.file);
        for (const next of [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]) visit(next);
    };
    for (const entry of ENTRIES) visit(entry);
    return files;
}

export async function checkBoundary(outDir) {
    const read = async name => JSON.parse(await readFile(join(outDir, '.vite', name), 'utf8'));
    const [manifest, modules] = await Promise.all([read('manifest.json'), read('chunk-modules.json')]);
    const chunks = [...shellChunks(manifest)].filter(file => file.endsWith('.js'));
    const leaks = chunks.flatMap(file => {
        assert.ok(modules[file], `${file} has no module list`);
        return modules[file].filter(id => PDF_PACKAGES.test(id)).map(id => `${file}: ${id}`);
    });
    assert.deepEqual(leaks, [], 'PDF library code reachable without opening the PDF editor');
    assert.ok(modules[manifest[PDF_ENTRY].file].some(id => /svelte-pdf-mini/.test(id)), 'the PDF editor chunk itself contains svelte-pdf-mini (the check sees module ids)');
    return chunks.length;
}

if (process.argv[1] === import.meta.filename) {
    const outDir = resolve(process.argv[2] ?? 'dist');
    console.log(`PASS bundle boundary: ${await checkBoundary(outDir)} shell chunks without PDF library code (${outDir})`);
}
