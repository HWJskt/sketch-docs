import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { ENCRYPTED, SIGNED, saveBlockReason } from '../src/pdf/protection.ts';

const fixture = async name => new Uint8Array(await readFile(join(import.meta.dirname, 'fixtures/pdf', name)));

test('a signature with a value blocks saving; an empty signature field does not', async () => {
    assert.equal(await saveBlockReason(await fixture('c1-signed.pdf')), SIGNED);
    assert.equal(await saveBlockReason(await fixture('c2-empty-signature.pdf')), null);
});

test('an encrypted PDF blocks saving', async () => {
    assert.equal(await saveBlockReason(await fixture('d-encrypted.pdf')), ENCRYPTED);
});

test('ordinary PDFs can be saved', async () => {
    for (const name of ['a-basic.pdf', 'b-korean-cid.pdf', 'e-image.pdf', 'f-page-attributes.pdf']) assert.equal(await saveBlockReason(await fixture(name)), null, name);
});

test('document permissions (/Perms) block saving', async () => {
    const doc = await PDFDocument.load(await fixture('a-basic.pdf'));
    doc.catalog.set(PDFName.of('Perms'), doc.context.obj({ DocMDP: doc.context.obj({}) }));
    assert.equal(await saveBlockReason(await doc.save()), SIGNED);
});

test('a signature value on a child field (type inherited from the parent) blocks saving', async () => {
    const doc = await PDFDocument.load(await fixture('c2-empty-signature.pdf'));
    const form = doc.catalog.lookup(PDFName.of('AcroForm'));
    const kid = doc.context.register(doc.context.obj({ T: 'Child', V: doc.context.obj({ Type: 'Sig' }) }));
    const parent = doc.context.register(doc.context.obj({ FT: 'Sig', T: 'Parent', Kids: [kid] }));
    form.set(PDFName.of('Fields'), doc.context.obj([parent]));
    assert.equal(await saveBlockReason(await doc.save()), SIGNED);
});
