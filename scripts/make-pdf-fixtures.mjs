// Writes the PDF fixtures in tests/fixtures/pdf/ without dependencies, byte for byte the same on
// every run (fixed IDs and dates, IVs derived from object numbers). `--check` compares instead of writing.
// docs/plans/2026-10-13-pdf-viewer.md lists what each fixture is for.
import { createCipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const FIXTURE_DIR = join(root, 'tests/fixtures/pdf');
export const USER_PASSWORD = 'test';

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest();
const bytes = text => Buffer.from(text, 'latin1');
const hex = buffer => `<${Buffer.from(buffer).toString('hex').toUpperCase()}>`;
const FILE_ID = name => md5(`sketch-docs fixture ${name}`);

/** An indirect object: a dictionary/array/etc. as PDF source text, or a stream. */
const stream = (dict, data) => ({ dict, data: typeof data === 'string' ? bytes(data) : Buffer.from(data) });

/** Serializes objects numbered from 1; `encrypt(number, data)` encrypts stream data when given. */
function pdf(name, objects, { root = 1, info, encrypt, encryptRef } = {}) {
    const id = FILE_ID(name);
    const parts = [bytes('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
    let length = parts[0].length;
    const offsets = [];
    objects.forEach((object, index) => {
        const number = index + 1;
        offsets.push(length);
        let body;
        if (typeof object === 'string') body = bytes(object);
        else {
            const data = encrypt && number !== encryptRef ? encrypt(number, object.data) : object.data;
            body = Buffer.concat([bytes(`<< /Length ${data.length}${object.dict ? ` ${object.dict}` : ''} >>\nstream\n`), data, bytes('\nendstream')]);
        }
        const chunk = Buffer.concat([bytes(`${number} 0 obj\n`), body, bytes('\nendobj\n')]);
        parts.push(chunk);
        length += chunk.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''}${encryptRef ? ` /Encrypt ${encryptRef} 0 R` : ''} /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${length}\n%%EOF\n`;
    parts.push(bytes(xref + trailer));
    return Buffer.concat(parts);
}

const helvetica = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const text = (lines, size = 24) => `BT /F1 ${size} Tf ${lines.map(([x, y, line]) => `1 0 0 1 ${x} ${y} Tm (${line}) Tj`).join(' ')} ET`;
const page = (parent, content, extra = '') => `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R${extra} >>`;

/** A: 3 pages, 2-item outline, accented and plain search words, one foreign annotation, one filled form field. */
function fixtureA() {
    // 1 catalog, 2 pages, 3 font, 4-6 pages, 7-9 contents, 10 outlines, 11-12 outline items,
    // 13 foreign note, 14 text field, 15 field appearance, 16 info
    const field = 'q BT /F1 12 Tf 2 6 Td (filled value) Tj ET Q';
    return pdf('a', [
        '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines /AcroForm << /Fields [14 0 R] /DR << /Font << /F1 3 0 R >> >> /DA (/F1 12 Tf 0 g) >> >>',
        '<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R] /Count 3 /Resources << /Font << /F1 3 0 R >> >> >>',
        helvetica,
        page(2, 7, ' /Annots [13 0 R 14 0 R]'),
        page(2, 8),
        page(2, 9),
        stream('', text([[72, 720, 'Page 1: R\xE9sum\xE9 of the fixture'], [72, 680, 'Introduction text']])),
        stream('', text([[72, 720, 'Page 2: the resume chapter'], [72, 680, 'Chapter two text']])),
        stream('', text([[72, 720, 'Page 3: closing page']])),
        '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 2 >>',
        '<< /Title (Introduction) /Parent 10 0 R /Next 12 0 R /Dest [4 0 R /XYZ 0 792 0] >>',
        '<< /Title (Chapter 2) /Parent 10 0 R /Prev 11 0 R /Dest [5 0 R /XYZ 0 792 0] >>',
        '<< /Type /Annot /Subtype /Text /Rect [500 700 520 720] /Contents (Existing note) /NM (fixture-existing-note) /M (D:20260101000000Z) /C [1 0.8 0] /P 4 0 R >>',
        '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (filled value) /DA (/F1 12 Tf 0 g) /Rect [72 600 272 624] /F 4 /P 4 0 R /AP << /N 15 0 R >> >>',
        stream('/Type /XObject /Subtype /Form /BBox [0 0 200 24] /Resources << /Font << /F1 3 0 R >> >>', bytes(field)),
        '<< /Title (Fixture A) /Producer (sketch-docs make-pdf-fixtures) >>',
    ], { info: 16 });
}

/** B: Korean text in a non-embedded CID font; drawing it needs the Adobe-Korea1 cMap UniKS-UCS2-H. */
function fixtureB() {
    // "한글 스케치 PDF" in UCS-2
    const words = Buffer.from('한글 스케치 PDF', 'utf16le').swap16();
    return pdf('b', [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        page(2, 4, ' /Resources << /Font << /F1 5 0 R >> >>'),
        stream('', Buffer.concat([bytes('BT /F1 36 Tf 72 700 Td '), bytes(hex(words)), bytes(' Tj ET')])),
        '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >>',
        '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> /FontDescriptor 7 0 R /DW 1000 >>',
        '<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 /FontBBox [-6 -145 1003 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
    ]);
}

/**
 * C1/C2: a signature field with a signature value (structure only: the bytes are not a valid
 * signature; detection is structural) and an empty one.
 */
function fixtureSignature(name, signed) {
    const objects = [
        `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R]${signed ? ' /SigFlags 3' : ''} >> >>`,
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        page(2, 4, ' /Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R]'),
        stream('', text([[72, 720, signed ? 'Signed document' : 'Document with an empty signature field']])),
        helvetica,
        `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /F 132 /P 3 0 R${signed ? ' /V 7 0 R' : ''} >>`,
    ];
    if (signed) objects.push(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0 0 0] /Contents ${hex(Buffer.alloc(64))} /M (D:20261013000000Z) >>`);
    return pdf(name, objects);
}

// Standard security handler, revision 4 with AES-128 (ISO 32000-1 7.6.3, algorithms 2, 3 and 5).
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const padded = password => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);
function rc4(key, data) {
    const s = [...Array(256).keys()];
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const out = Buffer.alloc(data.length);
    for (let n = 0, i = 0, j = 0; n < data.length; n++) {
        i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
        out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
}
const rc4Rounds = (key, data) => { let out = rc4(key, data); for (let i = 1; i <= 19; i++) out = rc4(key.map(b => b ^ i), out); return out; };

/** D: encrypted with user password `test`, so it does not open without one. */
function fixtureD() {
    const P = -4;
    let ownerKey = md5(padded('sketch-owner'));
    for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
    const O = rc4Rounds(ownerKey, padded(USER_PASSWORD));
    const permissions = Buffer.alloc(4); permissions.writeInt32LE(P);
    let key = md5(padded(USER_PASSWORD), O, permissions, FILE_ID('d'));
    for (let i = 0; i < 50; i++) key = md5(key);
    const U = Buffer.concat([rc4Rounds(key, md5(PAD, FILE_ID('d'))), Buffer.alloc(16)]);
    const encrypt = (number, data) => {
        const objectKey = md5(key, Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0]), 'sAlT');
        const iv = md5(`iv ${number}`);
        const cipher = createCipheriv('aes-128-cbc', objectKey, iv);
        return Buffer.concat([iv, cipher.update(data), cipher.final()]);
    };
    return pdf('d', [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        page(2, 4, ' /Resources << /Font << /F1 5 0 R >> >>'),
        stream('', text([[72, 720, 'Encrypted document'], [72, 680, 'Password protected text']])),
        helvetica,
        `<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF /O ${hex(O)} /U ${hex(U)} /P ${P} >>`,
    ], { encrypt, encryptRef: 6 });
}

