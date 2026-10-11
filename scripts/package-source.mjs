import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openSync, closeSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { maxBuffer: 400 * 1024 * 1024, ...options });
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const roots = ['src', 'scripts', 'overlays', 'tests', 'docs'];
const files = ['package.json', 'package-lock.json', 'upstreams.lock.json', 'LICENSE', 'README.md', 'CLAUDE.md', '.gitignore', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json', 'index.html', 'word.html', 'hwp.html', 'public/favicon.svg', 'public/sw.js'];

// Only product source/configuration is published. Never walk the project root or source clones.
export async function productFiles(root) {
  const result = [];
  async function visit(relative) {
    const stat = await lstat(join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`Source package refuses symlinks: ${relative}`);
    if (relative.split('/').some(part => part.startsWith('.') || ['node_modules', 'backups', 'artifacts'].includes(part))) return;
    if (stat.isDirectory()) {
      for (const entry of (await readdir(join(root, relative))).sort()) await visit(`${relative}/${entry}`);
    } else if (stat.isFile()) {
      if (!/\.(?:ts|js|mjs|svelte|css|html|json|md|txt|patch|svg)$/.test(relative)) throw new Error(`Review source package allowlist for: ${relative}`);
      result.push(relative);
    }
  }
  for (const dir of roots) await visit(dir);
  for (const file of files) {
    const stat = await lstat(join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source package requires a regular file: ${file}`);
    result.push(file);
  }
  return [...new Set(result)].sort();
}

// A single revision's object closure, without unrelated history, refs, remotes or credentials.
export const rhwpExcluded = ['mydocs', 'pdf', 'samples', 'saved', 'ttfs', 'tools'];
export const rhwpIncluded = ['samples/hwp3-sample16-hwp5-2024-password-123456.hwp', 'tools/rhwp-subsecond', 'tools/batch-convert', 'tools/llm_verifier/verdict_protocol', 'tools/llm_verifier/claim_bind', 'tools/llm_verifier/criteria_decomp'];
const keepRhwp = path => !rhwpExcluded.some(dir => path === dir || path.startsWith(dir + '/')) || rhwpIncluded.some(dir => path === dir || path.startsWith(dir + '/'));
export function packRevision(repository, commit, destination, sparse = false) {
  let objects;
  if (sparse) {
    const entries = run('git', ['-C', repository, 'ls-tree', '-r', '-t', '-z', commit]).toString('utf8').split('\0').filter(Boolean);
    const ids = [commit, run('git', ['-C', repository, 'rev-parse', commit + '^{tree}']).toString().trim()];
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      const [, type, id] = entry.slice(0, tab).split(' ');
      if (type === 'tree' || (type === 'blob' && keepRhwp(entry.slice(tab + 1)))) ids.push(id);
    }
    objects = [...new Set(ids)].join('\n') + '\n';
  } else objects = run('git', ['-C', repository, 'rev-list', '--objects', '--no-walk', commit]);
  const fd = openSync(destination, 'w');
  try { run('git', ['-C', repository, 'pack-objects', '--stdout', '--threads=1'], { input: objects, stdio: ['pipe', fd, 'pipe'] }); }
  finally { closeSync(fd); }
}

export const restoreScript = `import { readFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
const root = resolve(import.meta.dirname, '..');
const records = JSON.parse(await readFile(join(root, 'upstream-packs/manifest.json'), 'utf8'));
for (const item of records) {
  const target = join(root, item.path);
  const entries = await readdir(target).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (entries.length) throw new Error('Refusing to replace existing directory: ' + target);
  await mkdir(target, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', target, ...args], { stdio: 'inherit' });
  git('init', '-q');
  const fd = openSync(join(root, 'upstream-packs', item.name + '.pack'), 'r');
  try { execFileSync('git', ['-C', target, 'index-pack', '--stdin'], { stdio: [fd, 'ignore', 'inherit'] }); } finally { closeSync(fd); }
  await (await import('node:fs/promises')).writeFile(join(target, '.git/shallow'), item.commit + '\\n');
  git('remote', 'add', 'origin', item.url);
  if (item.sparsePatterns) {
    const fs = await import('node:fs/promises');
    git('config', 'core.sparseCheckout', 'true');
    git('config', 'core.sparseCheckoutCone', 'false');
    await fs.writeFile(join(target, '.git/info/sparse-checkout'), item.sparsePatterns.join('\\n') + '\\n');
    git('config', 'remote.origin.promisor', 'true');
    git('config', 'remote.origin.partialclonefilter', 'blob:none');
    for (const name of await fs.readdir(join(target, '.git/objects/pack'))) if (name.endsWith('.pack')) await fs.writeFile(join(target, '.git/objects/pack', name.replace(/\\.pack$/, '.promisor')), '');
  }
  git('checkout', '--detach', item.commit);
}
console.log('Pinned source repositories restored offline. Run npm ci, then npm run build.');
`;

export async function packageSource({ root = projectRoot, output = join(root, 'public'), lock } = {}) {
  lock ??= JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8')); 
  const temporary = await mkdtemp(join(tmpdir(), 'sketch-doc-source-'));
  const stage = join(temporary, 'sketch-doc-source');
  const legal = join(output, 'legal');
  try {
    await mkdir(stage);
    const selected = await productFiles(root);
    for (const relative of selected) {
      await mkdir(join(stage, relative, '..'), { recursive: true });
      await cp(join(root, relative), join(stage, relative));
    }
    // Candidate packages must carry the candidate lock, never the current release lock.
    await writeFile(join(stage, 'upstreams.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    const records = [
      { name: 'edentext', path: 'source/edentext', ...lock.edentext },
      { name: 'hop', path: 'source/hop', ...lock.hop },
      { name: 'rhwp', path: 'source/hop/third_party/rhwp', url: 'https://github.com/edwardkim/rhwp.git', ...lock.rhwp, sparsePatterns: ['/*', ...rhwpExcluded.map(dir => '!/' + dir + '/'), '/samples/', '!/samples/*', ...rhwpIncluded.filter(path => path.startsWith('samples/')).map(path => '/' + path), '/tools/', '!/tools/*', '/tools/llm_verifier/', '!/tools/llm_verifier/*', ...rhwpIncluded.filter(path => path.startsWith('tools/')).map(path => '/' + path + '/')]  },
    ];
    await mkdir(join(stage, 'upstream-packs'));
    const packCache = join(root, '.cache/source-packs');
    await mkdir(packCache, { recursive: true });
    for (const item of records) {
      const cached = join(packCache, item.name + '-' + item.commit + (item.sparsePatterns ? '-sparse-' + createHash('sha256').update(JSON.stringify(item.sparsePatterns)).digest('hex').slice(0, 12) : '') + '.pack');
      const complete = cached + '.complete';
      if (!await lstat(complete).then(() => true, () => false)) {
        packRevision(join(root, item.path), item.commit, cached, !!item.sparsePatterns);
        await writeFile(complete, await hashFile(cached));
      }
      if (await hashFile(cached) !== await readFile(complete, 'utf8')) throw new Error('Cached source pack checksum mismatch: ' + item.name);
      await cp(cached, join(stage, 'upstream-packs', item.name + '.pack'));
    }
    await writeFile(join(stage, 'upstream-packs/manifest.json'), JSON.stringify(records, null, 2));
    await mkdir(join(stage, 'scripts'), { recursive: true });
    await writeFile(join(stage, 'scripts/restore-packaged-upstreams.mjs'), restoreScript);
    await writeFile(join(stage, 'SOURCE-README.txt'), `배포판 대응 소스 / Corresponding source\n\nNode.js 24.21.0, npm, Git, tar 필요.\n1. node scripts/restore-packaged-upstreams.mjs\n2. npm ci\n3. npm run build\n\n1단계는 포함된 Git object pack으로 정확한 upstream 커밋의 빌드 소스를 오프라인 복원합니다. rhwp는 sparse checkout으로 PDF/샘플/개발 출력물을 제외합니다. 제외 경로와 포함 예외는 upstream-packs/manifest.json에 기록됩니다. 원본 전체 시험 자료는 origin에서 추가 다운로드할 수 있습니다.\n원본 저장소의 과거 이력, 계정 설정, 개발자 비밀값은 포함하지 않습니다.\n2·3단계의 npm 의존성 설치는 npm registry 접근이 필요합니다.\n복원 직후 upstream:sync는 불필요합니다. npm run verify는 Chrome 설치가 필요합니다.\n수정 내용: 한국어 기본 설정, 공통 편집기 화면/메뉴, 로컬 파일 저장 및 회귀 검사.\n제품 소스는 LICENSE의 AGPL-3.0 조건, 각 구성 요소는 원본 라이선스를 따릅니다.\n이 자료는 의존성/폰트 전체에 대한 법률 검토 완료를 의미하지 않습니다.\n`);
    await mkdir(legal, { recursive: true });
    const notices = [
      ['LICENSE', join(root, 'LICENSE')],
      ['LICENSE-edentext', join(root, 'source/edentext/LICENSE')],
      ['LICENSE-hop', join(root, 'source/hop/LICENSE')],
      ['LICENSE-rhwp', join(root, 'source/hop/third_party/rhwp/LICENSE')],
      ['THIRD_PARTY_LICENSES-rhwp.md', join(root, 'source/hop/third_party/rhwp/THIRD_PARTY_LICENSES.md')],
      ['licenses-edentext.txt', join(output, 'engines/word/licenses.txt')],
      ...['canvaskit-wasm', '@noble/hashes', 'fflate', 'svelte'].map(name => [`LICENSE-${name.replaceAll('/', '-')}`, join(root, 'node_modules', name, name === 'svelte' ? 'LICENSE.md' : 'LICENSE')]),
    ];
    const sections = ['Sketch Docs — 라이선스 및 타사 고지\n\n제품: AGPL-3.0-only. EdenText: AGPL-3.0-only. HOP/rhwp: MIT.\n각 아래 원문과 배포판 소스를 함께 확인하세요. 이 목록은 법률 검토 인증이 아닙니다.'];
    await mkdir(join(stage, 'legal'));
    for (const [name, from] of notices) {
      const bytes = await readFile(from);
      await writeFile(join(legal, name), bytes);
      await writeFile(join(stage, 'legal', name), bytes);
      sections.push(`\n\n===== ${name} =====\n\n${bytes.toString('utf8')}`);
    }
    await writeFile(join(legal, 'notices.txt'), sections.join(''));
    await writeFile(join(stage, 'legal/notices.txt'), sections.join(''));
    const archive = join(temporary, 'source.tar.gz');
    run('tar', ['-czf', archive, '-C', temporary, 'sketch-doc-source'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const hash = await hashFile(archive);
    const name = `source-${hash.slice(0, 16)}.tar.gz`;
    await cp(archive, join(legal, name));
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const metadata = { name: 'Sketch Docs', version: pkg.version, generatedAt: new Date().toISOString(), upstreams: lock, sourceUrl: `./legal/${name}`, sourceSha256: hash, sourceBytes: (await lstat(archive)).size, sourceSize: (await lstat(archive)).size, license: 'AGPL-3.0-only', licenseUrl: './legal/LICENSE', noticesUrl: './legal/notices.txt' };
    await writeFile(join(legal, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
    for (const old of await readdir(legal)) {
      if (/^source-[a-f0-9]{16}\.tar\.gz$/.test(old) && old !== name) await rm(join(legal, old));
    }
    return metadata;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) console.log(await packageSource());
