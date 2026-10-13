import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfEngineFiles } from '../scripts/pdf-manifest.mjs';

const manifest = {
    'src/pdf/PdfEditor.svelte': { file: 'assets/PdfEditor-a.js', isDynamicEntry: true, imports: ['_shared-b.js'], css: ['assets/PdfEditor-c.css'], dynamicImports: ['node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url', 'node_modules/@cantoo/pdf-lib/es/index.js'] },
    '_shared-b.js': { file: 'assets/shared-b.js', imports: ['_runtime-d.js'] },
    '_runtime-d.js': { file: 'assets/runtime-d.js' },
    'node_modules/pdfjs-dist/build/pdf.mjs': { file: 'assets/pdf-e.js', imports: ['_shared-b.js'] },
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url': { file: 'assets/pdf.worker.min-f.js' },
    'node_modules/@cantoo/pdf-lib/es/index.js': { file: 'assets/pdf-lib-g.js' },
    'index.html': { file: 'assets/home-h.js', isEntry: true, imports: ['_runtime-d.js'] },
};

test('the PDF engine is the editor chunk and pdf.js with their static imports and CSS, plus our worker copy', () => {
    assert.deepEqual(pdfEngineFiles(manifest, '6.4.299'), [
        'assets/PdfEditor-a.js', 'assets/PdfEditor-c.css', 'assets/pdf-e.js', 'assets/runtime-d.js', 'assets/shared-b.js', 'pdfjs/6.4.299/pdf.worker.min.mjs',
    ]);
});

test('a missing editor chunk or a pdf.js import that disappeared fails instead of listing too little', () => {
    const { 'src/pdf/PdfEditor.svelte': _, ...withoutEditor } = manifest;
    assert.throws(() => pdfEngineFiles(withoutEditor, '6.4.299'), /PdfEditor\.svelte is not in the Vite build manifest/);
    const moved = { ...manifest, 'src/pdf/PdfEditor.svelte': { ...manifest['src/pdf/PdfEditor.svelte'], dynamicImports: [] } };
    assert.throws(() => pdfEngineFiles(moved, '6.4.299'), /no longer imports node_modules\/pdfjs-dist\/build\/pdf\.mjs/);
});
