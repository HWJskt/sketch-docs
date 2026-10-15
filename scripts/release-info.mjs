import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sourceRevision } from './revision.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const repositoryUrl = url => url.replace(/\.git$/, '');
const treeUrl = (url, commit) => `${repositoryUrl(url)}/tree/${commit}`;
const archiveUrl = (url, commit) => `${repositoryUrl(url)}/archive/${commit}.tar.gz`;
export { UPSTREAMS as upstreamNames } from './upstream-git.mjs';
import { UPSTREAMS as upstreamNames } from './upstream-git.mjs';
export const upstreamTitles = { edentext: 'EdenText', hop: 'HOP', rhwp: 'rhwp', gridcraft: 'GridCraft', 'craft-libs': 'craft-libs' };

/**
 * Every package the product ships: the root `dependencies` and theirs, resolved the way Node does
 * (nearest node_modules upward). Dev dependencies are build tools. `optionalDependencies` are skipped:
 * in this tree they are native Node add-ons (pdfjs-dist -> @napi-rs/canvas) that never reach the
 * browser, and which ones install depends on the machine, so the notices would differ between builds.
 */
export async function runtimePackages(root) {
  const found = new Map();
  const read = async dir => JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const locate = async (name, from) => {
    for (let dir = from; ; dir = dirname(dir)) {
      const candidate = join(dir, 'node_modules', name);
      if (await readFile(join(candidate, 'package.json')).then(() => true, () => false)) return candidate;
      if (dir === root || dirname(dir) === dir) return null;
    }
  };
  const visit = async (pkg, from) => {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const dir = await locate(name, from);
      if (!dir) throw new Error(`${pkg.name ?? 'package.json'} depends on ${name}, which is not installed`);
      if (found.has(dir)) continue;
      const own = await read(dir);
      found.set(dir, { name: own.name, version: own.version, dir });
      await visit(own, dir);
    }
  };
  await visit(await read(root), root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The license file a package ships (LICENSE, LICENSE.md, LICENCE, COPYING…), by file name rather than package.json. */
export async function npmLicenseFile(dir, name = dir) {
  const file = (await readdir(dir)).filter(entry => /^(?:licen[cs]e|copying)(?:[.-].*)?$/i.test(entry)).sort()[0];
  if (!file) throw new Error(`${name} has no license file in ${dir}`);
  return join(dir, file);
}

// Exact versions published without a license file (checked 2026-10-13). Their notice states the
// package.json license and repository instead. A new version must be checked and listed again.
export const licenseFileExceptions = {
  'is-reference@3.0.3': 'Svelte compiler dependency; the npm package has no license file',
  'locate-character@3.0.0': 'Svelte compiler dependency; the npm package has no license file',
};

// One notice per installed package; a second installed version of a name gets its version in the file name.
// The source is a file path, or `{ text }` for a listed exception.
async function npmNotices(root, exceptions) {
  const packages = await runtimePackages(root);
  const versions = name => packages.filter(item => item.name === name).length;
  return Promise.all(packages.map(async ({ name, version, dir }) => {
    const label = name.replaceAll('/', '-') + (versions(name) > 1 ? `@${version}` : '');
    const id = `${name}@${version}`;
    if (!exceptions[id]) return [`LICENSE-${label}`, await npmLicenseFile(dir, id)];
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    if (typeof pkg.license !== 'string') throw new Error(`${id} is listed without a license file but its package.json names no license`);
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '(none)';
    return [`LICENSE-${label}`, { text: `${id}\nLicense (package.json): ${pkg.license}\nRepository: ${repository}\nThe published package contains no license file. (${exceptions[id]})\n` }];
  }));
}

// The corresponding source is published on GitHub, not in the deployment:
// our code at the built commit, and each upstream at its pinned commit (original and backup fork).
export async function writeReleaseInfo({ root = projectRoot, output = join(root, 'public'), lock, exceptions = licenseFileExceptions } = {}) {
  lock ??= JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!pkg.repository?.url) throw new Error('package.json repository.url names the public product repository');
  const revision = sourceRevision(root);
  const legal = join(output, 'legal');
  await mkdir(legal, { recursive: true });
  const notices = [
    ['LICENSE', join(root, 'LICENSE')],
    ['LICENSE-edentext', join(root, 'source/edentext/LICENSE')],
    ['LICENSE-hop', join(root, 'source/hop/LICENSE')],
    ['LICENSE-rhwp', join(root, 'source/hop/third_party/rhwp/LICENSE')],
    ['THIRD_PARTY_LICENSES-rhwp.md', join(root, 'source/hop/third_party/rhwp/THIRD_PARTY_LICENSES.md')],
    ['licenses-edentext.txt', join(output, 'engines/word/licenses.txt')],
    ['LICENSE-gridcraft-MIT', join(root, 'source/gridcraft/LICENSE-MIT')],
    ['LICENSE-gridcraft-APACHE', join(root, 'source/gridcraft/LICENSE-APACHE')],
    ['NOTICE-gridcraft', join(root, 'source/gridcraft/NOTICE')],
    ['LICENSE-craft-libs-MIT', join(root, 'source/craft-libs/LICENSE-MIT')],
    ['LICENSE-craft-libs-APACHE', join(root, 'source/craft-libs/LICENSE-APACHE')],
    ['NOTICE-craft-libs', join(root, 'source/craft-libs/NOTICE')],
    ['OFL-Pretendard.txt', join(root, 'overlays/gridcraft/fonts/OFL-Pretendard.txt')],
    ['licenses-gridcraft.txt', join(output, 'engines/gridcraft/licenses.txt')],
    ...await npmNotices(root, exceptions),
  ];
  const sections = ['Sketch Docs — 라이선스 및 타사 고지\n\n제품: AGPL-3.0-only. EdenText: AGPL-3.0-only. HOP/rhwp: MIT. GridCraft/craft-libs: MIT OR Apache-2.0(두 라이선스 전문을 함께 싣습니다). Excel 보기의 한국어 글꼴 Pretendard: SIL OFL 1.1.\n대응 소스는 release.json의 GitHub 링크(우리 코드의 빌드 커밋과 각 원본의 고정 커밋)에서 받을 수 있습니다. 이 목록은 법률 검토 인증이 아닙니다.'];
  for (const [name, from] of notices) {
    const bytes = typeof from === 'string' ? await readFile(from) : Buffer.from(from.text);
    await writeFile(join(legal, name), bytes);
    sections.push(`\n\n===== ${name} =====\n\n${bytes.toString('utf8')}`);
  }
  await writeFile(join(legal, 'notices.txt'), sections.join(''));
  // Earlier builds placed a full source archive here; it is no longer part of the deployment.
  for (const old of await readdir(legal)) if (/^source-[a-f0-9]{16}\.tar\.gz$/.test(old)) await rm(join(legal, old));
  const metadata = {
    schemaVersion: 2,
    name: 'Sketch Docs',
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    license: 'AGPL-3.0-only',
    licenseUrl: './legal/LICENSE',
    noticesUrl: './legal/notices.txt',
    source: {
      repository: repositoryUrl(pkg.repository.url),
      commit: revision.commit,
      dirty: revision.dirty,
      url: treeUrl(pkg.repository.url, revision.commit),
      archiveUrl: archiveUrl(pkg.repository.url, revision.commit),
    },
    upstreams: upstreamNames.map(name => {
      const item = lock[name];
      if (!item?.url || !item.mirror || !item.commit || !item.license) throw new Error(`upstreams.lock.json ${name} needs url, mirror, license and commit`);
      return {
        name, title: upstreamTitles[name], license: item.license, commit: item.commit, ...(item.version ? { version: item.version } : {}),
        url: treeUrl(item.url, item.commit), mirrorUrl: treeUrl(item.mirror, item.commit),
      };
    }),
  };
  await writeFile(join(legal, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (process.argv[1] === import.meta.filename) console.log(await writeReleaseInfo());
