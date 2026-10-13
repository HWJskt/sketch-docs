import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildId, sourceRevision } from './scripts/revision.mjs';
import { pdfjsVersion } from './scripts/pdf-assets.mjs';
export default defineConfig({
    base: './',
    plugins: [svelte()],
    define: {__BUILD_ID__: JSON.stringify(buildId(sourceRevision(import.meta.dirname))), __PDFJS_VERSION__: JSON.stringify(await pdfjsVersion(import.meta.dirname))},
    // pdf.js cannot be pre-bundled for the dev server; workers are ES modules (the PDF codec worker uses top-level await).
    optimizeDeps: {exclude: ['pdfjs-dist']},
    worker: {format: 'es'},
    // .vite/manifest.json lists the PDF editor chunk for engines/manifest.json (scripts/pdf-manifest.mjs).
    build: {manifest: true, rolldownOptions: {input: {home:'index.html', word:'word.html', hwp:'hwp.html', pdf:'pdf.html'}}},
    server: {host:'localhost'},
});
