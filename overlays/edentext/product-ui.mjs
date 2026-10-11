import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Apply only to the generated copy. Every replacement is an upstream contract.
export async function customizeWord(word, exact) {
  function replaceOne(text, pattern, replacement) {
    const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error(`Word UI contract changed: ${pattern.source}`);
    return exact(text, matches[0][0], replacement);
  }
  function readOnlyName(text, modern) {
    text = exact(text, '  let docNameSizerWidth = $state(0);', '');
    text = replaceOne(text, /<span class="doc-name-sizer"[^>]*>[^\n]*<\/span>\s*<input\s+class="doc-name-input"[\s\S]*?\/>/, '<span class="doc-name-label" title={documentName || namePlaceholder} aria-label={t().app.documentName}>{documentName || namePlaceholder}</span>');
    text = replaceOne(text, /  \.doc-name-sizer \{[^}]*\}/, '');
    text = replaceOne(text, /  \.doc-name-input \{[^}]*\}/, `  .doc-name-label {
    min-width: 0;
    max-width: ${modern ? '15rem' : '16rem'};
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font: inherit;
    color: inherit;
  }`);
    text = replaceOne(text, /  \.doc-name-input:focus \{[^}]*\}/, '');
    if (modern) {
      text = replaceOne(text, /  \.doc-name-input::placeholder \{[^}]*\}/, '');
      text = replaceOne(text, /<svg class="doc-name-pencil"[\s\S]*?<\/svg>/, '');
      text = replaceOne(text, /  \.doc-name-pencil \{[^}]*\}/, '');
      text = replaceOne(text, /  \.doc-name:hover \.doc-name-pencil,\s*\.doc-name:focus-within \.doc-name-pencil \{[^}]*\}/, '');
      text = replaceOne(text, /  \.doc-name:not\(\.has-value\) \.doc-name-ext \{[^}]*\}/, '');
    } else {
      text = replaceOne(text, /  \.doc-name-input:hover \{[^}]*\}/, '');
    }
    return text;
  }
  const ribbonPath = join(word, 'src/lib/components/ribbon/Ribbon.svelte');
  let ribbon = readOnlyName(await readFile(ribbonPath, 'utf8'), false);
  ribbon = exact(ribbon, '</style>', `
  :global(.sketch-hosted .ribbon-tabs > .rb-logo-btn),
  :global(.sketch-hosted .ribbon-tabs > .lang-wrap),
  :global(.sketch-hosted .ribbon-tabs > .appearance-wrap) { display: none; }
</style>`);
  await writeFile(ribbonPath, ribbon);

  const appPath = join(word, 'src/App.svelte');
  let app = readOnlyName(await readFile(appPath, 'utf8'), true);
  // Rename only after successful file output and before computing the saved baseline.
  // A cancelled picker or failed write never reaches these assignments.
  for (const [call, after] of [
    ['fileHandle = await saveDocument(await buildBytes(documentFormat, json), name, documentFormat, fileHandle, docPassword);', ''],
    ['fileHandle = await saveDocument(await buildBytes(kind, json), name, kind, null, docPassword);', '\n      documentFormat = kind;'],
  ]) {
    const sequence = `${call}${after}
      recentFiles = await rememberRecentFile(fileHandle?.name ?? name, fileHandle);
      await bindFile();
      documentHasFile = true;
      markSaved();`;
    app = exact(app, sequence, sequence.replace('      markSaved();', "      documentName = (fileHandle?.name ?? name).replace(/\\.(docx|odt)$/i, '');\n      markSaved();"));
  }
  await writeFile(appPath, app);
}
