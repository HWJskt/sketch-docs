// The pre-push gate (.githooks/pre-push; npm run hooks:install sets core.hooksPath). Every commit a push
// sends must have passed npm run verify: the report in artifacts/verified.json counts when it was made on
// that very commit in a clean tree whose product files are still the same. Otherwise the commit is checked
// out in a temporary worktree and verified there, then the browser tests run once more as an English
// Chrome (TEST_LOCALE=en-US), the case GitHub's runners caught in 4aec08c. `git push --no-verify` skips
// every hook; nothing here can prevent that.
import { readFile, mkdtemp, realpath, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ZERO = /^0+$/;
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

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const out = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

/** Verifies `sha` in a throwaway worktree that borrows this checkout's upstream clones, build caches and, when the lockfile matches, node_modules. */
async function verifyInWorktree(root, sha) {
  // The real path: on macOS tmpdir() is under /var → /private/var, and the scripts run only when
  // process.argv[1] equals import.meta.filename (a resolved path), so verify would silently do nothing.
  const base = await realpath(await mkdtemp(join(tmpdir(), 'sketch-docs-push-')));
  const dir = join(base, 'tree');
  const links = [];
  run('git', ['-C', root, 'worktree', 'add', '--detach', dir, sha]);
  try {
    const share = async name => { await symlink(join(root, name), join(dir, name)); links.push(join(dir, name)); };
    await share('source');
    await share('.cache');
    const sameLock = out('git', ['-C', root, 'rev-parse', `${sha}:package-lock.json`]) === out('git', ['-C', root, 'hash-object', join(root, 'package-lock.json')]);
    if (sameLock) await share('node_modules'); else run('npm', ['ci'], { cwd: dir });
    run(process.execPath, [join(dir, 'scripts/verify.mjs')], { cwd: dir });
    for (const test of BROWSER_TESTS) run(process.execPath, [join(dir, test)], { cwd: dir, env: { ...process.env, TEST_DIST: join(dir, 'dist'), TEST_LOCALE: 'en-US' }, timeout: 240000 });
  } finally {
    // Remove only the links themselves, then the worktree; the shared folders stay untouched.
    for (const link of links) if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
    try { run('git', ['-C', root, 'worktree', 'remove', '--force', dir]); }
    catch (error) { console.error(`push gate: could not remove the worktree ${dir}: ${error.message}`); }
    await rm(base, { recursive: true, force: true });
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
  for (const { sha, remoteRef } of commits) {
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
