import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cargoNotices, shippedPackages } from './cargo-licenses.mjs';

// GridCraft's web app (Rust → WASM through Trunk), built from a snapshot of the pinned clone with
// our overlays, and only with the exact tools the lock names (Trunk never downloads its own).
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const OUTPUT = 'engines/gridcraft';

/** Each tool's `--version` line must name the pinned version; another version is a different build. */
export function toolVersionErrors(pins, lines) {
  const expect = { rust: /^rustc (\S+)/, trunk: /^trunk (\S+)/, 'wasm-bindgen': /^wasm-bindgen (\S+)/, 'wasm-opt': /^wasm-opt version (\S+)/ };
  return Object.entries(expect).flatMap(([tool, pattern]) => {
    const found = pattern.exec(lines[tool] ?? '')?.[1];
    return found === pins[tool] ? [] : [`${tool}: need ${pins[tool]}, found ${found ?? `"${lines[tool] ?? ''}"`}`];
  });
}
function toolVersions(env) {
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return ''; } };
  return { rust: run('rustc', ['--version']), trunk: run('trunk', ['--version']), 'wasm-bindgen': run('wasm-bindgen', ['--version']), 'wasm-opt': run('wasm-opt', ['--version']) };
}

/**
 * Trunk writes hashed files next to index.html. They move into assets/ (cached as immutable by
 * public/_headers) and every `./name` reference in the HTML follows; a file the HTML never names,
 * or a name that appears without `./`, stops the build instead of shipping a broken page.
 */
export function relocateAssets(html, names) {
  for (const name of names) {
    const total = html.split(name).length - 1, relative = html.split(`./${name}`).length - 1;
    if (!relative) throw new Error(`GridCraft output: index.html does not reference ${name}`);
    if (total !== relative) throw new Error(`GridCraft output: ${name} is referenced without ./`);
    html = html.replaceAll(`./${name}`, `./assets/${name}`);
  }
  return html;
}

export async function buildGridcraft({ root, lock, cache, output, snapshot }) {
  const pin = lock.gridcraft;
  if (!pin.tools || !pin.fonts?.length) throw new Error('upstreams.lock.json gridcraft needs tools and fonts');
  const env = { ...process.env, RUSTUP_TOOLCHAIN: pin.tools.rust, CARGO_BUILD_JOBS: '5', CARGO_TARGET_DIR: join(cache, 'gridcraft-target') };
  const versions = toolVersions(env);
  const toolErrors = toolVersionErrors(pin.tools, versions);
  if (toolErrors.length) throw new Error('GridCraft build tools differ from upstreams.lock.json:\n  ' + toolErrors.join('\n  '));
  const overlay = join(root, 'overlays/gridcraft');
  const patches = (await readdir(overlay)).filter(name => name.endsWith('.patch')).sort();
  const fonts = [];
  for (const font of pin.fonts) {
    const bytes = await readFile(join(root, font.file));
    if (sha256(bytes) !== font.sha256) throw new Error(`${font.file}: sha256 differs from upstreams.lock.json`);
    fonts.push({ ...font, bytes });
  }
  const source = join(root, 'source/gridcraft');
  const cargoLock = await readFile(join(source, 'Cargo.lock'));
  // Same inputs → same output: the previous build is reused instead of recompiling for minutes.
  const inputs = {
    gridcraft: pin.commit, craftLibs: lock['craft-libs'].commit, tools: versions, cargoLock: sha256(cargoLock),
    patches: Object.fromEntries(await Promise.all(patches.map(async name => [name, sha256(await readFile(join(overlay, name)))]))),
    fonts: Object.fromEntries(fonts.map(font => [font.file, font.sha256])),
    script: sha256(await readFile(import.meta.filename)),
  };
  const inputHash = sha256(JSON.stringify(inputs));
  const built = join(cache, 'gridcraft-dist');
  const stamp = join(built, '.input-hash');
  if (await readFile(stamp, 'utf8').catch(() => '') !== inputHash) {
    const work = join(cache, 'gridcraft');
    await snapshot(source, pin.commit, work);
    for (const name of patches) {
      execFileSync('git', ['apply', '--check', join(overlay, name)], { cwd: work, stdio: 'inherit' });
      execFileSync('git', ['apply', join(overlay, name)], { cwd: work, stdio: 'inherit' });
    }
    // The Korean fallback face crates/ui-egui/src/theme.rs embeds (korean-font.patch).
    await mkdir(join(work, 'crates/ui-egui/assets'), { recursive: true });
    await writeFile(join(work, 'crates/ui-egui/assets/ko-fallback.ttf'), fonts[0].bytes);
    // git archive dates files at the commit; a file a dropped patch no longer changes would then look
    // older than the cached build in CARGO_TARGET_DIR, and Cargo would keep the patched object.
    execFileSync('find', [work, '-type', 'f', '-exec', 'touch', '{}', '+']);
    await rm(built, { recursive: true, force: true });
    execFileSync('trunk', ['build', '--release', '--offline', '--locked', '--dist', built], { cwd: join(work, 'apps/gridcraft-web'), env, stdio: 'inherit' });
    const names = (await readdir(built)).filter(name => name !== 'index.html');
    const html = relocateAssets(await readFile(join(built, 'index.html'), 'utf8'), names);
    await mkdir(join(built, 'assets'));
    for (const name of names) await rename(join(built, name), join(built, 'assets', name));
    await writeFile(join(built, 'index.html'), html);
    const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown'], { cwd: work, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const craftLibs = lock['craft-libs'].url.replace(/\.git$/, '');
    const notices = await cargoNotices(shippedPackages(metadata, 'gridcraft-web'), {
      covered: pkg => pkg.source === null ? 'GridCraft' : pkg.source?.startsWith(`git+${craftLibs}?`) ? 'craft-libs' : undefined,
    });
    await writeFile(join(built, 'licenses.txt'), 'GridCraft web engine: the Rust crates compiled into its WASM (wasm32-unknown-unknown, normal dependencies).\n\n' + notices);
    await writeFile(stamp, inputHash);
  }
  const target = join(output, OUTPUT);
  await rm(target, { recursive: true, force: true });
  await cp(built, target, { recursive: true, filter: path => !path.endsWith('.input-hash') });
  const wasm = (await readdir(join(target, 'assets'))).filter(name => name.endsWith('.wasm'));
  if (wasm.length !== 1) throw new Error(`GridCraft output: expected one .wasm, found ${wasm.length}`);
  // brand.patch removes the ArtCraft marks a modified version may not carry (docs/brand/LICENSE-brand.txt).
  const wasmText = (await readFile(join(target, 'assets', wasm[0]))).toString('latin1');
  for (const mark of ['getartcraft.com', 'discord.gg/artcraft', 'Part of ArtCraft']) if (wasmText.includes(mark)) throw new Error(`GridCraft output still carries the ArtCraft mark "${mark}"`);
  await writeFile(join(target, 'provenance.json'), JSON.stringify({ ...inputs, wasm: wasm[0], wasmSha256: sha256(await readFile(join(target, 'assets', wasm[0]))) }, null, 2) + '\n');
  if (!existsSync(join(target, 'index.html'))) throw new Error('GridCraft output has no index.html');
}
