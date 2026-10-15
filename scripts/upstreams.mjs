import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, git } from './build-engines.mjs';
import { verify, productHash } from './verify.mjs';
import { SUPERPROJECTS, UPSTREAMS, assertUpstreamsClean, checkoutUpstream, latestOriginal, restoreUpstreams, syncUpstreams, upstreamHeads, upstreamPaths } from './upstream-git.mjs';

const lockPath = join(root, 'upstreams.lock.json');
const locked = JSON.parse(await readFile(lockPath, 'utf8'));
const paths = upstreamPaths(root, locked);
const command = process.argv[2];
if (command === 'sync') {
  await mkdir(join(root, 'source'), { recursive: true });
  syncUpstreams(root, locked);
} else if (command === 'candidate') {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts/candidate-verified.json'), JSON.stringify({ passed: false, startedAt: new Date().toISOString() }));
  assertUpstreamsClean(paths);
  const original = upstreamHeads(paths);
  try {
    // Default: each original's latest default branch. --edentext/--hop/--gridcraft REF pick revisions; --current keeps the checkout.
    const explicit = SUPERPROJECTS.filter(name => process.argv.includes(`--${name}`));
    const latest = !explicit.length && !process.argv.includes('--current');
    for (const name of SUPERPROJECTS) {
      let revision;
      if (latest) {
        revision = latestOriginal(paths[name], locked[name].url);
      } else if (explicit.includes(name)) {
        const ref = process.argv[process.argv.indexOf(`--${name}`) + 1];
        if (!ref || ref.startsWith('--')) throw new Error(`--${name} requires a git revision`);
        try { execFileSync('git', ['-C', paths[name], 'fetch', '--quiet', 'origin'], { stdio: 'inherit' }); } catch { /* local refs remain usable offline */ }
        revision = git(paths[name], 'rev-parse', `${ref}^{commit}`);
      }
      if (revision) checkoutUpstream(paths, name, revision);
    }
    const candidate = structuredClone(locked);
    // Dependents were moved to their superproject's record (HOP's gitlink, GridCraft's Cargo.lock).
    const heads = upstreamHeads(paths);
    for (const name of UPSTREAMS) candidate[name].commit = heads[name];
    candidate.rhwp.version = JSON.parse(await readFile(join(root, 'source/hop/apps/studio-host/vendor/rhwp-core/package.json'), 'utf8')).version;
    const changes = UPSTREAMS.filter(name => candidate[name].commit !== locked[name].commit);
    console.log('Candidate upstreams:\n' + UPSTREAMS.map(name => `  ${name}: ${locked[name].commit.slice(0, 12)} → ${candidate[name].commit.slice(0, 12)}${changes.includes(name) ? '' : ' (unchanged)'}`).join('\n'));
    if (latest && !changes.length) {
      console.log('Pinned upstreams are already the latest; push CI verifies them. Nothing to check.');
    } else {
      await mkdir(join(root, '.cache'), { recursive: true });
      const path = join(root, '.cache/candidate-lock.json');
      await writeFile(path, JSON.stringify(candidate, null, 2));
      await verify({ candidate: true, lockPath: path });
      console.log('Candidate passed. Review artifacts/candidate-verified.json, then npm run upstream:promote.');
    }
  } finally {
    restoreUpstreams(paths, original);
  }
} else if (command === 'promote') {
  const report = JSON.parse(await readFile(join(root, 'artifacts/candidate-verified.json'), 'utf8'));
  if (!report.passed || report.productHash !== await productHash()) throw new Error('Candidate verification missing or stale; rerun upstream:check');
  assertUpstreamsClean(paths);
  for (const name of SUPERPROJECTS) checkoutUpstream(paths, name, report.upstreams[name].commit);
  await writeFile(lockPath, JSON.stringify(report.upstreams, null, 2) + '\n');
  console.log('Pinned versions updated. Run npm run verify to prepare the release output.');
} else throw new Error('Use sync, candidate [--current | --edentext REF] [--hop REF] [--gridcraft REF], or promote');
