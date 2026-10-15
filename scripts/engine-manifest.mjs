import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

// Files an editor downloads before it can be used, so the shell can fetch them ahead of time
// and show real progress. `required` gates opening the editor; `warm` is fetched in the
// background only. tests/regressions.mjs checks this list against what Chrome actually requests.
export const ENGINES = {
  word: { html: 'engines/word/index.html', warmFonts: ['Liberation Sans', 'Liberation Serif'] },
  hwp: { html: 'rhwp/index.html', warmFonts: [] },
  // Trunk output (scripts/gridcraft-build.mjs): an inline module imports the glue and passes it the WASM.
  // Listed for progress only; the start page does not preload it (src/engines.ts).
  xlsx: { html: 'engines/gridcraft/index.html', warmFonts: [], trunk: true },
};
export const MANIFEST = 'engines/manifest.json';

const local = ref => !/^(?:[a-z]+:|\/\/|#)/i.test(ref);
const resolveRef = (from, ref) => posix.normalize(posix.join(posix.dirname(from), ref.split(/[?#]/)[0]));

export function entryRefs(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]).filter(local);
}
/** The glue JS and WASM a Trunk page loads: every quoted `./assets/*.js|wasm`, exactly one WASM. */
export function trunkRefs(html) {
  const refs = [...new Set([...html.matchAll(/["'](\.\/assets\/[\w.-]+\.(?:js|wasm))["']/g)].map(match => match[1]))];
  const wasm = refs.filter(ref => ref.endsWith('.wasm')).length;
  if (wasm !== 1 || refs.length === wasm) throw new Error(`Engine manifest: a Trunk page must load one WASM and its glue JS (found ${refs.join(', ') || 'nothing'})`);
  return refs;
}
// Vite emits `new URL("name-hash.wasm", import.meta.url)` for WASM the entry loads itself.
export function wasmRefs(js) {
  return [...new Set([...js.matchAll(/["'`]([\w.-]+-[\w-]{8}\.wasm)["'`]/g)].map(match => match[1]))];
}
export function cssRefs(css, warmFonts) {
  const refs = new Set();
  for (const face of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family:\s*["']?([^;"']+)/.exec(face[1])?.[1].trim();
    if (!warmFonts.includes(family)) continue;
    for (const url of face[1].matchAll(/url\(["']?([^)"']+)["']?\)/g)) if (local(url[1])) refs.add(url[1]);
  }
  const outside = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  for (const url of outside.matchAll(/url\(["']?([^)"']+\.(?:svg|png|webp))["']?\)/g)) if (local(url[1])) refs.add(url[1]);
  return [...refs];
}

async function entry(dir, path) {
  const { size } = await stat(join(dir, path)).catch(() => { throw new Error(`Engine manifest: ${path} is referenced but missing`); });
  return { path, bytes: size };
}

export async function engineManifest(dir) {
  const engines = {};
  for (const [name, { html, warmFonts, trunk }] of Object.entries(ENGINES)) {
    const required = new Set(), warm = new Set();
    const page = await readFile(join(dir, html), 'utf8');
    if (trunk) {
      for (const ref of trunkRefs(page)) required.add(resolveRef(html, ref));
      const list = async set => Promise.all([...set].sort().map(path => entry(dir, path)));
      const files = { required: await list(required), warm: [] };
      engines[name] = { ...files, requiredBytes: files.required.reduce((sum, file) => sum + file.bytes, 0) };
      continue;
    }
    for (const ref of entryRefs(page)) {
      const path = resolveRef(html, ref);
      required.add(path);
      const text = await readFile(join(dir, path), 'utf8');
      if (path.endsWith('.js')) for (const wasm of wasmRefs(text)) required.add(posix.join(posix.dirname(path), wasm));
      else for (const url of cssRefs(text, warmFonts)) warm.add(resolveRef(path, url));
    }
    for (const path of required) warm.delete(path);
    const list = async set => Promise.all([...set].sort().map(path => entry(dir, path)));
    const files = { required: await list(required), warm: await list(warm) };
    engines[name] = { ...files, requiredBytes: files.required.reduce((sum, file) => sum + file.bytes, 0) };
  }
  return { schemaVersion: 1, engines };
}

export async function writeEngineManifest(dir) {
  const manifest = await engineManifest(dir);
  await writeFile(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await writeEngineManifest(process.argv[2] ?? join(dirname(import.meta.dirname), 'public')), null, 2));
