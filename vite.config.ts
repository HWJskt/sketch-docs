import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildId, sourceRevision } from './scripts/revision.mjs';
import { pdfjsVersion } from './scripts/pdf-assets.mjs';
import { relative } from 'node:path';
import type { Plugin } from 'vite';

// Vite's manifest links chunks but does not say which modules a chunk contains; tests/bundle-boundary.mjs needs that.
const chunkModules: Plugin = {name: 'chunk-modules', apply: 'build', generateBundle(_, bundle) {
    const modules = Object.fromEntries(Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => [chunk.fileName, chunk.moduleIds.map(id => relative(import.meta.dirname, id))]));
    this.emitFile({type: 'asset', fileName: '.vite/chunk-modules.json', source: JSON.stringify(modules)});
}};
export default defineConfig({
    base: './',
    plugins: [svelte(), chunkModules],
    define: {__BUILD_ID__: JSON.stringify(buildId(sourceRevision(import.meta.dirname))), __PDFJS_VERSION__: JSON.stringify(await pdfjsVersion(import.meta.dirname))},
    // pdf.js cannot be pre-bundled for the dev server; workers are ES modules (the PDF codec worker uses top-level await).
    optimizeDeps: {exclude: ['pdfjs-dist']},
    worker: {format: 'es'},
    // .vite/manifest.json lists the PDF editor chunk for engines/manifest.json (scripts/pdf-manifest.mjs).
    build: {manifest: true, rolldownOptions: {
        input: {home:'index.html', word:'word.html', hwp:'hwp.html', pdf:'pdf.html', xlsx:'xlsx.html'},
        // Rolldown's runtime helpers otherwise land in whichever chunk first needs them; once that was the
        // pdf-lib chunk, and the shell imported all of it (tests/bundle-boundary.mjs). Keep them on their own.
        output: {codeSplitting: {groups: [{name: 'rolldown-runtime', test: /rolldown\/runtime/, priority: 100}]}},
    }},
    server: {host:'localhost'},
});
