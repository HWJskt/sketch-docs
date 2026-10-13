// src/pdf/preserve.ts against real exports of the fixtures, and against those exports damaged on purpose,
// both rewritten and as an incremental update appended to an intact file (the damage then sits after bytes
// that still match the original).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { exportPdf } from 'svelte-pdf-mini/pdf-codec';
import { checkPreservation } from '../src/pdf/preserve.ts';

const fixture = async name => new Uint8Array(await readFile(join(import.meta.dirname, 'fixtures/pdf', name)));
const at = '2026-10-13T00:00:00.000Z';
const base = (id, kind, rect, extra = {}) => ({ id, kind, page: 1, rect, color: [1, 0.8, 0.2], opacity: 1, createdAt: at, modifiedAt: at, origin: 'local', ...extra });
const quad = ([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1];
const SNAPSHOT = [
    base('t-highlight', 'highlight', [72, 712, 300, 740], { quads: [quad([72, 712, 300, 740])] }),
    base('t-note', 'note', [400, 500, 420, 520], { contents: '메모' }),
    base('t-ink', 'ink', [100, 300, 200, 400], { paths: [{ points: [[100, 300], [150, 360], [200, 400]] }], width: 2 }),
    base('t-rect', 'rect', [300, 300, 400, 380], { width: 2 }),
];
const MODES = ['full', 'incremental'];

/** The export, then `damage` applied as a rewrite or as an appended incremental update. */
async function damaged(output, mode, damage) {
    const doc = await PDFDocument.load(output.slice(), { updateMetadata: false, forIncrementalUpdate: mode === 'incremental' });
    damage(doc, doc.getPage(0).node);
    return mode === 'incremental' ? doc.commit() : doc.save();
}
const annots = (doc, page) => page.lookup(PDFName.of('Annots'), PDFArray);
const find = (doc, page, test) => annots(doc, page).asArray().map(ref => doc.context.lookup(ref)).find(test);

for (const name of ['a-basic.pdf', 'e-image.pdf', 'f-page-attributes.pdf', 'c2-empty-signature.pdf']) {
    for (const mode of MODES) {
        test(`${name}: an unchanged ${mode} export keeps everything`, async () => {
            const original = await fixture(name);
            const output = await exportPdf(original.slice(), SNAPSHOT, { mode });
            assert.deepEqual(await checkPreservation(original, output, SNAPSHOT), { ok: true });
        });
    }
}

test('saving again replaces our own annotations and keeps the rest', async () => {
    const original = await fixture('a-basic.pdf');
    const first = await exportPdf(original.slice(), SNAPSHOT);
    const next = [...SNAPSHOT.slice(1), base('t-second', 'rect', [50, 50, 90, 90], { width: 1 })];
    const second = await exportPdf(first.slice(), next);
    assert.deepEqual(await checkPreservation(first, second, next), { ok: true });
});

const DAMAGE = [
    ['e-image.pdf', 'the image is removed', (doc, page) => page.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).delete(PDFName.of('Im1')), /XObject|키가 바뀌었습니다/],
    ['e-image.pdf', 'the page content is emptied', (doc, page) => page.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(''))), /쪽 내용이 바뀌었습니다/],
    ['a-basic.pdf', 'the page is rotated', (doc, page) => page.set(PDFName.of('Rotate'), PDFNumber.of(90)), /Rotate/],
    ['f-page-attributes.pdf', 'UserUnit is dropped', (doc, page) => page.delete(PDFName.of('UserUnit')), /UserUnit/],
    ['f-page-attributes.pdf', 'the transparency group is dropped', (doc, page) => page.delete(PDFName.of('Group')), /Group/],
    ['f-page-attributes.pdf', 'a value changes type (a name becomes a number)', (doc, page) => page.lookup(PDFName.of('Group'), PDFDict).set(PDFName.of('S'), PDFNumber.of(1)), /비교할 수 없는 객체/],
    ['f-page-attributes.pdf', 'page labels are dropped', doc => doc.catalog.delete(PDFName.of('PageLabels')), /PageLabels/],
    ['f-page-attributes.pdf', 'an unknown catalog key changes', doc => doc.catalog.set(PDFName.of('XSketchTest'), PDFString.of('changed')), /XSketchTest/],
    ['a-basic.pdf', 'a form value changes', (doc, page) => find(doc, page, dict => dict.get(PDFName.of('FT')) === PDFName.of('Tx')).set(PDFName.of('V'), PDFString.of('other')), /V: 문자열이 바뀌었습니다/],
    ['a-basic.pdf', 'an existing appearance changes', (doc, page) => find(doc, page, dict => dict.get(PDFName.of('FT')) === PDFName.of('Tx')).lookup(PDFName.of('AP'), PDFDict).set(PDFName.of('N'), doc.context.register(doc.context.stream('q 1 0 0 rg 0 0 200 24 re f Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 24] }))), /AP/],
    ['a-basic.pdf', 'an existing annotation is removed', (doc, page) => { const list = annots(doc, page); list.remove(list.asArray().findIndex(ref => doc.context.lookup(ref).get(PDFName.of('NM'))?.decodeText?.() === 'fixture-existing-note')); }, /기존 주석 수가 바뀌었습니다/],
    ['a-basic.pdf', 'an annotation that was not in the snapshot is added', (doc, page) => annots(doc, page).push(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 20, 20] }))), /기존 주석 수가 바뀌었습니다/],
    ['a-basic.pdf', 'one of our annotations is lost', (doc, page) => { const list = annots(doc, page); list.remove(list.asArray().findIndex(ref => { const nm = doc.context.lookup(ref).get(PDFName.of('NM')); return (nm instanceof PDFString || nm instanceof PDFHexString) && nm.decodeText() === 't-rect'; })); }, /저장한 주석이 저장하려던 주석과 다릅니다/],
    ['a-basic.pdf', 'the outline title changes', doc => doc.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict).set(PDFName.of('Title'), PDFString.of('Changed')), /Title/],
];
for (const [name, what, damage, reason] of DAMAGE) {
    for (const mode of MODES) {
        test(`${name}: refused when ${what} (${mode})`, async () => {
            const original = await fixture(name);
            const output = await damaged(await exportPdf(original.slice(), SNAPSHOT), mode, damage);
            const verdict = await checkPreservation(original, output, SNAPSHOT);
            assert.equal(verdict.ok, false, `${what} must be refused`);
            assert.match(verdict.reason, reason);
        });
    }
}

test('an output that cannot be read back is refused', async () => {
    const original = await fixture('a-basic.pdf');
    const output = await exportPdf(original.slice(), SNAPSHOT);
    const verdict = await checkPreservation(original, output.slice(0, 200), SNAPSHOT);
    assert.equal(verdict.ok, false);
});

test('the annotation snapshot must match exactly', async () => {
    const original = await fixture('a-basic.pdf');
    const output = await exportPdf(original.slice(), SNAPSHOT);
    const verdict = await checkPreservation(original, output, SNAPSHOT.slice(1));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /저장하려던 주석과 다릅니다/);
});

