import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// pdf.js files the PDF editor loads at run time, served from our deployment instead of a CDN.
// The version is part of the path so the files can be cached as immutable (public/_headers).
export const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
export const PDFJS_WORKER = 'build/pdf.worker.min.mjs';

export async function pdfjsVersion(root) {
  return JSON.parse(await readFile(join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8')).version;
}

/** Copies the worker and asset folders to `<output>/pdfjs/<version>/`, removing other versions. Returns that path. */
export async function copyPdfAssets({ root, output }) {
  const source = join(root, 'node_modules/pdfjs-dist');
  const version = await pdfjsVersion(root);
  const base = join(output, 'pdfjs');
  await rm(base, { recursive: true, force: true });
  const target = join(base, version);
  await mkdir(target, { recursive: true });
  await cp(join(source, PDFJS_WORKER), join(target, 'pdf.worker.min.mjs'));
  for (const dir of PDFJS_DIRS) await cp(join(source, dir), join(target, dir), { recursive: true });
  await cp(join(source, 'LICENSE'), join(target, 'LICENSE'));
  return target;
}
