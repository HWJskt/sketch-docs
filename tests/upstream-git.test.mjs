import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertUpstreamsClean, checkoutUpstream, restoreUpstreams, upstreamHeads, upstreamPaths } from '../scripts/upstream-git.mjs';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'protocol.file.allow=always', '-C', dir, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = async (path, text) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };
const commit = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', message); return git(dir, 'rev-parse', 'HEAD'); };

// remotes/{edentext,hop,rhwp} and a product root whose source/ holds clones of them.
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'upstream-git-test-'));
  const remotes = join(base, 'remotes');
  const rev = {};
  for (const name of ['edentext', 'rhwp']) {
    const dir = join(remotes, name);
    await mkdir(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    await put(join(dir, '.gitignore'), 'local/\n');
    await put(join(dir, 'file.txt'), name + ' v1');
    rev[name + '1'] = commit(dir, 'v1');
    await put(join(dir, 'local/notes.txt'), 'tracked upstream in v2');
    git(dir, 'add', '-f', 'local/notes.txt');
    await put(join(dir, 'file.txt'), name + ' v2');
    rev[name + '2'] = commit(dir, 'v2');
  }
  const hop = join(remotes, 'hop');
  await mkdir(hop, { recursive: true });
  git(hop, 'init', '-q', '-b', 'main');
  git(hop, 'submodule', 'add', '-q', join(remotes, 'rhwp'), 'third_party/rhwp');
  git(join(hop, 'third_party/rhwp'), 'checkout', '-q', rev.rhwp1);
  rev.hop1 = commit(hop, 'hop v1 pins rhwp v1');
  git(join(hop, 'third_party/rhwp'), 'checkout', '-q', rev.rhwp2);
  rev.hop2 = commit(hop, 'hop v2 pins rhwp v2');
  const root = join(base, 'product');
  await mkdir(join(root, 'source'), { recursive: true });
  git(join(root, 'source'), 'clone', '-q', join(remotes, 'edentext'), 'edentext');
  git(join(root, 'source'), 'clone', '-q', '--recurse-submodules', hop, 'hop');
  const paths = upstreamPaths(root);
  checkoutUpstream(paths, 'edentext', rev.edentext1);
  checkoutUpstream(paths, 'hop', rev.hop1);
  return { base, paths, rev };
}

test('candidate checkout refuses to overwrite ignored user files in a clone', async () => {
  const { base, paths, rev } = await fixture();
  try {
    await put(join(paths.edentext, 'local/notes.txt'), 'USER DATA');
    assert.doesNotThrow(() => assertUpstreamsClean(paths), 'ignored files do not count as local changes');
    assert.throws(() => checkoutUpstream(paths, 'edentext', rev.edentext2));
    assert.equal(await readFile(join(paths.edentext, 'local/notes.txt'), 'utf8'), 'USER DATA');
    assert.equal(upstreamHeads(paths).edentext, rev.edentext1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('moving HOP never overwrites ignored user files in the rhwp submodule', async () => {
  const { base, paths, rev } = await fixture();
  try {
    await put(join(paths.rhwp, 'local/notes.txt'), 'USER DATA');
    assert.throws(() => checkoutUpstream(paths, 'hop', rev.hop2));
    assert.equal(await readFile(join(paths.rhwp, 'local/notes.txt'), 'utf8'), 'USER DATA');
    assert.equal(upstreamHeads(paths).rhwp, rev.rhwp1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('moving HOP moves rhwp to its recorded gitlink', async () => {
  const { base, paths, rev } = await fixture();
  try {
    checkoutUpstream(paths, 'hop', rev.hop2);
    assert.deepEqual(upstreamHeads(paths), { edentext: rev.edentext1, hop: rev.hop2, rhwp: rev.rhwp2 });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('restore returns every clone, including an rhwp checkout that differs from the gitlink', async () => {
  const { base, paths, rev } = await fixture();
  try {
    git(paths.rhwp, 'checkout', '-q', '--detach', rev.rhwp2);
    const before = upstreamHeads(paths);
    assert.deepEqual(before, { edentext: rev.edentext1, hop: rev.hop1, rhwp: rev.rhwp2 });
    assert.doesNotThrow(() => assertUpstreamsClean(paths), 'a clean submodule on another commit is allowed');
    checkoutUpstream(paths, 'edentext', rev.edentext2);
    checkoutUpstream(paths, 'hop', rev.hop2);
    git(paths.rhwp, 'checkout', '-q', '--detach', rev.rhwp1);
    restoreUpstreams(paths, before);
    assert.deepEqual(upstreamHeads(paths), before);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('restore attempts every clone and reports all failures', async () => {
  const { base, paths, rev } = await fixture();
  try {
    const before = upstreamHeads(paths);
    checkoutUpstream(paths, 'edentext', rev.edentext2);
    await put(join(paths.edentext, 'file.txt'), 'uncommitted edit');
    assert.throws(() => restoreUpstreams(paths, { ...before, hop: 'f'.repeat(40) }), error => /edentext/.test(error.message) && /hop/.test(error.message));
    assert.equal(await readFile(join(paths.edentext, 'file.txt'), 'utf8'), 'uncommitted edit');
    assert.equal(upstreamHeads(paths).rhwp, before.rhwp);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('tracked changes in any clone stop the run before anything moves', async () => {
  const { base, paths } = await fixture();
  try {
    await put(join(paths.rhwp, 'file.txt'), 'edited');
    assert.throws(() => assertUpstreamsClean(paths), /rhwp has local changes/);
    git(paths.rhwp, 'checkout', '--', 'file.txt');
    await put(join(paths.hop, 'new.txt'), 'untracked');
    assert.throws(() => assertUpstreamsClean(paths), /hop has local changes/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a pinned commit missing from origin is fetched from the backup fork', async () => {
  const { base, paths, rev } = await fixture();
  try {
    const mirror = join(base, 'mirror-edentext');
    git(base, 'clone', '-q', '--bare', join(base, 'remotes/edentext'), mirror);
    const work = join(base, 'mirror-work');
    git(base, 'clone', '-q', mirror, work);
    await put(join(work, 'file.txt'), 'only in fork');
    const forkOnly = commit(work, 'fork only');
    git(work, 'push', '-q', 'origin', 'HEAD:refs/tags/pinned');
    assert.throws(() => checkoutUpstream(paths, 'edentext', forkOnly), 'origin alone cannot provide it');
    checkoutUpstream({ ...paths, mirrors: { edentext: mirror } }, 'edentext', forkOnly);
    assert.equal(upstreamHeads(paths).edentext, forkOnly);
    assert.equal(await readFile(join(paths.edentext, 'file.txt'), 'utf8'), 'only in fork');
  } finally { await rm(base, { recursive: true, force: true }); }
});
