import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { exportPdf, importAnnotations, EMBEDDED_FILE_NAME, PRIVATE_KEY } from 'svelte-pdf-mini/pdf-codec';

const note = { id: 'probe-note', kind: 'note', page: 2, rect: [20, 30, 40, 50], color: [1, 0.8, 0.2], opacity: 1, contents: 'page two', origin: 'local', createdAt: '2026-10-29T00:00:00Z', modifiedAt: '2026-10-29T00:00:00Z' };
test('copyPages carries standard annotations and Popup but not the catalog model attachment', async () => {
    const original = await PDFDocument.create(); original.addPage(); original.addPage();
    const annotated = await exportPdf(await original.save(), [note]);
    const source = await PDFDocument.load(annotated);
    assert.ok(source.getAttachments().some(a => a.name === EMBEDDED_FILE_NAME));
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, [1, 0])) out.addPage(page);
    const bytes = await out.save();
    const read = await PDFDocument.load(bytes);
    assert.equal(read.getAttachments().length, 0);
    const list = read.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const dicts = list.asArray().map(ref => read.context.lookup(ref, PDFDict));
    assert.deepEqual(dicts.map(d => d.get(PDFName.of('Subtype')).toString()).sort(), ['/Popup', '/Text']);
    const imported = await importAnnotations(bytes, { foreign: true });
    console.log('copy import:', imported.annotations.map(a => ({ id: a.id, page: a.page, origin: a.origin })));
    assert.equal(imported.annotations.length, 1);
    // The importer remaps private JSON to the actual containing page.
    assert.equal(imported.annotations[0].page, 1);
    for (const dict of dicts) dict.delete(PDFName.of(PRIVATE_KEY));
    const foreign = await importAnnotations(await read.save(), { foreign: true });
    assert.equal(foreign.annotations[0].page, 1);
    assert.equal(foreign.annotations[0].origin, 'foreign');
});
