import { customizeWord } from '../overlays/edentext/product-ui.mjs';
import { packageSource } from './package-source.mjs';
import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const root = resolve(import.meta.dirname, '..');
export const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 300 * 1024 * 1024 }).trim();
export function exact(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Upstream contract changed: ${before.slice(0, 100)}`);
  return text.replace(before, after);
}
export async function verifySources(lock) {
  for (const name of ['edentext', 'hop']) {
    const dir = join(root, 'source', name);
    if (git(dir, 'rev-parse', 'HEAD') !== lock[name].commit) throw new Error(`${name}: checkout differs from lock; use upstream:sync or upstream:check`);
    if (git(dir, 'status', '--porcelain')) throw new Error(`${name}: source has local changes; preserve them before updating`);
  }
  const rhwp = join(root, 'source/hop/third_party/rhwp');
  if (git(rhwp, 'rev-parse', 'HEAD') !== lock.rhwp.commit || git(rhwp, 'status', '--porcelain')) throw new Error('rhwp checkout differs from lock or has local changes');
  execFileSync(process.execPath, [join(root, 'source/hop/scripts/verify-rhwp-upstream.mjs')], { cwd: join(root, 'source/hop'), stdio: 'inherit' });
}
async function freshWorkspace(dir) {
  await mkdir(dir, { recursive: true });
  const marker = join(dir, '.product-build');
  const entries = await readdir(dir);
  if (entries.length && !entries.includes('.product-build')) throw new Error(`Refusing to clear an unowned workspace: ${dir}`);
  for (const name of entries) if (!['node_modules', '.product-build', '.dependency-lock'].includes(name)) await rm(join(dir, name), { recursive: true, force: true });
  await writeFile(marker, 'Generated build workspace; never edit here.\n');
}
async function snapshot(source, revision, dir) {
  await freshWorkspace(dir);
  const archive = execFileSync('git', ['-C', source, 'archive', revision], { maxBuffer: 300 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive });
  execFileSync('git', ['init', '-q', dir]);
}
export async function buildEngines({ lockPath = join(root, 'upstreams.lock.json'), output = join(root, 'public'), cache = join(root, '.cache/build') } = {}) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  await verifySources(lock);
  const word = join(cache, 'word');
  await snapshot(join(root, 'source/edentext'), lock.edentext.commit, word);
  const patch = join(root, 'overlays/edentext/product.patch');
  execFileSync('git', ['apply', '--check', patch], { cwd: word, stdio: 'inherit' });
  execFileSync('git', ['apply', patch], { cwd: word, stdio: 'inherit' });
  await cp(join(root, 'overlays/edentext/ko.ts'), join(word, 'src/lib/i18n/locales/ko.ts'));
  const product = join(word, 'src/product');
  await mkdir(product, { recursive: true });
  for (const name of ['HangulEditor.svelte', 'HangulFileMenu.svelte', 'hangulFiles.ts', 'editorState.ts', 'hangulShortcuts.ts']) await cp(join(root, 'src', name), join(product, name));
  await writeFile(join(word, 'src/lib/components/HangulWorkbench.svelte'), `<script lang="ts">\nimport HangulEditor from '../../product/HangulEditor.svelte';\nlet props = $props();\n</script>\n<HangulEditor {...props} startNew={true} engineUrl="../../rhwp/index.html?chrome=embed" homeUrl="../../" />\n`);
  const wordApp = join(word, 'src/App.svelte');
  let app = await readFile(wordApp, 'utf8');
  app = exact(app, '<script lang="ts">', '<script lang="ts">\nimport type {} from "./product/editorState";');
  app = exact(app, '</script>', (await readFile(join(root, 'overlays/edentext/shell-bridge.txt'), 'utf8')) + '\n</script>');
  app = exact(app, 'function openHangul() { nativeHangulFile = undefined; nativeHangulOpen = true; }', `function openHangul() {
    if (window.parent !== window && window.parent.sketchShell) {
      void window.parent.sketchShell.openHangul().catch(error => alert(String(error))); return;
    }
    nativeHangulFile = undefined; nativeHangulOpen = true;
  }`);
  app = exact(app, '      nativeHangulFile = { bytes, name: sourceName, handle };', `      if (window.parent !== window && window.parent.sketchShell) {
        try { await window.parent.sketchShell.openHangul({ bytes, name: sourceName, handle }); }
        catch (error) { alert(String(error)); }
        return;
      }
      nativeHangulFile = { bytes, name: sourceName, handle };`);
  for (const [name, args, call] of [
    ['handleSave', '', ''], ['handleSaveAs', 'kind: DocumentFormat', 'kind'],
    ['handleOpen', '', ''], ['handleOpenRecent', 'entry: RecentFile', 'entry'],
  ]) {
    app = exact(app, `async function ${name}(${args}) {`, `async function ${name}(${args}): Promise<void> {
      productTasks++;
      try { return await ${name}ProductOperation(${call}); }
      finally { productTasks--; }
    }
    async function ${name}ProductOperation(${args}) {`);
  }
  await writeFile(wordApp, app);
  await customizeWord(word, exact);
  const conversion = join(word, 'src/lib/export/hangul.ts');
  await writeFile(conversion, exact(await readFile(conversion, 'utf8'), "'./rhwp/index.html?chrome=embed'", "'../../rhwp/index.html?chrome=embed'"));
  let html = await readFile(join(word, 'index.html'), 'utf8');
  const intro = /      <!-- Static copy[\s\S]*?\n      <\/div>/;
  if (!intro.test(html)) throw new Error('EdenText introductory markup contract changed');
  html = html.replace(intro, '');
  html = html.replace(/    <!-- Anonymous visit counting\.[\s\S]*?<\/script>/, '');
  await writeFile(join(word, 'index.html'), html);
  const wordMain = join(word, 'src/main.ts');
  await writeFile(wordMain, exact(await readFile(wordMain, 'utf8'), "if (import.meta.env.PROD && 'serviceWorker' in navigator)", "if (false && 'serviceWorker' in navigator)"));
  const dependencyLock = createHash('sha256').update(await readFile(join(word, 'package-lock.json'))).digest('hex');
  const installed = await readFile(join(word, '.dependency-lock'), 'utf8').catch(() => '');
  if (installed !== dependencyLock) {
    execFileSync('npm', ['ci', '--ignore-scripts'], { cwd: word, stdio: 'inherit' });
    await writeFile(join(word, '.dependency-lock'), dependencyLock);
  }
  execFileSync(process.execPath, [join(word, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(output, 'engines/word'), '--emptyOutDir'], { cwd: word, stdio: 'inherit' });
  await cp(join(word, 'LICENSE'), join(output, 'engines/word/LICENSE-edentext'));

  const hop = join(root, 'source/hop');
  const rhwp = join(hop, 'third_party/rhwp');
  const studio = join(cache, 'rhwp');
  await freshWorkspace(studio);
  for (const name of ['src', 'public', 'index.html']) await cp(join(rhwp, 'rhwp-studio', name), join(studio, name), { recursive: true, dereference: true });
  const mainPath = join(studio, 'src/main.ts');
  let main = await readFile(mainPath, 'utf8');
  main = exact(main, 'isRecoveryBlocked: () => wasm.requiresPasswordForSave,', 'isRecoveryBlocked: () => true,');
  main = exact(main, 'await openPasswordProtectedDocument(data, fileName);', "throw new Error('암호 문서는 현재 지원하지 않습니다.');");
  main = exact(main, "console.error('[initDoc] 오류:', error);", 'throw error;');
  main += '\n' + await readFile(join(root, 'overlays/rhwp/host-bridge.txt'), 'utf8');
  await writeFile(mainPath, main);
  const studioHtml = await readFile(join(studio, 'index.html'), 'utf8');
  if (!studioHtml.includes('data-menu="file"') || !studioHtml.includes('data-menu="edit"')) throw new Error('rhwp file menu selector changed');
  await writeFile(join(studio, 'index.html'), exact(studioHtml, '</head>', `<style>.menu-item[data-menu="file"]{display:none!important}\n${await readFile(join(root, 'overlays/rhwp/file-menu.css'), 'utf8')}</style></head>`));
  const vendor = join(hop, 'apps/studio-host/vendor/rhwp-core');
  await build({ configFile: false, root: studio, base: './', define: { __APP_VERSION__: JSON.stringify(lock.rhwp.version), __RHWP_DISABLE_EXTERNAL_WEBFONTS__: 'true', __RHWP_HWPCTRL__: 'false' }, resolve: { alias: { '@': join(studio, 'src'), '@wasm/rhwp.js': join(vendor, 'rhwp.js'), 'canvaskit-wasm': join(root, 'node_modules/canvaskit-wasm'), '@noble/hashes': join(root, 'node_modules/@noble/hashes') } }, build: { outDir: join(output, 'rhwp'), emptyOutDir: true, target: 'baseline-widely-available' } });
  await cp(join(rhwp, 'LICENSE'), join(output, 'rhwp/LICENSE-rhwp'));
  await cp(join(hop, 'LICENSE'), join(output, 'rhwp/LICENSE-hop'));
  await writeFile(join(output, 'provenance.json'), JSON.stringify({ ...lock, wasmSha256: createHash('sha256').update(await readFile(join(vendor, 'rhwp_bg.wasm'))).digest('hex') }, null, 2));
  await verifySources(lock);
  await packageSource({ root, output, lock });
}
if (process.argv[1] === import.meta.filename) await buildEngines();
