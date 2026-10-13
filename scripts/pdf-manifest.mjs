import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MANIFEST } from './engine-manifest.mjs';
import { pdfjsVersion } from './pdf-assets.mjs';

// The PDF editor is a chunk the shell imports when PDF is chosen, so its files are only known after the
// shell build. This adds them to engines/manifest.json in the build output (plan step 6a), from Vite's
// build manifest: the PdfEditor chunk and pdf.js (which it imports on the first document), each with
// their static imports and CSS, plus the pdf.js worker from pdfjs/<version>/ (scripts/pdf-assets.mjs).
export const PDF_ENTRY = 'src/pdf/PdfEditor.svelte';
export const PDF_REQUIRED_DYNAMIC = ['node_modules/pdfjs-dist/build/pdf.mjs'];

export function pdfEngineFiles(viteManifest, version) {
    const files = new Set();
    const visit = key => {
        const chunk = viteManifest[key];
        if (!chunk) throw new Error(`PDF engine: ${key} is not in the Vite build manifest`);
        if (files.has(chunk.file)) return;
        files.add(chunk.file);
        for (const css of chunk.css ?? []) files.add(css);
        for (const imported of chunk.imports ?? []) visit(imported);
    };
    visit(PDF_ENTRY);
    const dynamic = viteManifest[PDF_ENTRY].dynamicImports ?? [];
    for (const key of PDF_REQUIRED_DYNAMIC) {
        if (!dynamic.includes(key)) throw new Error(`PDF engine: ${PDF_ENTRY} no longer imports ${key}`);
        visit(key);
    }
    files.add(`pdfjs/${version}/pdf.worker.min.mjs`);
    return [...files].sort();
}

export async function addPdfEngine(outDir, root = resolve(import.meta.dirname, '..')) {
    const viteManifest = JSON.parse(await readFile(join(outDir, '.vite/manifest.json'), 'utf8'));
    const required = await Promise.all(pdfEngineFiles(viteManifest, await pdfjsVersion(root)).map(async path => {
        const { size } = await stat(join(outDir, path)).catch(() => { throw new Error(`PDF engine: ${path} is listed but missing from ${outDir}`); });
        return { path, bytes: size };
    }));
    const path = join(outDir, MANIFEST);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.engines.pdf = { required, warm: [], requiredBytes: required.reduce((sum, file) => sum + file.bytes, 0) };
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
    return manifest.engines.pdf;
}

/** Vite's build manifest is read by the checks above; it is not part of the deployment. */
export async function dropBuildMetadata(outDir) {
    await rm(join(outDir, '.vite'), { recursive: true, force: true });
}

if (process.argv[1] === import.meta.filename) {
    const outDir = resolve(process.argv[2] ?? 'dist');
    const pdf = await addPdfEngine(outDir);
    await dropBuildMetadata(outDir);
    console.log(`PDF engine: ${pdf.required.length} files, ${pdf.requiredBytes} bytes`);
}
