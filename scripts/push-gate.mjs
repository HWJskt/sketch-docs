// The pre-push gate (.githooks/pre-push; npm run hooks:install sets core.hooksPath). The commit at the tip
// of every ref a push updates must have passed npm run verify (commits in between are not verified one by
// one; a deployment is built from a tip). The report in artifacts/verified.json counts when it was made on
// that very commit in a clean tree whose product files are still the same. Otherwise the commit is checked
// out in a temporary worktree and verified there, then the browser tests run once more as an English
// Chrome (TEST_LOCALE=en-US), the case GitHub's runners caught in 4aec08c; a commit that passes through the
// saved report does not get that English run. `git push --no-verify` skips every hook; nothing here can
// prevent that.
import { readFile, mkdtemp, mkdir, realpath, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const ZERO = /^0+$/;
const PREFIX = 'sketch-docs-push-';
const BROWSER_TESTS = ['tests/integration.mjs', 'tests/regressions.mjs', 'tests/pdf.integration.mjs', 'tests/xlsx.integration.mjs'];

/** pre-push stdin: one `<local ref> <local sha> <remote ref> <remote sha>` per line; deletions send nothing to check. */
export function commitsToCheck(stdin) {
  const commits = [];
  for (const line of stdin.split('\n')) {
    const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue;
    if (!commits.some(item => item.sha === localSha)) commits.push({ sha: localSha, localRef, remoteRef });
  }
  return commits;
}

/** Whether the saved verify report already covers `sha`; `why` says what is missing. */
export function reportCovers(report, { sha, head, clean, productHash }) {
  if (!report?.passed) return { ok: false, why: 'no passing npm run verify report' };
  if (report.revision?.commit !== sha) return { ok: false, why: `the report is for ${String(report.revision?.commit).slice(0, 12)}` };
  if (report.revision.dirty) return { ok: false, why: 'the report was made with uncommitted changes' };
  if (head !== sha || !clean) return { ok: false, why: 'the commit is not the clean checkout here, so its product files cannot be compared' };
  if (report.productHash !== productHash) return { ok: false, why: 'product files changed after the report' };
  return { ok: true };
}

const out = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

/** The commit a pushed object stands for (an annotated tag points at one); undefined for a tag on a tree or blob. */
export function pushedCommit(root, sha) {
  try { return out('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`]); } catch { return undefined; }
}

// Children run asynchronously so an interrupt (Ctrl-C, a closed terminal) still reaches the cleanup below.
let current;
function run(cmd, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    current = child;
    const timer = options.timeout ? setTimeout(() => child.kill('SIGTERM'), options.timeout) : undefined;
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      clearTimeout(timer); current = undefined;
      if (code === 0) done(); else fail(new Error(`${[cmd, ...args].join(' ')} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

/** Removes a gate worktree: its links first (so nothing they point to is touched), then the worktree. */
async function removeWorktree(root, dir) {
  for (const name of ['source', 'node_modules', '.cache/build/gridcraft-target']) {
    const link = join(dir, name);
    if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
  }
  try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir], { stdio: 'inherit' }); }
  catch (error) { console.error(`push gate: could not remove the worktree ${dir}: ${error.message}`); }
  await rm(dirname(dir), { recursive: true, force: true });
}

/** Worktrees an interrupted earlier run left behind. */
async function removeStaleWorktrees(root) {
  const listed = out('git', ['-C', root, 'worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
  for (const dir of listed) if (basename(dir) === 'tree' && basename(dirname(dir)).startsWith(PREFIX)) await removeWorktree(root, dir);
}

/**
 * Verifies `sha` in a throwaway worktree. It borrows this checkout's upstream clones, Cargo's build output
 * and (when the lockfile matches) node_modules, but has its own build workspaces, so a dev server or
 * verify running in this checkout meanwhile cannot change what is verified.
 */
async function verifyInWorktree(root, sha) {
  await removeStaleWorktrees(root);
  // The real path: on macOS tmpdir() is under /var → /private/var, and the scripts run only when
  // process.argv[1] equals import.meta.filename (a resolved path), so verify would silently do nothing.
  const base = await realpath(await mkdtemp(join(tmpdir(), PREFIX)));
  const dir = join(base, 'tree');
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, sha], { stdio: 'inherit' });
  const interrupted = signal => { current?.kill(signal); void removeWorktree(root, dir).finally(() => process.exit(130)); };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, interrupted);
  try {
    await symlink(join(root, 'source'), join(dir, 'source'));
    await mkdir(join(root, '.cache/build/gridcraft-target'), { recursive: true });
    await mkdir(join(dir, '.cache/build'), { recursive: true });
    await symlink(join(root, '.cache/build/gridcraft-target'), join(dir, '.cache/build/gridcraft-target'));
    const sameLock = out('git', ['-C', root, 'rev-parse', `${sha}:package-lock.json`]) === out('git', ['-C', root, 'hash-object', join(root, 'package-lock.json')]);
    if (sameLock) await symlink(join(root, 'node_modules'), join(dir, 'node_modules')); else await run('npm', ['ci'], { cwd: dir });
    await run(process.execPath, [join(dir, 'scripts/verify.mjs')], { cwd: dir });
    for (const test of BROWSER_TESTS) await run(process.execPath, [join(dir, test)], { cwd: dir, env: { ...process.env, TEST_DIST: join(dir, 'dist'), TEST_LOCALE: 'en-US' }, timeout: 240000 });
  } finally {
    for (const signal of signals) process.off(signal, interrupted);
    await removeWorktree(root, dir);
  }
}

export async function gate({ root, stdin }) {
  const commits = commitsToCheck(stdin);
  if (!commits.length) return;
  const { productHash } = await import('./verify.mjs');
  const report = JSON.parse(await readFile(join(root, 'artifacts/verified.json'), 'utf8').catch(() => 'null'));
  const head = out('git', ['-C', root, 'rev-parse', 'HEAD']);
  const clean = out('git', ['-C', root, 'status', '--porcelain']) === '';
  const current = clean ? await productHash() : '';
  const seen = new Set();
  for (const { sha: pushed, remoteRef } of commits) {
    const sha = pushedCommit(root, pushed);
    if (!sha) { console.log(`push gate: ${pushed.slice(0, 12)} → ${remoteRef}: not a commit, nothing to verify`); continue; }
    if (seen.has(sha)) continue;
    seen.add(sha);
    const covered = reportCovers(report, { sha, head, clean, productHash: current });
    if (covered.ok) { console.log(`push gate: ${sha.slice(0, 12)} → ${remoteRef}: verified (artifacts/verified.json)`); continue; }
    console.log(`push gate: ${sha.slice(0, 12)} → ${remoteRef}: ${covered.why}; verifying it in a temporary worktree (npm run verify, then the browser tests as en-US)`);
    await verifyInWorktree(root, sha);
    console.log(`push gate: ${sha.slice(0, 12)} passed`);
  }
}

if (process.argv[1] === import.meta.filename) {
  const root = resolve(import.meta.dirname, '..');
  const stdin = await new Promise(done => { let text = ''; process.stdin.setEncoding('utf8').on('data', chunk => { text += chunk; }).on('end', () => done(text)); });
  try { await gate({ root, stdin }); }
  catch (error) {
    console.error(`push gate: refused — ${error.message}\nFix it, or run npm run verify on the commit you push. (git push --no-verify skips this gate.)`);
    process.exit(1);
  }
}
