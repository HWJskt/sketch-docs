import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildId, sourceRevision } from './scripts/revision.mjs';
export default defineConfig({base: './', plugins: [svelte()], define: {__BUILD_ID__: JSON.stringify(buildId(sourceRevision(import.meta.dirname)))}, build: {rolldownOptions: {input: {home:'index.html', word:'word.html', hwp:'hwp.html'}}}, server:{host:'localhost'}});
