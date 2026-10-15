import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

// License notices for the Rust crates compiled into a WASM build: the packages `rootName` reaches
// through normal dependencies for the target (`cargo metadata --filter-platform`). Build scripts,
// build dependencies and proc-macros run on the build machine and are not in the WASM.

/** Crates.io packages, by exact version, published without a license file (checked 2026-10-15).
 *  Their notice states the Cargo.toml license, authors and repository. A new version is checked again. */
export const cargoLicenseFileExceptions = {
  'accesskit@0.24.1': 'egui accessibility dependency; the crate has no license file',
  'ecolor@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'eframe@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'egui@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'egui-wgpu@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'egui_glow@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'emath@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'epaint@0.36.2': 'egui crate; the license files are in the egui repository root only',
  'profiling@1.0.18': 'the crate has no license file',
  'spirv@0.4.0+sdk-1.4.341.0': 'the crate has no license file',
};
/** Licenses kept outside the crate root, by exact version. */
export const cargoExtraLicenseFiles = {
  // The bundled UI fonts: Hack, Noto Emoji and Ubuntu Light (OFL / UFL) and the emoji icon font (MIT).
  'epaint_default_fonts@0.36.2': ['fonts/OFL.txt', 'fonts/UFL.txt', 'fonts/Hack-Regular.txt', 'fonts/emoji-icon-font-mit-license.txt'],
};
// COPYRIGHT files carry the notices some crates keep apart from their license texts (euclid, unicode-width…).
const licenseName = /^(?:licen[cs]e|copying|notice|copyright)(?:[.-].*)?$/i;

export function shippedPackages(metadata, rootName) {
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const root = metadata.packages.find(pkg => pkg.name === rootName);
  if (!root) throw new Error(`cargo metadata has no package ${rootName}`);
  const found = new Set(), stack = [root.id];
  while (stack.length) {
    const id = stack.pop();
    if (found.has(id)) continue;
    found.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (!dep.dep_kinds.some(kind => kind.kind === null)) continue;
      if (packages.get(dep.pkg).targets.some(target => target.kind.includes('proc-macro'))) continue;
      stack.push(dep.pkg);
    }
  }
  return [...found].map(id => packages.get(id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * One section per shipped package. `covered(pkg)` names the upstream whose root license files ship
 * separately (its workspace crates carry none of their own). Identical texts are written once.
 */
export async function cargoNotices(packages, { covered = () => undefined, exceptions = cargoLicenseFileExceptions, extra = cargoExtraLicenseFiles } = {}) {
  const sections = [], texts = new Map(), unused = new Set(Object.keys(exceptions));
  for (const pkg of packages) {
    const id = `${pkg.name}@${pkg.version}`, dir = dirname(pkg.manifest_path);
    const head = `===== ${id} =====\nLicense (Cargo.toml): ${pkg.license ?? pkg.license_file ?? '(none)'}\nRepository: ${pkg.repository ?? '(none)'}\nAuthors: ${pkg.authors?.join(', ') || '(none)'}\n`;
    const owner = covered(pkg);
    if (owner) { sections.push(head + `Covered by the ${owner} license files listed above.\n`); continue; }
    const files = [...(await readdir(dir)).filter(name => licenseName.test(name)).sort(), ...(extra[id] ?? [])];
    if (pkg.license_file && !files.includes(pkg.license_file)) files.push(pkg.license_file);
    if (!files.length) {
      if (!exceptions[id]) throw new Error(`${id} ships in the WASM but has no license file in ${dir}; check it and list it in cargoLicenseFileExceptions`);
      unused.delete(id);
      sections.push(head + `The published crate contains no license file. (${exceptions[id]})\n`);
      continue;
    }
    if (exceptions[id]) throw new Error(`${id} is listed in cargoLicenseFileExceptions but has license files; remove it`);
    let body = head;
    for (const file of files) {
      const text = await readFile(join(dir, file), 'utf8');
      const key = createHash('sha256').update(text).digest('hex');
      if (texts.has(key)) body += `\n--- ${file}: same text as ${texts.get(key)}\n`;
      else { texts.set(key, `${id} ${file}`); body += `\n--- ${file}\n\n${text.trimEnd()}\n`; }
    }
    sections.push(body);
  }
  if (unused.size) throw new Error('cargoLicenseFileExceptions lists packages that are not shipped: ' + [...unused].join(', '));
  return sections.join('\n');
}
