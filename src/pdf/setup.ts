// pdf.js loads its character maps, fonts, wasm and ICC profiles from our deployment (scripts/pdf-assets.mjs
// copies them to pdfjs/<version>/); the library's default is a CDN. The worker is the library's own Vite
// `?url` import (a hashed file under assets/), so it is not set here.
import { configurePdf } from 'svelte-pdf-mini';

export function pdfAssetBase(base: string = document.baseURI): string {
    return new URL(`pdfjs/${__PDFJS_VERSION__}/`, base).href;
}
export function setupPdf(base?: string) {
    const dir = pdfAssetBase(base);
    configurePdf({ cMapUrl: `${dir}cmaps/`, standardFontDataUrl: `${dir}standard_fonts/`, wasmUrl: `${dir}wasm/`, iccUrl: `${dir}iccs/` });
}