/** E: one page that draws an image XObject. */
function fixtureE() {
    const pixels = Buffer.from([230, 40, 40, 40, 160, 60, 40, 80, 220, 240, 200, 40]);
    return pdf('e', [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        page(2, 4, ' /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>'),
        stream('', bytes(`${text([[72, 720, 'Page with an image']])} q 200 0 0 200 72 400 cm /Im1 Do Q`)),
        helvetica,
        stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false', pixels),
    ]);
}

/** F: page and catalog attributes a key-list comparison would miss, and a key no reader knows. */
function fixtureF() {
    return pdf('f', [
        '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r /St 4 >>] >> /XSketchTest (custom catalog value) >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        page(2, 4, ' /Resources << /Font << /F1 5 0 R >> >> /UserUnit 2 /Group << /S /Transparency /CS /DeviceRGB >>'),
        stream('', text([[72, 720, 'Page attributes']])),
        helvetica,
    ]);
}

export const FIXTURES = {
    'a-basic.pdf': fixtureA,
    'b-korean-cid.pdf': fixtureB,
    'c1-signed.pdf': () => fixtureSignature('c1', true),
    'c2-empty-signature.pdf': () => fixtureSignature('c2', false),
    'd-encrypted.pdf': fixtureD,
    'e-image.pdf': fixtureE,
    'f-page-attributes.pdf': fixtureF,
};

if (import.meta.main) {
    const check = process.argv.includes('--check');
    const stale = [];
    if (!check) await mkdir(FIXTURE_DIR, { recursive: true });
    for (const [name, make] of Object.entries(FIXTURES)) {
        const path = join(FIXTURE_DIR, name);
        const fresh = make();
        if (!check) { await writeFile(path, fresh); continue; }
        const current = await readFile(path).catch(() => null);
        if (!current || !current.equals(fresh)) stale.push(name);
    }
    if (stale.length) { console.error(`PDF fixtures differ from scripts/make-pdf-fixtures.mjs: ${stale.join(', ')}`); process.exit(1); }
    console.log(check ? `PDF fixtures match (${Object.keys(FIXTURES).length})` : `Wrote ${Object.keys(FIXTURES).length} PDF fixtures to tests/fixtures/pdf`);
}
