import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyPdfAssets } from '../scripts/pdf-assets.mjs';

async function fixture(version) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-assets-test-'));
  const put = async (path, text = path) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
  await put('node_modules/pdfjs-dist/package.json', JSON.stringify({ version }));
  await put('node_modules/pdfjs-dist/LICENSE', 'Apache');
  await put('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'worker');
  await put('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'unminified worker');
  for (const file of ['cmaps/UniKS-UCS2-H.bcmap', 'standard_fonts/FoxitSerif.pfb', 'wasm/openjpeg.wasm', 'iccs/CGATS001Compat-v2-micro.icc', 'legacy/build/pdf.mjs']) await put(`node_modules/pdfjs-dist/${file}`);
  return { root, put };
}

test('pdf.js assets are copied under their version, without the legacy build or source maps', async () => {
  const { root } = await fixture('6.4.299');
  try {
    const target = await copyPdfAssets({ root, output: join(root, 'public') });
    assert.equal(target, join(root, 'public/pdfjs/6.4.299'));
    assert.deepEqual((await readdir(target)).sort(), ['LICENSE', 'cmaps', 'iccs', 'pdf.worker.min.mjs', 'standard_fonts', 'wasm']);
    assert.equal(await readFile(join(target, 'cmaps/UniKS-UCS2-H.bcmap'), 'utf8'), 'node_modules/pdfjs-dist/cmaps/UniKS-UCS2-H.bcmap');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a previous pdf.js version is removed so stale assets are not deployed', async () => {
  const { root, put } = await fixture('6.4.299');
  try {
    await put('public/pdfjs/6.3.0/pdf.worker.min.mjs', 'old');
    await copyPdfAssets({ root, output: join(root, 'public') });
    assert.deepEqual(await readdir(join(root, 'public/pdfjs')), ['6.4.299']);
    await assert.rejects(stat(join(root, 'public/pdfjs/6.3.0')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
