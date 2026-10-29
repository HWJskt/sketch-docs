import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, degrees } from '@cantoo/pdf-lib';
import { exportPdf, importAnnotations } from 'svelte-pdf-mini/pdf-codec';
import * as pages from '../src/pdf/pages.ts';
const fixture = async name => new Uint8Array(await readFile(new URL(`./fixtures/pdf/${name}`, import.meta.url)));
const items = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, source: 'original', index }));

test('multi move uses a boundary in the original list and keeps document order', () => {
    assert.deepEqual(pages.movePages(items, ['c', 'a'], 4).map(p => p.id), ['b', 'd', 'a', 'c']);
    assert.deepEqual(pages.movePages(items, ['b', 'c'], 2).map(p => p.id), ['a', 'b', 'c', 'd']);
});
test('delete refuses the last page and remaps or deletes its annotations', () => {
    assert.throws(() => pages.deletePages(items, items.map(p => p.id)), /마지막|한 쪽/);
    const next = pages.deletePages(items, ['b']);
    assert.deepEqual(pages.remapAnnotations([{ id: 'one', page: 2 }, { id: 'two', page: 4 }], items, next), [{ id: 'two', page: 3 }]);
});
test('selection ranges are stable from the anchor; modifiers toggle individual pages', () => {
    assert.deepEqual(pages.selectPages(items, ['b'], 'b', 'd', { shift: true }), ['b', 'c', 'd']);
    assert.deepEqual(pages.selectPages(items, ['a', 'c'], 'a', 'c', { toggle: true }), ['a']);
});
test('clean PDFs have no loss warning; actual catalog features are named', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    assert.deepEqual(await pages.inspectLosses(await doc.save()), []);
    const losses = await pages.inspectLosses(await fixture('a-basic.pdf'));
    assert.ok(losses.some(x => x.includes('목차')));
    assert.ok(losses.some(x => x.includes('양식')));
    assert.ok((await pages.inspectLosses(await fixture('f-page-attributes.pdf'))).some(x => x.includes('페이지 번호')));
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({ Type: 'StructTreeRoot' }));
    assert.ok((await pages.inspectLosses(await doc.save())).some(x => x.includes('구조 태그')));
});
test('reconstruction keeps page content order and removes original editable annotations', async () => {
    const original = await pages.prepareSource('original', await fixture('a-basic.pdf'), false);
    const order = [2, 0].map(index => ({ id: `p${index}`, source: 'original', index }));
    const out = await PDFDocument.load(await pages.assemblePages([original], order));
    assert.equal(out.getPageCount(), 2);
    assert.deepEqual(out.getPages().map(p => p.getSize()), [{ width: 612, height: 792 }, { width: 612, height: 792 }]);
    const annotations = await importAnnotations(await out.save(), { foreign: true });
    assert.ok(annotations.annotations.some(a => a.page === 2 && a.origin === 'foreign'));
});
test('inserted owned notes become foreign with Popup, original owned notes are not baked into page content', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const note = { id: 'same-id', kind: 'note', page: 1, rect: [20, 20, 40, 40], color: [1, 0, 0], opacity: 1, contents: 'kept', origin: 'local' };
    const bytes = await exportPdf(await doc.save(), [note]);
    const original = await pages.prepareSource('original', bytes, false);
    const inserted = await pages.prepareSource('insert', bytes, true);
    const output = await pages.assemblePages([original, inserted], [{ id: 'a', source: 'original', index: 0 }, { id: 'b', source: 'insert', index: 0 }]);
    const read = await importAnnotations(output, { foreign: true });
    assert.equal(read.annotations.length, 1); assert.equal(read.annotations[0].page, 2); assert.equal(read.annotations[0].origin, 'foreign'); assert.equal(read.annotations[0].contents, 'kept');
    const saved = await PDFDocument.load(output);
    const annots = saved.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
    assert.equal(annots.size(), 2);
    for (const ref of annots.asArray()) assert.equal(saved.context.lookup(ref, PDFDict).get(PDFName.of('P')).toString(), saved.getPage(1).ref.toString());
});
test('blank page copies the adjacent nonzero MediaBox and rotation at the front and end', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage([400, 700]); page.setMediaBox(10, 20, 400, 700); page.setRotation(degrees(90));
    const source = await pages.prepareSource('original', await doc.save(), false);
    const item = { id: 'a', source: 'original', index: 0 };
    const blank = await pages.blankPage([source], item, 'blank');
    for (const order of [[blank, item], [item, blank]]) {
        const saved = await PDFDocument.load(await pages.assemblePages([source], order));
        for (const p of saved.getPages()) { assert.deepEqual(p.getMediaBox(), { x: 10, y: 20, width: 400, height: 700 }); assert.equal(p.getRotation().angle, 90); }
    }
});
for (const name of ['c1-signed.pdf', 'd-encrypted.pdf']) test(`insertion refuses ${name}`, async () => {
    await assert.rejects(pages.prepareSource('insert', await fixture(name), true), /서명|암호/);
});
test('reconstructed page base passes the existing annotation preservation gate after export', async () => {
    const { checkPreservation } = await import('../src/pdf/preserve.ts');
    const source = await pages.prepareSource('original', await fixture('a-basic.pdf'), false);
    const original = { id: 'p', source: 'original', index: 0 };
    const blank = await pages.blankPage([source], original, 'blank');
    const bytes = await pages.assemblePages([source], [blank, original]);
    const snapshot = [{ id: 'new', kind: 'rect', page: 1, rect: [20, 20, 40, 40], color: [1, 0, 0], opacity: 1, width: 1, origin: 'local' }];
    const result = await checkPreservation(bytes, await exportPdf(bytes.slice(), snapshot), snapshot);
    assert.deepEqual(result, { ok: true });
});
test('direct GoTo actions and associated files outside the name tree still trigger actual-loss warnings', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage();
    page.node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 20, 20], A: { S: 'GoTo', D: [page.ref, 'Fit'] } }]));
    doc.catalog.set(PDFName.of('AF'), doc.context.obj([{ Type: 'Filespec', F: PDFName.of('report') }]));
    const losses = await pages.inspectLosses(await doc.save());
    assert.ok(losses.some(x => x.includes('링크')));
    assert.ok(losses.some(x => x.includes('첨부')));
});
test('attachments in a branched EmbeddedFiles name tree are reported before reconstruction', async () => {
    const doc = await PDFDocument.create(); doc.addPage(); await doc.attach(new Uint8Array([1, 2, 3]), 'keep.txt');
    const saved = await PDFDocument.load(await doc.save());
    saved.catalog.delete(PDFName.of('AF'));
    const names = saved.catalog.lookup(PDFName.of('Names'), PDFDict);
    const files = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    names.set(PDFName.of('EmbeddedFiles'), saved.context.obj({ Kids: [saved.context.register(files)] }));
    assert.ok((await pages.inspectLosses(await saved.save())).some(x => x.includes('첨부')));
});
