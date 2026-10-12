import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Each pinned upstream commit is kept in our backup fork under a tag, so the corresponding
// source stays available even if the original repository disappears or rewrites history.
const root = resolve(import.meta.dirname, '..');
const names = ['edentext', 'hop', 'rhwp'];
export const pinTag = commit => `sketch-docs/pin-${commit}`;
export function githubRepo(url) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`Not a GitHub repository URL: ${url}`);
  return match[1];
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function mirrorStatus(lock) {
  return names.map(name => {
    const { mirror, commit } = lock[name];
    let pinned = false;
    try { pinned = run('git', ['ls-remote', mirror, `refs/tags/${pinTag(commit)}`]).split(/\s/)[0] === commit; }
    catch { /* a missing fork counts as not pinned */ }
    return { name, mirror, commit, pinned };
  });
}
export function assertMirrorsPinned(lock) {
  const missing = mirrorStatus(lock).filter(item => !item.pinned);
  if (missing.length) throw new Error('Pinned upstream commits are not preserved in the backup forks (run npm run mirrors:pin):\n' + missing.map(item => `  ${item.name} ${item.commit} → ${item.mirror}`).join('\n'));
}

function pin(lock) {
  for (const item of mirrorStatus(lock)) {
    if (item.pinned) { console.log(`${item.name}: already pinned`); continue; }
    const repo = githubRepo(item.mirror);
    try { run('gh', ['repo', 'view', repo, '--json', 'name']); }
    catch {
      const original = githubRepo(lock[item.name].url);
      if (repo.split('/')[1] !== original.split('/')[1]) throw new Error(`${repo} does not exist and is not named like ${original}`);
      const owner = repo.split('/')[0];
      console.log(`${item.name}: forking ${original} → ${owner}`);
      run('gh', ['repo', 'fork', original, '--clone=false', ...(owner === run('gh', ['api', 'user', '--jq', '.login']) ? [] : ['--org', owner])]);
    }
    const create = () => run('gh', ['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${pinTag(item.commit)}`, '-f', `sha=${item.commit}`]);
    try { create(); }
    catch (error) {
      // A fork only sees new upstream commits after syncing its default branch.
      console.log(`${item.name}: syncing ${repo} with its parent and retrying (${String(error.stderr || error.message).trim().split('\n')[0]})`);
      run('gh', ['repo', 'sync', repo]);
      create();
    }
    console.log(`${item.name}: tagged ${pinTag(item.commit)} in ${repo}`);
  }
  assertMirrorsPinned(lock);
  console.log('All pinned upstream commits are preserved in the backup forks.');
}

if (process.argv[1] === import.meta.filename) {
  const lock = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  if (process.argv[2] === 'pin') pin(lock);
  else if (process.argv[2] === 'check') { assertMirrorsPinned(lock); console.log('Backup forks hold every pinned commit.'); }
  else throw new Error('Use pin or check');
}
