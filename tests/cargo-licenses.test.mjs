import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargoNotices, shippedPackages } from '../scripts/cargo-licenses.mjs';

// app → lib (normal) → shared; app → derive (proc-macro); app → helper (build only); lib → shared.
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'cargo-licenses-test-'));
  const pkg = async (name, files = {}, extra = {}) => {
    const dir = join(base, name);
    await mkdir(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) { await mkdir(join(dir, file, '..'), { recursive: true }); await writeFile(join(dir, file), text); }
    return { id: name + '-id', name, version: '1.0.0', license: 'MIT', repository: `https://example.invalid/${name}`, authors: ['A'], manifest_path: join(dir, 'Cargo.toml'), targets: [{ kind: ['lib'] }], source: 'registry+https://github.com/rust-lang/crates.io-index', ...extra };
  };
  const packages = [
    await pkg('app', {}, { source: null }),
    await pkg('lib', { 'LICENSE-MIT': 'MIT text', 'LICENSE-APACHE': 'Apache text' }),
    await pkg('shared', { 'LICENSE': 'MIT text', 'fonts/OFL.txt': 'font licence' }),
    await pkg('derive', {}, { targets: [{ kind: ['proc-macro'] }] }),
    await pkg('helper', {}),
  ];
  const dep = (to, kind = null) => ({ pkg: to + '-id', dep_kinds: [{ kind }] });
  const metadata = { packages, resolve: { nodes: [
    { id: 'app-id', deps: [dep('lib'), dep('derive'), dep('helper', 'build')] },
    { id: 'lib-id', deps: [dep('shared')] }, { id: 'shared-id', deps: [] }, { id: 'derive-id', deps: [] }, { id: 'helper-id', deps: [] },
  ] } };
  return { base, metadata };
}
const covered = pkg => pkg.source === null ? 'Upstream' : undefined;

test('only normal, non-proc-macro dependencies ship in the WASM', async () => {
  const { base, metadata } = await fixture();
  try {
    assert.deepEqual(shippedPackages(metadata, 'app').map(pkg => pkg.name), ['app', 'lib', 'shared']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('notices carry each license file once, extra files by exact version, and workspace coverage', async () => {
  const { base, metadata } = await fixture();
  try {
    const text = await cargoNotices(shippedPackages(metadata, 'app'), { covered, exceptions: {}, extra: { 'shared@1.0.0': ['fonts/OFL.txt'] } });
    assert.match(text, /===== app@1\.0\.0 =====[\s\S]*Covered by the Upstream license files/);
    assert.equal(text.split('MIT text').length - 1, 1, 'identical texts are written once');
    assert.match(text, /--- LICENSE: same text as lib@1\.0\.0 LICENSE-MIT/);
    assert.ok(text.includes('Apache text') && text.includes('font licence'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a shipped crate without a license file must be listed exactly, and stale entries fail', async () => {
  const { base, metadata } = await fixture();
  try {
    const shipped = shippedPackages(metadata, 'app');
    const bare = shipped.map(pkg => pkg.name === 'lib' ? { ...pkg, manifest_path: join(base, 'derive/Cargo.toml') } : pkg);
    await assert.rejects(cargoNotices(bare, { covered, exceptions: {} }), /lib@1\.0\.0 ships in the WASM but has no license file/);
    assert.match(await cargoNotices(bare, { covered, exceptions: { 'lib@1.0.0': 'checked' } }), /no license file\. \(checked\)/);
    await assert.rejects(cargoNotices(shipped, { covered, exceptions: { 'lib@1.0.0': 'checked' } }), /listed in cargoLicenseFileExceptions but has license files/);
    await assert.rejects(cargoNotices(shipped, { covered, exceptions: { 'gone@2.0.0': 'old' } }), /not shipped: gone@2\.0\.0/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
