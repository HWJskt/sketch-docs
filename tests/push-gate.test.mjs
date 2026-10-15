// scripts/push-gate.mjs: the decision, and the real hook on `git push` to a local bare remote with
// verify and the browser tests replaced by stubs (the real ones take minutes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { commitsToCheck, reportCovers } from '../scripts/push-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const a = 'a'.repeat(40), b = 'b'.repeat(40), zero = '0'.repeat(40);

test('a push checks each commit it sends once, and a deletion checks nothing', () => {
  const stdin = [`refs/heads/main ${a} refs/heads/main ${b}`, `refs/heads/x ${a} refs/heads/x ${zero}`, `(delete) ${zero} refs/heads/old ${b}`, ''].join('\n');
  assert.deepEqual(commitsToCheck(stdin), [{ sha: a, localRef: 'refs/heads/main', remoteRef: 'refs/heads/main' }]);
  assert.deepEqual(commitsToCheck(`(delete) ${zero} refs/heads/old ${b}\n`), []);
});

test('the saved report covers only the same commit, made clean, with the same product files', () => {
  const report = { passed: true, productHash: 'p', revision: { commit: a, dirty: false } };
  const here = { sha: a, head: a, clean: true, productHash: 'p' };
  assert.deepEqual(reportCovers(report, here), { ok: true });
  assert.match(reportCovers(null, here).why, /no passing/);
  assert.match(reportCovers({ ...report, passed: false }, here).why, /no passing/);
  assert.match(reportCovers(report, { ...here, sha: b }).why, /report is for aaaaaaaaaaaa/);
  assert.match(reportCovers({ ...report, revision: { commit: a, dirty: true } }, here).why, /uncommitted/);
  assert.match(reportCovers(report, { ...here, head: b }).why, /not the clean checkout/);
  assert.match(reportCovers(report, { ...here, clean: false }).why, /not the clean checkout/);
  assert.match(reportCovers(report, { ...here, productHash: 'q' }).why, /changed after/);
});

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A product repository with the real hook and gate, a stub verify (exit code from STUB_VERIFY) and stub
// browser tests that record the TEST_LOCALE they ran with.
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'push-gate-test-'));
  const repo = join(base, 'repo'), remote = join(base, 'remote.git');
  await mkdir(join(repo, 'scripts'), { recursive: true });
  await mkdir(join(repo, 'tests'), { recursive: true });
  await mkdir(join(repo, '.githooks'), { recursive: true });
  await copyFile(join(root, '.githooks/pre-push'), join(repo, '.githooks/pre-push'));
  await chmod(join(repo, '.githooks/pre-push'), 0o755);
  await copyFile(join(root, 'scripts/push-gate.mjs'), join(repo, 'scripts/push-gate.mjs'));
  const log = join(base, 'log.txt');
  await writeFile(join(repo, 'scripts/verify.mjs'), `import { appendFileSync } from 'node:fs';
export async function productHash() { return 'stub-product'; }
if (process.argv[1] === import.meta.filename) { appendFileSync(${JSON.stringify(log)}, 'verify\\n'); process.exit(Number(process.env.STUB_VERIFY ?? 0)); }
`);
  for (const name of ['integration', 'regressions', 'pdf.integration', 'xlsx.integration']) {
    await writeFile(join(repo, `tests/${name}.mjs`), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, '${name} ' + process.env.TEST_LOCALE + '\\n');\n`);
  }
  await writeFile(join(repo, 'package-lock.json'), '{}\n');
  await writeFile(join(repo, '.gitignore'), 'artifacts/\nsource/\n.cache/\nnode_modules/\n');
  git(base, 'init', '-q', '--bare', remote);
  git(base, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'core.hooksPath', '.githooks');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'product');
  return { base, repo, remote, log };
}
const push = (repo, extraEnv = {}, ...args) => spawnSync('git', ['-C', repo, 'push', '-q', 'origin', ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } });
const logged = async log => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);

test('the hook lets a commit with a matching report through without verifying it again', async () => {
  const { base, repo, remote, log } = await fixture();
  try {
    const sha = git(repo, 'rev-parse', 'HEAD');
    await mkdir(join(repo, 'artifacts'));
    await writeFile(join(repo, 'artifacts/verified.json'), JSON.stringify({ passed: true, productHash: 'stub-product', revision: { commit: sha, dirty: false } }));
    const result = push(repo, {}, 'main');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(remote, 'rev-parse', 'main'), sha);
    assert.deepEqual(await logged(log), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('without a report the hook verifies the commit in a temporary worktree, then runs the browser tests as en-US', async () => {
  const { base, repo, remote, log } = await fixture();
  try {
    const result = push(repo, { STUB_VERIFY: '0' }, 'main');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(remote, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'));
    assert.deepEqual(await logged(log), ['verify', 'integration en-US', 'regressions en-US', 'pdf.integration en-US', 'xlsx.integration en-US']);
    assert.equal(git(repo, 'worktree', 'list').split('\n').length, 1, 'the temporary worktree is removed');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a failing verify refuses the push and leaves the remote and worktrees as they were', async () => {
  const { base, repo, remote, log } = await fixture();
  try {
    const result = push(repo, { STUB_VERIFY: '1' }, 'main');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /push gate: refused/);
    assert.throws(() => git(remote, 'rev-parse', 'main'), 'nothing reached the remote');
    assert.deepEqual(await logged(log), ['verify'], 'the browser tests do not run after a failed verify');
    assert.equal(git(repo, 'worktree', 'list').split('\n').length, 1);
    // Deleting a remote branch sends no commit, so nothing is verified even when verify would fail.
    assert.equal(push(repo, { STUB_VERIFY: '0' }, 'main', 'main:side').status, 0);
    const result2 = push(repo, { STUB_VERIFY: '1' }, ':side');
    assert.equal(result2.status, 0, result2.stderr);
    assert.throws(() => git(remote, 'rev-parse', 'refs/heads/side'), 'the branch was deleted');
  } finally { await rm(base, { recursive: true, force: true }); }
});
