// PDFs this editor opens and annotates but never saves (docs/plans/2026-10-13-pdf-viewer.md, "거절하는 문서"):
// encrypted ones, and signed ones (a signature value in a signature field, or document permissions /Perms),
// because an added annotation can invalidate the signature. Empty signature fields are fine.
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject, PDFRef } from '@cantoo/pdf-lib';
import { saveSupport } from 'svelte-pdf-mini/pdf-codec';

export const ENCRYPTED = '암호로 보호된 PDF는 저장하지 않습니다. 다른 이름으로도 저장할 수 없습니다.';
export const SIGNED = '서명된 PDF는 저장하지 않습니다. 주석을 더하면 서명이 무효가 될 수 있습니다.';
const name = (key: string) => PDFName.of(key);

/** Why this PDF must not be saved, or null. */
export async function saveBlockReason(bytes: Uint8Array): Promise<string | null> {
    if ((await saveSupport(bytes.slice())).encrypted) return ENCRYPTED;
    let doc: PDFDocument;
    try { doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false }); }
    catch (error) { return `PDF 구조를 읽지 못해 저장하지 않습니다: ${error instanceof Error ? error.message : String(error)}`; }
    if (doc.catalog.get(name('Perms')) !== undefined) return SIGNED;
    const resolve = (value: PDFObject | undefined) => value instanceof PDFRef ? doc.context.lookup(value) : value;
    const form = resolve(doc.catalog.get(name('AcroForm')));
    if (!(form instanceof PDFDict)) return null;
    // Fields form a tree through /Kids; the field type is inherited from the parent.
    const seen = new Set<string>();
    const signed = (value: PDFObject | undefined, inheritedType: PDFObject | undefined): boolean => {
        const key = value instanceof PDFRef ? value.toString() : '';
        if (key && seen.has(key)) return false;
        if (key) seen.add(key);
        const field = resolve(value);
        if (!(field instanceof PDFDict)) return false;
        const type = field.get(name('FT')) ?? inheritedType;
        if (type === name('Sig') && field.get(name('V')) !== undefined) return true;
        const kids = resolve(field.get(name('Kids')));
        return kids instanceof PDFArray && kids.asArray().some(kid => signed(kid, type));
    };
    const fields = resolve(form.get(name('Fields')));
    return fields instanceof PDFArray && fields.asArray().some(field => signed(field, undefined)) ? SIGNED : null;
}
