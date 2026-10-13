import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sourceRevision } from './revision.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const repositoryUrl = url => url.replace(/\.git$/, '');
const treeUrl = (url, commit) => `${repositoryUrl(url)}/tree/${commit}`;
const archiveUrl = (url, commit) => `${repositoryUrl(url)}/archive/${commit}.tar.gz`;
export const upstreamNames = ['edentext', 'hop', 'rhwp'];
export const upstreamTitles = { edentext: 'EdenText', hop: 'HOP', rhwp: 'rhwp' };
export const npmPackages = ['canvaskit-wasm', '@noble/hashes', 'fflate', 'svelte'];

/** The license file a package ships (LICENSE, LICENSE.md, LICENCE, COPYING…), by file name rather than package.json. */
export async function npmLicenseFile(root, name) {
  const dir = join(root, 'node_modules', name);
  const file = (await readdir(dir)).filter(entry => /^(?:licen[cs]e|copying)(?:[.-].*)?$/i.test(entry)).sort()[0];
  if (!file) throw new Error(`${name} has no license file in ${dir}`);
  return join(dir, file);
}

// The corresponding source is published on GitHub, not in the deployment:
// our code at the built commit, and each upstream at its pinned commit (original and backup fork).
export async function writeReleaseInfo({ root = projectRoot, output = join(root, 'public'), lock } = {}) {
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
    ...await Promise.all(npmPackages.map(async name => [`LICENSE-${name.replaceAll('/', '-')}`, await npmLicenseFile(root, name)])),
  ];
  const sections = ['Sketch Docs — 라이선스 및 타사 고지\n\n제품: AGPL-3.0-only. EdenText: AGPL-3.0-only. HOP/rhwp: MIT.\n대응 소스는 release.json의 GitHub 링크(우리 코드의 빌드 커밋과 각 원본의 고정 커밋)에서 받을 수 있습니다. 이 목록은 법률 검토 인증이 아닙니다.'];
  for (const [name, from] of notices) {
    const bytes = await readFile(from);
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
