import { execFileSync } from 'node:child_process';

// The product commit a build corresponds to. A dirty tree is never published as that commit.
export function sourceRevision(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}
export function buildId(revision) {
  return revision.commit.slice(0, 12) + (revision.dirty ? '-dirty-' + Date.now().toString(36) : '');
}
