import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Git operations on the upstream clones. None of them may discard user bytes:
// tracked changes stop the run, and ignored files are never overwritten by a checkout.
export const gitOut = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const gitRun = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

export function hasCommit(dir, revision) {
  try { gitOut(dir, 'cat-file', '-e', `${revision}^{commit}`); return true; } catch { return false; }
}
export function assertClean(dir, label, { ignoreSubmodules = false } = {}) {
  const status = gitOut(dir, 'status', '--porcelain', ...(ignoreSubmodules ? ['--ignore-submodules=all'] : []));
  if (status) throw new Error(`${label} has local changes; nothing was changed:\n${status}`);
}
export function checkout(dir, revision) {
  if (!hasCommit(dir, revision)) gitRun(dir, 'fetch', 'origin', revision);
  gitRun(dir, 'checkout', '--quiet', '--no-overwrite-ignore', '--detach', revision);
}
// Moves a submodule to the commit its superproject records, with the same protections.
export function syncSubmodule(superproject, path) {
  const dir = join(superproject, path);
  if (!existsSync(join(dir, '.git'))) { gitRun(superproject, 'submodule', 'update', '--init', '--', path); return; }
  checkout(dir, gitOut(superproject, 'rev-parse', `HEAD:${path}`));
}

export function upstreamPaths(root) {
  const hop = join(root, 'source/hop');
  return { edentext: join(root, 'source/edentext'), hop, rhwp: join(hop, 'third_party/rhwp'), rhwpPath: 'third_party/rhwp' };
}
export function assertUpstreamsClean(paths) {
  assertClean(paths.edentext, 'edentext');
  assertClean(paths.hop, 'hop', { ignoreSubmodules: true });
  assertClean(paths.rhwp, 'rhwp');
}
export function upstreamHeads(paths) {
  return { edentext: gitOut(paths.edentext, 'rev-parse', 'HEAD'), hop: gitOut(paths.hop, 'rev-parse', 'HEAD'), rhwp: gitOut(paths.rhwp, 'rev-parse', 'HEAD') };
}
export function checkoutUpstream(paths, name, revision) {
  checkout(paths[name], revision);
  if (name === 'hop') syncSubmodule(paths.hop, paths.rhwpPath);
}
// Returns every clone to the exact recorded HEADs, including an rhwp checkout that differs
// from HOP's gitlink. Every clone is attempted; failures are reported together.
export function restoreUpstreams(paths, heads) {
  const failures = [];
  for (const [name, revision] of [['edentext', heads.edentext], ['hop', heads.hop], ['rhwp', heads.rhwp]]) {
    try { checkout(paths[name], revision); }
    catch (error) { failures.push(`${name} → ${revision}: ${error.message}`); }
  }
  if (failures.length) throw new Error('Could not restore upstream checkouts:\n' + failures.join('\n'));
}
