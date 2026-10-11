import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, git } from './build-engines.mjs';
import { verify, productHash } from './verify.mjs';

const lockPath = join(root, 'upstreams.lock.json');
const locked = JSON.parse(await readFile(lockPath, 'utf8'));
const run = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'inherit' });
async function exists(path) { return access(path).then(() => true, () => false); }
function clean(name) {
  const dir = join(root, 'source', name);
  const changes = name === 'hop' ? git(dir, 'status', '--porcelain', '--ignore-submodules=all') : git(dir, 'status', '--porcelain');
  if (changes) throw new Error(`${name} has local changes; sync never discards them`);
  if (name === 'hop') {
    const sub = join(dir, 'third_party/rhwp');
    if (git(sub, 'status', '--porcelain')) throw new Error('rhwp has local changes');
  }
}
function checkout(name, revision) {
  clean(name);
  const dir = join(root, 'source', name);
  run(dir, 'checkout', '--detach', revision);
  if (name === 'hop') run(dir, 'submodule', 'update', '--init', '--recursive');
}
const command = process.argv[2];
if (command === 'sync') {
  await mkdir(join(root, 'source'), { recursive: true });
  for (const name of ['edentext', 'hop']) {
    const dir = join(root, 'source', name);
    if (!await exists(dir)) execFileSync('git', ['clone', '--recurse-submodules', locked[name].url, dir], { stdio: 'inherit' });
    clean(name);
    run(dir, 'fetch', 'origin', locked[name].commit);
    checkout(name, locked[name].commit);
  }
} else if (command === 'candidate') {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts/candidate-verified.json'), JSON.stringify({ passed: false, startedAt: new Date().toISOString() }));
  for (const name of ['edentext', 'hop']) clean(name);
  const original = Object.fromEntries(['edentext', 'hop'].map(name => [name, git(join(root, 'source', name), 'rev-parse', 'HEAD')]));
  try {
    for (const name of ['edentext', 'hop']) {
      const at = process.argv.indexOf(`--${name}`);
      if (at >= 0) {
        if (!process.argv[at + 1]) throw new Error(`--${name} requires a git revision`);
        checkout(name, git(join(root, 'source', name), 'rev-parse', `${process.argv[at + 1]}^{commit}`));
      }
    }
    const candidate = structuredClone(locked);
    for (const name of ['edentext', 'hop']) candidate[name].commit = git(join(root, 'source', name), 'rev-parse', 'HEAD');
    candidate.rhwp.commit = git(join(root, 'source/hop/third_party/rhwp'), 'rev-parse', 'HEAD');
    candidate.rhwp.version = JSON.parse(await readFile(join(root, 'source/hop/apps/studio-host/vendor/rhwp-core/package.json'), 'utf8')).version;
    await mkdir(join(root, '.cache'), { recursive: true });
    const path = join(root, '.cache/candidate-lock.json');
    await writeFile(path, JSON.stringify(candidate, null, 2));
    await verify({ candidate: true, lockPath: path });
    console.log('Candidate passed. Review artifacts/candidate-verified.json, then npm run upstream:promote.');
  } finally {
    for (const name of ['edentext', 'hop']) checkout(name, original[name]);
  }
} else if (command === 'promote') {
  const report = JSON.parse(await readFile(join(root, 'artifacts/candidate-verified.json'), 'utf8'));
  if (!report.passed || report.productHash !== await productHash()) throw new Error('Candidate verification missing or stale; rerun upstream:check');
  for (const name of ['edentext', 'hop']) clean(name);
  for (const name of ['edentext', 'hop']) checkout(name, report.upstreams[name].commit);
  await writeFile(lockPath, JSON.stringify(report.upstreams, null, 2) + '\n');
  console.log('Pinned versions updated. Run npm run verify to prepare the release output.');
} else throw new Error('Use sync, candidate [--edentext REF] [--hop REF], or promote');
