// Same-origin pdf.js assets; `?cmap=missing` points the cMap directory at a path that does not exist.
import { configurePdf } from 'svelte-pdf-mini';
import { mount } from 'svelte';
import View from './View.svelte';
const query = new URLSearchParams(location.search);
configurePdf({
    workerSrc: '/pdfjs/pdf.worker.min.mjs',
    cMapUrl: query.get('cmap') === 'missing' ? '/pdfjs/missing-cmaps/' : '/pdfjs/cmaps/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
});
window.__probe = { loaded: false };
mount(View, { target: document.getElementById('app'), props: { src: `/fixtures/${query.get('f')}`, password: query.get('pw') ?? undefined } });
