import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packageSource, productFiles } from '../scripts/package-source.mjs';
const exec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-package-test-'));
  const put = async (path, text = path) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
  for (const dir of ['src', 'scripts', 'overlays', 'tests', 'docs']) await mkdir(join(root, dir));
  for (const file of ['package-lock.json', 'LICENSE', 'README.md', 'CLAUDE.md', '.gitignore', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json', 'index.html', 'word.html', 'hwp.html', 'public/favicon.svg', 'public/sw.js']) await put(file);
  await put('package.json', JSON.stringify({ version: '0.1.2' }));
  await put('src/uncommitted.ts', '// current unpublished change');
  await put('.env', 'NEVER_PUBLISH');
  await put('backups/private.txt', 'NEVER_PUBLISH');
  for (const name of ['canvaskit-wasm', '@noble/hashes', 'fflate', 'svelte']) await put(`node_modules/${name}/${name === 'svelte' ? 'LICENSE.md' : 'LICENSE'}`, name);
  await put('public/engines/word/licenses.txt', 'Word third-party licenses');
  const lock = { schemaVersion: 1 };
  for (const [name, path] of [['edentext', 'source/edentext'], ['hop', 'source/hop'], ['rhwp', 'source/hop/third_party/rhwp']]) {
    await put(`${path}/LICENSE`, name + ' license');
    if (name === 'rhwp') {
      await put(`${path}/THIRD_PARTY_LICENSES.md`, 'rhwp third party');
      await put(`${path}/pdf/large-unused.pdf`, 'excluded fixture');
      await put(`${path}/samples/hwp3-sample16-hwp5-2024-password-123456.hwp`, 'required fixture');
      await put(`${path}/tools/rhwp-subsecond/src/lib.rs`, '// build source');
      await put(`${path}/tools/other/corpus.tsv`, 'excluded corpus');
    }
    exec('git', ['init', '-q'], join(root, path));
    exec('git', ['add', '.'], join(root, path));
    exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'source'], join(root, path));
    lock[name] = { commit: exec('git', ['rev-parse', 'HEAD'], join(root, path)), url: `https://example.invalid/${name}.git` };
  }
  exec('git', ['add', 'third_party/rhwp'], join(root, 'source/hop'));
  exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'pin rhwp'], join(root, 'source/hop'));
  lock.hop.commit = exec('git', ['rev-parse', 'HEAD'], join(root, 'source/hop'));
  await put('upstreams.lock.json', JSON.stringify(lock));
  return { root, put, lock };
}

test('published archive includes current product source, exact upstream objects and usable offline restore', async () => {
  const { root, lock } = await fixture();
  try {
    const release = await packageSource({ root, lock });
    assert.equal(release.version, '0.1.2');
    const archive = join(root, 'public', release.sourceUrl);
    assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), release.sourceSha256);
    const paths = exec('tar', ['-tzf', archive], root);
    assert.match(paths, /src\/uncommitted.ts/);
    assert.doesNotMatch(paths, /(?:\.git\/|\.env|backups\/|node_modules\/)/);
    await mkdir(join(root, 'extracted'));
    exec('tar', ['-xzf', archive, '-C', join(root, 'extracted')], root);
    const extracted = join(root, 'extracted/sketch-doc-source');
    assert.equal(await readFile(join(extracted, 'src/uncommitted.ts'), 'utf8'), '// current unpublished change');
    exec(process.execPath, ['scripts/restore-packaged-upstreams.mjs'], extracted);
    for (const [name, path] of [['edentext', 'source/edentext'], ['hop', 'source/hop'], ['rhwp', 'source/hop/third_party/rhwp']]) {
      assert.equal(exec('git', ['rev-parse', 'HEAD'], join(extracted, path)), lock[name].commit);
      assert.equal(await readFile(join(extracted, path, 'LICENSE'), 'utf8'), name + ' license');
      assert.equal(exec('git', ['status', '--porcelain'], join(extracted, path)), '');
    }
    await assert.rejects(readFile(join(extracted, 'source/hop/third_party/rhwp/pdf/large-unused.pdf')), /ENOENT/);
    assert.equal(await readFile(join(extracted, 'source/hop/third_party/rhwp/tools/rhwp-subsecond/src/lib.rs'), 'utf8'), '// build source');
    await assert.rejects(readFile(join(extracted, 'source/hop/third_party/rhwp/tools/other/corpus.tsv')), /ENOENT/);
    assert.throws(() => exec(process.execPath, ['scripts/restore-packaged-upstreams.mjs'], extracted), /Refusing to replace/);
    const notices = await readFile(join(root, 'public/legal/notices.txt'), 'utf8');
    for (const expected of ['Word third-party licenses', 'rhwp third party', '@noble/hashes', 'canvaskit-wasm']) assert.ok(notices.includes(expected));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source allowlist rejects symlinks into private files', async () => {
  const { root } = await fixture();
  try {
    await symlink('../.env', join(root, 'src/secret.ts'));
    await assert.rejects(productFiles(root), /refuses symlinks/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
