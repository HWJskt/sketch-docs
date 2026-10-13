import { build } from 'vite';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root, buildEngines, verifySources } from './build-engines.mjs';
import { sourceRevision } from './revision.mjs';

// Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PAGES_MAX_FILES = 20000;
// Every deployed file with its bytes; deploy compares this against the verified output.
export async function outputHash(dir) {
  const hash = createHash('sha256');
  const files = [];
  async function walk(relative) {
    for (const entry of (await readdir(join(dir, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(name);
      else { const bytes = await readFile(join(dir, name)); files.push({ name, size: bytes.length }); hash.update(name).update('\0').update(bytes); }
    }
  }
  await walk('');
  return { hash: hash.digest('hex'), files };
}
export function assertPagesLimits(files) {
  const large = files.filter(file => file.size > PAGES_MAX_FILE_BYTES);
  if (large.length) throw new Error('Files exceed the Cloudflare Pages 25 MiB limit: ' + large.map(file => `${file.name} (${file.size})`).join(', '));
  if (files.length > PAGES_MAX_FILES) throw new Error(`Output has ${files.length} files; Cloudflare Pages allows ${PAGES_MAX_FILES}`);
}

export async function productHash() {
  const hash = createHash('sha256');
  async function walk(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else hash.update(name).update(await readFile(join(root, name)));
    }
  }
  for (const path of ['src', 'scripts', 'overlays', 'tests']) await walk(path);
  for (const path of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'svelte.config.js', 'index.html', 'word.html', 'hwp.html', 'public/favicon.svg', 'public/sw.js', 'public/_headers', 'upstreams.lock.json']) hash.update(path).update(await readFile(join(root, path)));
  return hash.digest('hex');
}
export async function verify({ candidate = false, lockPath = join(root, 'upstreams.lock.json') } = {}) {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', candidate ? 'candidate-verified.json' : 'verified.json'), JSON.stringify({ passed: false, startedAt: new Date().toISOString() }));
  const before = await productHash();
  execFileSync(process.execPath, ['--check', join(root, 'public/sw.js')], { stdio: 'inherit' });
  const lockText = await readFile(lockPath, 'utf8');
  const cache = join(root, candidate ? '.cache/candidate-build' : '.cache/build');
  const publicDir = join(root, candidate ? '.cache/candidate-public' : 'public');
  const outDir = join(root, candidate ? 'candidate-dist' : 'dist');
  await buildEngines({ lockPath, cache, output: publicDir });
  if (candidate) {
    await mkdir(publicDir, { recursive: true });
    for (const name of ['favicon.svg', 'sw.js']) await writeFile(join(publicDir, name), await readFile(join(root, 'public', name)));
  }
  execFileSync('npm', ['run', 'check'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'check'], { cwd: join(cache, 'word'), stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', join(root, 'tests/contracts.test.mjs'), join(root, 'tests/release-info.test.mjs'), join(root, 'tests/upstream-git.test.mjs'), join(root, 'tests/service-worker.test.mjs'), join(root, 'tests/engine-manifest.test.mjs')], { cwd: root, stdio: 'inherit' });
  await build({ root, publicDir, build: { outDir, emptyOutDir: true } });
  for (const test of ['tests/integration.mjs', 'tests/regressions.mjs']) execFileSync(process.execPath, [join(root, test)], { cwd: root, stdio: 'inherit', env: { ...process.env, TEST_DIST: outDir }, timeout: 240000 });
  const output = await outputHash(outDir);
  assertPagesLimits(output.files);
  if (await productHash() !== before) throw new Error('Product files changed during validation; rerun verification');
  if (await readFile(lockPath, 'utf8') !== lockText) throw new Error('Upstream lock changed during validation');
  await verifySources(JSON.parse(lockText));
  const report = { schemaVersion: 2, passed: true, testedAt: new Date().toISOString(), productHash: before, revision: sourceRevision(root), outputHash: output.hash, outputFiles: output.files.length, upstreams: JSON.parse(await readFile(lockPath, 'utf8')), output: outDir };
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', candidate ? 'candidate-verified.json' : 'verified.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('RELEASE GATE PASSED:', outDir);
}
if (process.argv[1] === import.meta.filename) await verify();
