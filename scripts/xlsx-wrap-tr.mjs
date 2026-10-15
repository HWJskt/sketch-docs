// Regenerates the literal-wrapping part of overlays/gridcraft/korean-ui.patch: in GridCraft's
// crates/ui-egui/src, an English string literal passed straight to an egui widget call (label, button,
// checkbox, hover text…) is wrapped in crate::i18n::t(…), so it goes through the translation table like
// the labels that already call tr(). Literals already inside tr(…)/t(…) or format!(…) stay as they are.
// Usage: node scripts/xlsx-wrap-tr.mjs <checkout>/crates/ui-egui/src   (prints counts; edits in place)
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CALLS = ['label', 'button', 'small_button', 'heading', 'small', 'strong', 'weak', 'selectable_label', 'selectable_value',
  'radio_value', 'radio', 'checkbox', 'on_hover_text', 'on_disabled_hover_text', 'on_hover_text_at_pointer', 'hint_text', 'collapsing',
  'menu_button', 'hyperlink_to', 'from_label', 'RichText::new', 'Button::new', 'Label::new', 'Checkbox::new', 'SelectableLabel::new'];
const SKIP_FILES = new Set(['i18n.rs', 'control.rs']);
const call = new RegExp(`(?:\\.|\\b)(${CALLS.map(name => name.replace(/[:]/g, '\\:')).join('|')})\\(`, 'g');
const literal = /"(?:[^"\\]|\\.)*"/g;

/** The argument text of the call whose `(` is at `open`, on this line only; undefined when it continues on the next line. */
function argumentsEnd(line, open) {
  let depth = 0, inString = false;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return undefined;
}

export function wrapLine(line) {
  const spans = [];
  for (const match of line.matchAll(call)) {
    const open = match.index + match[0].length - 1, close = argumentsEnd(line, open);
    if (close !== undefined) spans.push([open, close]);
  }
  if (!spans.length) return { line, wrapped: 0 };
  let wrapped = 0, out = '', last = 0;
  for (const m of line.matchAll(literal)) {
    const at = m.index, text = m[0];
    if (!spans.some(([a, b]) => at > a && at < b)) continue;
    if (!/[A-Za-z]{2}/.test(text) || text.includes('{') || /^"(?:https?:|mailto:)/.test(text)) continue;
    // A lowercase identifier ("name", "cellColor") is a value (selectable_value/radio_value), not a label.
    if (/^"[a-z][A-Za-z]*"$/.test(text)) continue;
    const before = line.slice(0, at);
    if (/(?:\btr|\bt|format!|concat!|write!|Id::new|id_salt|from_id_salt|id_source)\(\s*$/.test(before)) continue;
    // Inside a format!/tr(…) that opens earlier in the same argument list.
    const opened = before.lastIndexOf('format!(');
    if (opened !== -1 && argumentsEnd(line, opened + 7) > at) continue;
    out += line.slice(last, at) + `crate::i18n::t(${text})`;
    last = at + text.length;
    wrapped++;
  }
  return { line: out + line.slice(last), wrapped };
}

if (process.argv[1] === import.meta.filename) {
  const dir = process.argv[2];
  let total = 0;
  for (const name of (await readdir(dir)).filter(name => name.endsWith('.rs') && !SKIP_FILES.has(name)).sort()) {
    const path = join(dir, name);
    const lines = (await readFile(path, 'utf8')).split('\n');
    let count = 0, inTests = false;
    const result = lines.map(line => {
      if (/^#\[cfg\(test\)\]/.test(line)) inTests = true;
      if (inTests) return line;
      const { line: next, wrapped } = wrapLine(line);
      count += wrapped;
      return next;
    });
    if (count) { await writeFile(path, result.join('\n')); console.log(`${name}: ${count}`); total += count; }
  }
  console.log(`wrapped ${total} literals`);
}
