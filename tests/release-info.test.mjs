import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeReleaseInfo } from '../scripts/release-info.mjs';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();
const lock = {
  schemaVersion: 1,
  edentext: { url: 'https://github.com/upstream/edentext.git', mirror: 'https://github.com/backup/edentext.git', license: 'AGPL-3.0-only', commit: 'a'.repeat(40) },
  hop: { url: 'https://github.com/upstream/hop.git', mirror: 'https://github.com/backup/hop.git', license: 'MIT', commit: 'b'.repeat(40) },
  rhwp: { url: 'https://github.com/upstream/rhwp.git', mirror: 'https://github.com/backup/rhwp.git', license: 'MIT', commit: 'c'.repeat(40), version: '0.8.7' },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'release-info-test-'));
  const put = async (path, text = path) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
  await put('package.json', JSON.stringify({ version: '0.2.0', repository: { type: 'git', url: 'https://github.com/owner/product.git' } }));
  await put('LICENSE', 'AGPL text');
  for (const path of ['source/edentext', 'source/hop', 'source/hop/third_party/rhwp']) await put(`${path}/LICENSE`, path + ' license');
  await put('source/hop/third_party/rhwp/THIRD_PARTY_LICENSES.md', 'rhwp third party');
  for (const name of ['canvaskit-wasm', '@noble/hashes', 'fflate', 'svelte']) await put(`node_modules/${name}/${name === 'svelte' ? 'LICENSE.md' : 'LICENSE'}`, name);
  await put('public/engines/word/licenses.txt', 'Word third-party licenses');
  await put('public/legal/source-0123456789abcdef.tar.gz', 'old archive');
  await put('.gitignore', 'source/\nnode_modules/\npublic/\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'product');
  return { root, put, commit: git(root, 'rev-parse', 'HEAD') };
}

test('release info links the built commit and every pinned upstream instead of shipping an archive', async () => {
  const { root, commit } = await fixture();
  try {
    const release = await writeReleaseInfo({ root, lock });
    assert.deepEqual(release.source, {
      repository: 'https://github.com/owner/product', commit, dirty: false,
      url: `https://github.com/owner/product/tree/${commit}`,
      archiveUrl: `https://github.com/owner/product/archive/${commit}.tar.gz`,
    });
    assert.deepEqual(release.upstreams.map(item => [item.name, item.license, item.url, item.mirrorUrl]), [
      ['edentext', 'AGPL-3.0-only', `https://github.com/upstream/edentext/tree/${'a'.repeat(40)}`, `https://github.com/backup/edentext/tree/${'a'.repeat(40)}`],
      ['hop', 'MIT', `https://github.com/upstream/hop/tree/${'b'.repeat(40)}`, `https://github.com/backup/hop/tree/${'b'.repeat(40)}`],
      ['rhwp', 'MIT', `https://github.com/upstream/rhwp/tree/${'c'.repeat(40)}`, `https://github.com/backup/rhwp/tree/${'c'.repeat(40)}`],
    ]);
    const legal = await readdir(join(root, 'public/legal'));
    assert.deepEqual(legal.filter(name => name.endsWith('.tar.gz')), [], 'no source archive is deployed');
    assert.deepEqual(JSON.parse(await readFile(join(root, 'public/legal/release.json'), 'utf8')), release);
    const notices = await readFile(join(root, 'public/legal/notices.txt'), 'utf8');
    for (const expected of ['AGPL text', 'Word third-party licenses', 'rhwp third party', '@noble/hashes', 'canvaskit-wasm', 'source/edentext license']) assert.ok(notices.includes(expected), expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('uncommitted product changes are marked so they cannot pass as the linked commit', async () => {
  const { root, put } = await fixture();
  try {
    await put('src/unpublished.ts', 'change');
    assert.equal((await writeReleaseInfo({ root, lock })).source.dirty, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a lock entry without a backup fork or license is rejected', async () => {
  const { root } = await fixture();
  try {
    await assert.rejects(writeReleaseInfo({ root, lock: { ...lock, hop: { ...lock.hop, mirror: undefined } } }), /hop needs url, mirror/);
    await assert.rejects(writeReleaseInfo({ root, lock: { ...lock, rhwp: { ...lock.rhwp, license: undefined } } }), /rhwp needs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legal notices: the exact file set, each copied byte for byte, and notices.txt in order', async () => {
  const { root } = await fixture();
  try {
    await writeReleaseInfo({ root, lock });
    const legal = join(root, 'public/legal');
    const npm = { 'canvaskit-wasm': 'LICENSE', '@noble/hashes': 'LICENSE', fflate: 'LICENSE', svelte: 'LICENSE.md' };
    const expected = [
      ['LICENSE', 'LICENSE'], ['LICENSE-edentext', 'source/edentext/LICENSE'], ['LICENSE-hop', 'source/hop/LICENSE'],
      ['LICENSE-rhwp', 'source/hop/third_party/rhwp/LICENSE'], ['THIRD_PARTY_LICENSES-rhwp.md', 'source/hop/third_party/rhwp/THIRD_PARTY_LICENSES.md'],
      ['licenses-edentext.txt', 'public/engines/word/licenses.txt'],
      ...Object.entries(npm).map(([name, file]) => [`LICENSE-${name.replaceAll('/', '-')}`, `node_modules/${name}/${file}`]),
    ];
    assert.deepEqual((await readdir(legal)).sort(), [...expected.map(([name]) => name), 'notices.txt', 'release.json'].sort());
    for (const [name, from] of expected) assert.equal(await readFile(join(legal, name), 'utf8'), await readFile(join(root, from), 'utf8'), name);
    const notices = await readFile(join(legal, 'notices.txt'), 'utf8');
    const order = expected.map(([name]) => notices.indexOf(`===== ${name} =====`));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `section order ${order}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
