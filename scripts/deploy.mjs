import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './build-engines.mjs';
import { outputHash, productHash } from './verify.mjs';
import { sourceRevision } from './revision.mjs';
import { assertMirrorsPinned } from './mirrors.mjs';

// Uploads only the output that npm run verify approved, built from a commit that is public on GitHub
// with every pinned upstream preserved, so the About dialog's source links are true for this deployment.
export const PROJECT = 'sketch-docs';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

export async function deploymentChecks() {
  const report = JSON.parse(await readFile(join(root, 'artifacts/verified.json'), 'utf8').catch(() => '{}'));
  if (!report.passed) throw new Error('No passing npm run verify report');
  const revision = sourceRevision(root);
  if (revision.dirty) throw new Error('Working tree has uncommitted or untracked changes; commit them and rerun npm run verify');
  if (report.revision?.commit !== revision.commit || report.revision?.dirty) throw new Error('npm run verify ran on a different commit; rerun it');
  if (report.productHash !== await productHash()) throw new Error('Product files changed after verification; rerun npm run verify');
  const output = join(root, 'dist');
  if (report.outputHash !== (await outputHash(output)).hash) throw new Error('dist/ differs from the verified output; rerun npm run verify');
  const release = JSON.parse(await readFile(join(output, 'legal/release.json'), 'utf8'));
  if (release.source.commit !== revision.commit || release.source.dirty) throw new Error('dist/legal/release.json does not link this commit');
  // The About dialog links this repository; check it anonymously, not whatever origin points to.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const repository = pkg.repository.url;
  if (release.source.repository !== repository.replace(/\.git$/, '')) throw new Error('release.json links a different repository than package.json');
  try {
    execFileSync('git', ['-C', root, '-c', 'credential.helper=', 'fetch', '--quiet', repository, 'main'], { stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    git('merge-base', '--is-ancestor', revision.commit, 'FETCH_HEAD');
  } catch { throw new Error(`Commit ${revision.commit} is not publicly reachable on main of ${repository}; push it before deploying`); }
  const lock = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  assertMirrorsPinned(lock);
  return { commit: revision.commit, output };
}

if (process.argv[1] === import.meta.filename) {
  const { commit, output } = await deploymentChecks();
  console.log(`Deploying verified dist/ for ${commit} to Cloudflare Pages project ${PROJECT}`);
  execFileSync(join(root, 'node_modules/.bin/wrangler'), ['pages', 'deploy', output, '--project-name', PROJECT, '--branch', 'main', '--commit-hash', commit, '--commit-message', git('log', '-1', '--format=%s'), '--commit-dirty=false'], { cwd: root, stdio: 'inherit' });
}
