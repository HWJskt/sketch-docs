import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
    plugins: [svelte()],
    optimizeDeps: { exclude: ['pdfjs-dist'] },
    // Module workers: the codec worker uses top-level await, which the default iife format rejects.
    worker: { format: 'es' },
    build: { rolldownOptions: { input: { view: 'index.html', codec: 'codec.html' } } },
});
