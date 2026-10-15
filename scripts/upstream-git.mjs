import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Git operations on the upstream clones. None of them may discard user bytes:
// tracked changes stop the run, and ignored files are never overwritten by a checkout.
export const gitOut = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const gitRun = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

// Superprojects are cloned and moved directly. Each dependent follows its superproject's record:
// rhwp is HOP's submodule, craft-libs is the git dependency in GridCraft's Cargo.lock.
export const SUPERPROJECTS = ['edentext', 'hop', 'gridcraft'];
export const UPSTREAMS = ['edentext', 'hop', 'rhwp', 'gridcraft', 'craft-libs'];

export function hasCommit(dir, revision) {
  try { gitOut(dir, 'cat-file', '-e', `${revision}^{commit}`); return true; } catch { return false; }
}
export function assertClean(dir, label, { ignoreSubmodules = false } = {}) {
  const status = gitOut(dir, 'status', '--porcelain', ...(ignoreSubmodules ? ['--ignore-submodules=all'] : []));
  if (status) throw new Error(`${label} has local changes; nothing was changed:\n${status}`);
}
// git -C on a folder that is not a clone acts on the enclosing repository (the product); refuse instead.
function assertClone(dir) {
  if (!initialized(dir)) throw new Error(`${dir} is not a git clone; nothing was changed`);
}
// A pinned commit missing from origin (rewritten or deleted upstream) is fetched from our backup fork.
export function checkout(dir, revision, mirror) {
  assertClone(dir);
  if (!hasCommit(dir, revision)) {
    try { gitRun(dir, 'fetch', 'origin', revision); }
    catch (error) { if (!mirror) throw error; gitRun(dir, 'fetch', mirror, revision); }
  }
  gitRun(dir, 'checkout', '--quiet', '--no-overwrite-ignore', '--detach', revision);
}
// Moves a submodule to the commit its superproject records, with the same protections.
export function syncSubmodule(superproject, path, mirror) {
  const dir = join(superproject, path);
  if (!initialized(dir)) {
    try { gitRun(superproject, 'submodule', 'update', '--init', '--', path); }
    catch (error) { if (!mirror) throw error; gitRun(superproject, '-c', `submodule.${path}.url=${mirror}`, 'submodule', 'update', '--init', '--', path); }
    return;
  }
  checkout(dir, gitOut(superproject, 'rev-parse', `HEAD:${path}`), mirror);
}

const bareUrl = url => url.replace(/\.git$/, '').replace(/\/$/, '');
/** The single commit a Cargo.lock pins for the git dependency at `url`; several different pins are an error. */
export function cargoGitPin(lockText, url) {
  const commits = new Set();
  for (const match of lockText.matchAll(/^source = "git\+([^"?#]+)[^"#]*#([0-9a-f]{40})"$/gm)) if (bareUrl(match[1]) === bareUrl(url)) commits.add(match[2]);
  if (commits.size !== 1) throw new Error(`Cargo.lock pins ${url} ${commits.size ? 'at several commits: ' + [...commits].join(', ') : 'nowhere'}`);
  return [...commits][0];
}
/** The craft-libs commit the GridCraft checkout's committed Cargo.lock builds against. */
export const craftLibsPin = paths => cargoGitPin(gitOut(paths.gridcraft, 'show', 'HEAD:Cargo.lock'), paths.urls['craft-libs']);

export function upstreamPaths(root, lock = {}) {
  const hop = join(root, 'source/hop');
  const mirrors = Object.fromEntries(UPSTREAMS.map(name => [name, lock[name]?.mirror]));
  const urls = Object.fromEntries(UPSTREAMS.map(name => [name, lock[name]?.url]));
  return {
    edentext: join(root, 'source/edentext'), hop, rhwp: join(hop, 'third_party/rhwp'), rhwpPath: 'third_party/rhwp',
    gridcraft: join(root, 'source/gridcraft'), 'craft-libs': join(root, 'source/craft-libs'), mirrors, urls,
  };
}
const initialized = dir => existsSync(join(dir, '.git'));
export function assertUpstreamsClean(paths) {
  assertClean(paths.edentext, 'edentext');
  assertClean(paths.hop, 'hop', { ignoreSubmodules: true });
  assertClean(paths.gridcraft, 'gridcraft');
  // An uninitialized dependent holds no user bytes (git -C would otherwise inspect its parent).
  if (initialized(paths.rhwp)) assertClean(paths.rhwp, 'rhwp');
  if (initialized(paths['craft-libs'])) assertClean(paths['craft-libs'], 'craft-libs');
}
export function upstreamHeads(paths) {
  return Object.fromEntries(UPSTREAMS.map(name => { assertClone(paths[name]); return [name, gitOut(paths[name], 'rev-parse', 'HEAD')]; }));
}
// craft-libs is not a submodule: it is cloned beside GridCraft, so the source behind the Cargo.lock pin
// stays in our hands (and in its backup fork) rather than only in Cargo's download cache.
function syncCraftLibs(paths) {
  const dir = paths['craft-libs'];
  if (!initialized(dir)) cloneUpstream(dir, paths.urls['craft-libs'], paths.mirrors?.['craft-libs']);
  checkout(dir, craftLibsPin(paths), paths.mirrors?.['craft-libs']);
}
export function checkoutUpstream(paths, name, revision) {
  checkout(paths[name], revision, paths.mirrors?.[name]);
  if (name === 'hop') syncSubmodule(paths.hop, paths.rhwpPath, paths.mirrors?.rhwp);
  if (name === 'gridcraft') syncCraftLibs(paths);
}
// Returns every clone to the exact recorded HEADs, including a dependent checkout that differs
// from its superproject's record. Every clone is attempted; failures are reported together.
export function restoreUpstreams(paths, heads) {
  const failures = [];
  for (const name of UPSTREAMS) {
    try { checkout(paths[name], heads[name], paths.mirrors?.[name]); }
    catch (error) { failures.push(`${name} → ${heads[name]}: ${error.message}`); }
  }
  if (failures.length) throw new Error('Could not restore upstream checkouts:\n' + failures.join('\n'));
}

// Clones only the superprojects; dependents are initialized after the pinned superproject checkout so
// that a missing original rhwp or craft-libs can still be restored from its backup fork.
export function cloneUpstream(dir, url, mirror) {
  try { gitRun(join(dir, '..'), 'clone', '--quiet', url, dir); }
  catch (error) {
    if (existsSync(dir) || !mirror) throw error;
    console.warn(`${dir}: original repository unavailable; cloning the backup fork ${mirror}`);
    gitRun(join(dir, '..'), 'clone', '--quiet', mirror, dir);
  }
}
export function syncUpstreams(root, lock) {
  const paths = upstreamPaths(root, lock);
  for (const name of SUPERPROJECTS) if (!existsSync(paths[name])) cloneUpstream(paths[name], lock[name].url, lock[name].mirror);
  assertUpstreamsClean(paths);
  for (const name of SUPERPROJECTS) checkoutUpstream(paths, name, lock[name].commit);
  return paths;
}
// The latest default-branch commit of the original repository, never of the fork that may be origin.
export function latestOriginal(dir, url) {
  gitRun(dir, 'fetch', '--quiet', url, 'HEAD');
  return gitOut(dir, 'rev-parse', 'FETCH_HEAD^{commit}');
}
