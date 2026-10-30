// The pre-push gate (.githooks/pre-push; npm run hooks:install sets core.hooksPath). The commit at the tip
// of every ref a push updates must have passed npm run verify (commits in between are not verified one by
// one; a deployment is built from a tip). The report in artifacts/verified.json counts when it was made on
// that very commit in a clean tree whose product files are still the same. Otherwise the commit is checked
// out in a temporary worktree and verified there. Either way the browser tests ran in this machine's
// language and as an English Chrome (verify does both). `git push --no-verify` skips every hook; nothing
// here can prevent that.
import { readFile, mkdtemp, mkdir, realpath, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const ZERO = /^0+$/;
const PREFIX = 'sketch-docs-push-';

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

/** Whether a changed path is documentation only: Markdown or docs/, outside the product directories productHash reads. */
export function isDocPath(path) {
  if (/^(src|scripts|overlays|tests|public)\//.test(path)) return false;
  return path.startsWith('docs/') || path.endsWith('.md');
}

const out = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

/** The commit a pushed object stands for (an annotated tag points at one); undefined for a tag on a tree or blob. */
export function pushedCommit(root, sha) {
  try { return out('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`]); } catch { return undefined; }
}

/**
 * The verified commit when `sha` descends from it and every file changed since is documentation (isDocPath);
 * otherwise undefined. Such a commit builds the same product, so the report still speaks for it. A deploy
 * still needs verify on the exact commit (scripts/deploy.mjs), since the build records its commit.
 */
export function docsOnlyAfterReport(root, report, sha) {
  const base = report?.passed && !report.revision?.dirty ? report.revision?.commit : undefined;
  if (!base || base === sha) return undefined;
  try { out('git', ['-C', root, 'merge-base', '--is-ancestor', base, sha]); } catch { return undefined; }
  const changed = out('git', ['-C', root, 'diff', '--no-renames', '--name-only', base, sha]).split('\n').filter(Boolean);
  return changed.length && changed.every(isDocPath) ? base : undefined;
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
  for (const name of ['source', '.cache/build/gridcraft-target']) {
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
 * Verifies `sha` in a throwaway worktree. It borrows this checkout's upstream clones and Cargo's build
 * output, but has its own build workspaces, so a dev server or verify running in this checkout meanwhile
 * cannot change what is verified. node_modules is installed, not linked: Vite resolves a linked
 * node_modules to this checkout, and the build's module paths (scripts/pdf-manifest.mjs) no longer match.
 */
async function verifyInWorktree(root, sha) {
  await removeStaleWorktrees(root);
  // The real path: on macOS tmpdir() is under /var → /private/var, and the scripts run only when
  // process.argv[1] equals import.meta.filename (a resolved path), so verify would silently do nothing.
  const base = await realpath(await mkdtemp(join(tmpdir(), PREFIX)));
  const dir = join(base, 'tree');
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, sha], { stdio: 'inherit' });
  // One removal shared by the signal handler and the finally below: the interrupted child's exit also
  // runs the finally, and two removals racing let either exit (130 or the refusal's 1) end the process
  // before the worktree is gone.
  let removal;
  const cleanup = () => (removal ??= removeWorktree(root, dir));
  const interrupted = signal => { current?.kill(signal); void cleanup().finally(() => process.exit(130)); };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, interrupted);
  try {
    await symlink(join(root, 'source'), join(dir, 'source'));
    await mkdir(join(root, '.cache/build/gridcraft-target'), { recursive: true });
    await mkdir(join(dir, '.cache/build'), { recursive: true });
    await symlink(join(root, '.cache/build/gridcraft-target'), join(dir, '.cache/build/gridcraft-target'));
    await run('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: dir });
    await run(process.execPath, [join(dir, 'scripts/verify.mjs')], { cwd: dir });
  } finally {
    for (const signal of signals) process.off(signal, interrupted);
    await cleanup();
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
    const docsAfter = docsOnlyAfterReport(root, report, sha);
    if (docsAfter) { console.log(`push gate: ${sha.slice(0, 12)} → ${remoteRef}: only documentation changed since verified ${docsAfter.slice(0, 12)}`); continue; }
    console.log(`push gate: ${sha.slice(0, 12)} → ${remoteRef}: ${covered.why}; verifying it in a temporary worktree (npm run verify)`);
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
