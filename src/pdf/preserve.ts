// The preservation check of docs/plans/2026-10-13-pdf-viewer.md ("저장 정책"): before the opened PDF is
// overwritten, the exported file is read back and compared with the original. Everything reachable from the
// trailer's /Root and /Info must be equal by value, except what saving annotations is allowed to change:
//   - each page's /Annots: the original entries we did not write stay, in order; ours and their popups may change
//   - the svelte-pdf-mini model attachment (catalog /Names /EmbeddedFiles and /AF)
//   - /ModDate and /Producer in the document information
// The annotations we wrote must be exactly the snapshot that was saved. Anything the comparison cannot read is
// a refusal, never a pass.
import {
    PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString,
    decodePDFRawStream, type PDFObject,
} from '@cantoo/pdf-lib';
import { EMBEDDED_FILE_NAME, PRIVATE_KEY, importAnnotations, writtenRect } from 'svelte-pdf-mini/pdf-codec';
import type { Annotation } from 'svelte-pdf-mini';

export type Verdict = { ok: true } | { ok: false; reason: string };
class Refusal extends Error {}

const name = (key: string) => PDFName.of(key);
const STREAM_ENCODING = new Set(['Length', 'Filter', 'DecodeParms', 'DL']);
const INFO_UPDATES = new Set(['ModDate', 'Producer']);
// Writers may copy inherited page attributes onto the page and wrap a single content stream in an array
// without changing what the page shows, so pages are compared by their effective values.
const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
const PAGE_EFFECTIVE = new Set([...INHERITED, 'Contents', 'Annots']);

async function load(bytes: Uint8Array) {
    try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (error) { throw new Refusal(`PDF를 다시 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Ids of the annotations svelte-pdf-mini wrote into this document (its model attachment). */
function modelIds(doc: PDFDocument): Set<string> {
    const file = doc.getAttachments().find(item => item.name === EMBEDDED_FILE_NAME);
    if (!file) return new Set();
    try { return new Set((JSON.parse(new TextDecoder().decode(file.data)).annotations ?? []).map((item: { id: string }) => item.id)); }
    catch { throw new Refusal('주석 모델 첨부 파일을 읽지 못했습니다.'); }
}

function stringBytes(value: PDFString | PDFHexString): string {
    return Array.from(value.asBytes(), byte => byte.toString(16).padStart(2, '0')).join('');
}

function streamBytes(stream: PDFStream): Uint8Array {
    if (stream instanceof PDFRawStream) {
        try { return decodePDFRawStream(stream).decode(); }
        catch { throw new Refusal('스트림을 해석하지 못했습니다.'); }
    }
    return stream.getContents();
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const close = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => Number.isFinite(value) && Math.abs(value - b[i]) <= 0.01);
// The annotation subtypes svelte-pdf-mini writes for the kinds this editor offers.
const SUBTYPES: Record<string, string> = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', note: 'Text', ink: 'Ink', rect: 'Square' };

/** Differences between the saved snapshot and the annotations read back (kind, page and geometry within 0.01). */
function modelDifferences(want: readonly Annotation[], got: readonly Annotation[]): string[] {
    const problems: string[] = [];
    if (got.length !== want.length) problems.push(`주석 ${got.length}개, 기대 ${want.length}개`);
    for (const item of want) {
        const read = got.find(other => other.id === item.id) as (Annotation & Record<string, unknown>) | undefined;
        const expected = item as Annotation & Record<string, unknown>;
        if (!read) { problems.push(`${item.id}: 없음`); continue; }
        if (read.kind !== item.kind || read.page !== item.page) problems.push(`${item.id}: 종류·쪽`);
        if (!close(read.rect, item.rect) || !close(read.color, item.color)) problems.push(`${item.id}: 좌표·색`);
        if ((read.contents ?? '') !== (item.contents ?? '')) problems.push(`${item.id}: 내용`);
        const quads = (value: unknown) => (value as number[][] | undefined)?.flat() ?? [];
        if (expected.quads && !close(quads(read.quads), quads(expected.quads))) problems.push(`${item.id}: 글자 영역`);
        const points = (value: unknown) => ((value as { points: number[][] }[] | undefined) ?? []).flatMap(path => path.points.flat());
        if (expected.paths && !close(points(read.paths), points(expected.paths))) problems.push(`${item.id}: 펜 경로`);
        if (expected.width !== undefined && !close([Number(read.width)], [Number(expected.width)])) problems.push(`${item.id}: 두께`);
    }
    return problems;
}

export async function checkPreservation(original: Uint8Array, output: Uint8Array, snapshot: readonly Annotation[]): Promise<Verdict> {
    try {
        const before = await load(original), after = await load(output);
        const oursBefore = modelIds(before), oursAfter = modelIds(after);
        // Original references already matched to output references (object numbers change when a file is rewritten).
        const paired = new Map<string, string>();

        const resolve = (doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined => value instanceof PDFRef ? doc.context.lookup(value) : value;
        const isOurs = (doc: PDFDocument, ids: Set<string>, value: PDFObject | undefined): boolean => {
            const dict = resolve(doc, value);
            if (!(dict instanceof PDFDict)) return false;
            if (dict.get(name(PRIVATE_KEY)) !== undefined) return true;
            const nm = dict.get(name('NM'));
            if ((nm instanceof PDFString || nm instanceof PDFHexString) && ids.has(nm.decodeText())) return true;
            // A popup belongs to its parent annotation.
            return dict.get(name('Subtype')) === name('Popup') && isOurs(doc, ids, dict.get(name('Parent')));
        };

        function compare(a: PDFObject | undefined, b: PDFObject | undefined, path: string): void {
            if (a instanceof PDFRef || b instanceof PDFRef) {
                if (!(a instanceof PDFRef) || !(b instanceof PDFRef)) {
                    // A direct object may become indirect (or back) when rewritten; compare the values.
                    return compare(resolve(before, a), resolve(after, b), path);
                }
                const key = a.toString();
                const known = paired.get(key);
                if (known !== undefined) {
                    if (known !== b.toString()) throw new Refusal(`${path}: 같은 객체가 서로 다른 객체로 바뀌었습니다.`);
                    return;
                }
                paired.set(key, b.toString());
                return compare(before.context.lookup(a), after.context.lookup(b), path);
            }
            if (a === undefined || b === undefined) throw new Refusal(`${path}: ${a === undefined ? '새로 생겼습니다' : '없어졌습니다'}.`);
            if (a instanceof PDFStream || b instanceof PDFStream) {
                if (!(a instanceof PDFStream) || !(b instanceof PDFStream)) throw new Refusal(`${path}: 형식이 바뀌었습니다.`);
                compareDicts(a.dict, b.dict, path, STREAM_ENCODING);
                return compareStreamData(a, b, path);
            }
            if (a instanceof PDFDict && b instanceof PDFDict) return compareDicts(a, b, path);
            if (a instanceof PDFArray && b instanceof PDFArray) {
                if (a.size() !== b.size()) throw new Refusal(`${path}: 배열 길이가 바뀌었습니다.`);
                for (let i = 0; i < a.size(); i++) compare(a.get(i), b.get(i), `${path}[${i}]`);
                return;
            }
            if ((a instanceof PDFString || a instanceof PDFHexString) && (b instanceof PDFString || b instanceof PDFHexString)) {
                if (stringBytes(a) !== stringBytes(b)) throw new Refusal(`${path}: 문자열이 바뀌었습니다.`);
                return;
            }
            if (a instanceof PDFNumber && b instanceof PDFNumber) {
                if (a.asNumber() !== b.asNumber()) throw new Refusal(`${path}: 숫자가 바뀌었습니다.`);
                return;
            }
            if ((a instanceof PDFName && b instanceof PDFName) || (a instanceof PDFBool && b instanceof PDFBool) || (a === PDFNull && b === PDFNull)) {
                if (a.toString() !== b.toString()) throw new Refusal(`${path}: 값이 바뀌었습니다.`);
                return;
            }
            throw new Refusal(`${path}: 비교할 수 없는 객체입니다(${a.constructor.name}, ${b.constructor.name}).`);
        }

        // Same filters and parameters: the encoded bytes must be identical (this also covers filters pdf-lib
        // cannot decode, such as JPEG). Re-encoded: decoded bytes are compared, but only without decode
        // parameters, because pdf-lib's decoder ignores predictors and would call different images equal.
        function compareStreamData(a: PDFStream, b: PDFStream, path: string) {
            const encoding = (stream: PDFStream, doc: PDFDocument) => ['Filter', 'DecodeParms'].map(key => resolve(doc, stream.dict.get(name(key)))?.toString() ?? '').join(' | ');
            if (encoding(a, before) === encoding(b, after)) {
                if (sameBytes(a.getContents(), b.getContents())) return;
            }
            if (a.dict.get(name('DecodeParms')) !== undefined || b.dict.get(name('DecodeParms')) !== undefined) throw new Refusal(`${path}: 스트림 인코딩이 바뀌어 비교할 수 없습니다.`);
            if (!sameBytes(streamBytes(a), streamBytes(b))) throw new Refusal(`${path}: 스트림 내용이 바뀌었습니다.`);
        }

        function compareDicts(a: PDFDict, b: PDFDict, path: string, skip = new Set<string>()): void {
            const keys = (dict: PDFDict) => dict.keys().map(key => key.decodeText()).filter(key => !skip.has(key));
            const isPage = a.get(name('Type')) === name('Page');
            const special = new Set<string>();
            if (isPage) for (const key of PAGE_EFFECTIVE) special.add(key);
            if (path === 'Root') { special.add('Names'); special.add('AF'); }
            if (path === 'Info') for (const key of INFO_UPDATES) special.add(key);
            const left = keys(a).filter(key => !special.has(key)), right = keys(b).filter(key => !special.has(key));
            // Writers add empty resource categories (pdf-lib adds /XObject and /ExtGState); an empty one names nothing.
            const empty = (key: string) => { const value = resolve(after, b.get(name(key))); return value instanceof PDFDict && value.keys().length === 0; };
            const missing = left.filter(key => !right.includes(key));
            const added = right.filter(key => !left.includes(key) && !(path.endsWith('/Resources') && empty(key)));
            if (missing.length || added.length) throw new Refusal(`${path}: 키가 바뀌었습니다(${[...missing.map(key => `-${key}`), ...added.map(key => `+${key}`)].join(' ')}).`);
            for (const key of left) compare(a.get(name(key)), b.get(name(key)), `${path}/${key}`);
            if (isPage) {
                for (const key of INHERITED) compare(effective(before, a, key), effective(after, b, key), `${path}/${key}`);
                const kept = contents(before, a, path), saved = contents(after, b, path);
                // Writers isolate the existing content in its own graphics state before adding to a page:
                // a "q" stream before it and a "Q" stream after it (pdf-lib does this on every save).
                const plain = (part: Uint8Array) => new TextDecoder('latin1').decode(part).trim();
                while (saved.length >= kept.length + 2 && plain(saved[0]) === 'q' && plain(saved[saved.length - 1]) === 'Q') { saved.shift(); saved.pop(); }
                if (kept.length !== saved.length || kept.some((part, i) => !sameBytes(part, saved[i]))) throw new Refusal(`${path}/Contents: 쪽 내용이 바뀌었습니다.`);
                compareAnnots(a, b, `${path}/Annots`);
            }
            if (path === 'Root') compareAttachments(a, b);
        }

        function inherited(doc: PDFDocument, page: PDFDict, key: string): PDFObject | undefined {
            for (let node: PDFObject | undefined = page, depth = 0; node instanceof PDFDict && depth < 64; node = resolve(doc, node.get(name('Parent'))), depth++) {
                const value = node.get(name(key));
                if (value !== undefined) return value;
            }
            return undefined;
        }
        // Defaults of ISO 32000-1 table 30: no CropBox means the MediaBox, no Rotate means 0.
        function effective(doc: PDFDocument, page: PDFDict, key: string): PDFObject | undefined {
            const value = inherited(doc, page, key);
            if (value !== undefined) return value;
            if (key === 'CropBox') return inherited(doc, page, 'MediaBox');
            if (key === 'Rotate') return PDFNumber.of(0);
            return undefined;
        }
        /** The page's content streams, decoded, in order (a single stream and an array of one are the same). */
        function contents(doc: PDFDocument, page: PDFDict, path: string): Uint8Array[] {
            const value = resolve(doc, page.get(name('Contents')));
            const streams = value === undefined ? [] : value instanceof PDFArray ? value.asArray().map(item => resolve(doc, item)) : [value];
            return streams.map(item => {
                if (!(item instanceof PDFStream)) throw new Refusal(`${path}/Contents: 스트림이 아닙니다.`);
                return streamBytes(item);
            });
        }

        function compareAnnots(a: PDFDict, b: PDFDict, path: string) {
            const entries = (doc: PDFDocument, page: PDFDict) => {
                const list = resolve(doc, page.get(name('Annots')));
                if (list === undefined) return [];
                if (!(list instanceof PDFArray)) throw new Refusal(`${path}: 배열이 아닙니다.`);
                return list.asArray();
            };
            const kept = entries(before, a).filter(entry => !isOurs(before, oursBefore, entry));
            const foreignAfter = entries(after, b).filter(entry => !isOurs(after, oursAfter, entry));
            if (kept.length !== foreignAfter.length) throw new Refusal(`${path}: 기존 주석 수가 바뀌었습니다(${kept.length} → ${foreignAfter.length}).`);
            kept.forEach((entry, i) => compare(entry, foreignAfter[i], `${path}[${i}]`));
        }

        // The model attachment may be added, replaced or removed; every other attachment stays as it was.
        function attachments(doc: PDFDocument, root: PDFDict) {
            const names = resolve(doc, root.get(name('Names')));
            const others: [string, PDFObject][] = [], ours: PDFObject[] = [];
            if (names === undefined) return { names: undefined, others, ours };
            if (!(names instanceof PDFDict)) throw new Refusal('Root/Names: 사전이 아닙니다.');
            const files = resolve(doc, names.get(name('EmbeddedFiles')));
            if (files !== undefined) {
                if (!(files instanceof PDFDict) || files.get(name('Kids')) !== undefined) throw new Refusal('Root/Names/EmbeddedFiles: 지원하지 않는 이름 트리입니다.');
                const list = resolve(doc, files.get(name('Names')));
                if (!(list instanceof PDFArray) || list.size() % 2) throw new Refusal('Root/Names/EmbeddedFiles/Names: 읽을 수 없습니다.');
                for (let i = 0; i < list.size(); i += 2) {
                    const label = resolve(doc, list.get(i));
                    if (!(label instanceof PDFString || label instanceof PDFHexString)) throw new Refusal('첨부 파일 이름을 읽지 못했습니다.');
                    if (label.decodeText() === EMBEDDED_FILE_NAME) ours.push(list.get(i + 1));
                    else others.push([label.decodeText(), list.get(i + 1)]);
                }
            }
            return { names, others, ours };
        }
        function compareAttachments(a: PDFDict, b: PDFDict) {
            const left = attachments(before, a), right = attachments(after, b);
            // Other name trees (destinations, JavaScript…) are compared as they are.
            const trees = (names: PDFDict | undefined) => names ? names.keys().map(key => key.decodeText()).filter(key => key !== 'EmbeddedFiles').sort() : [];
            const leftTrees = trees(left.names), rightTrees = trees(right.names);
            if (leftTrees.join() !== rightTrees.join()) throw new Refusal(`Root/Names: 이름 트리가 바뀌었습니다(${leftTrees} → ${rightTrees}).`);
            for (const key of leftTrees) compare(left.names!.get(name(key)), right.names!.get(name(key)), `Root/Names/${key}`);
            if (left.others.length !== right.others.length) throw new Refusal('Root/Names/EmbeddedFiles: 첨부 파일 수가 바뀌었습니다.');
            left.others.forEach(([label, spec], i) => {
                if (right.others[i][0] !== label) throw new Refusal(`첨부 파일 ${label}이(가) 바뀌었습니다.`);
                compare(spec, right.others[i][1], `Root/Names/EmbeddedFiles/${label}`);
            });
            if (right.ours.length > 1) throw new Refusal('주석 모델 첨부 파일이 여러 개입니다.');
            const af = (doc: PDFDocument, root: PDFDict, ours: PDFObject[]) => {
                const list = resolve(doc, root.get(name('AF')));
                if (list === undefined) return [];
                if (!(list instanceof PDFArray)) throw new Refusal('Root/AF: 배열이 아닙니다.');
                const ourKeys = new Set(ours.map(item => item.toString()));
                return list.asArray().filter(item => !ourKeys.has(item.toString()));
            };
            const afBefore = af(before, a, left.ours), afAfter = af(after, b, right.ours);
            if (afBefore.length !== afAfter.length) throw new Refusal('Root/AF: 연결 파일이 바뀌었습니다.');
            afBefore.forEach((item, i) => compare(item, afAfter[i], `Root/AF[${i}]`));
        }

        const trailer = (doc: PDFDocument) => doc.context.trailerInfo;
        compare(trailer(before).Root, trailer(after).Root, 'Root');
        if (trailer(before).Info !== undefined || trailer(after).Info !== undefined) compare(trailer(before).Info, trailer(after).Info, 'Info');

        // The annotations we wrote are exactly the snapshot: in the model read back, and as the standard PDF
        // annotations other viewers draw (subtype, page, rectangle, color, text and an appearance stream).
        const want = snapshot.filter(item => item.origin !== 'foreign');
        const read = await importAnnotations(output.slice(), { foreign: false });
        const differences = modelDifferences(want, read.annotations);
        if (differences.length) throw new Refusal(`저장한 주석이 저장하려던 주석과 다릅니다: ${differences.slice(0, 3).join(', ')}`);
        let written = 0;
        after.getPages().forEach((page, index) => {
            const list = resolve(after, page.node.get(name('Annots')));
            if (!(list instanceof PDFArray)) return;
            for (const entry of list.asArray()) {
                const dict = resolve(after, entry);
                if (!(dict instanceof PDFDict) || !isOurs(after, oursAfter, entry) || dict.get(name('Subtype')) === name('Popup')) continue;
                written++;
                const nm = dict.get(name('NM'));
                const item = (nm instanceof PDFString || nm instanceof PDFHexString) ? want.find(other => other.id === nm.decodeText()) : undefined;
                if (!item) throw new Refusal(`${index + 1}쪽: 저장하려던 주석에 없는 주석이 있습니다.`);
                if (item.page !== index + 1 || dict.get(name('Subtype')) !== name(SUBTYPES[item.kind] ?? '?')) throw new Refusal(`${item.id}: PDF 주석의 종류나 쪽이 다릅니다.`);
                const numbers = (key: string) => { const value = resolve(after, dict.get(name(key))); return value instanceof PDFArray ? value.asArray().map(v => (resolve(after, v) as PDFNumber)?.asNumber?.() ?? NaN) : []; };
                if (!close(numbers('Rect'), writtenRect(item))) throw new Refusal(`${item.id}: PDF 주석의 위치가 다릅니다.`);
                if (!close(numbers('C'), item.color)) throw new Refusal(`${item.id}: PDF 주석의 색이 다릅니다.`);
                if (item.contents) {
                    const text = resolve(after, dict.get(name('Contents')));
                    if (!(text instanceof PDFString || text instanceof PDFHexString) || text.decodeText() !== item.contents) throw new Refusal(`${item.id}: PDF 주석의 내용이 다릅니다.`);
                }
                const appearance = resolve(after, dict.get(name('AP')));
                const normal = appearance instanceof PDFDict ? resolve(after, appearance.get(name('N'))) : undefined;
                if (!(normal instanceof PDFStream) || normal.getContents().length === 0) throw new Refusal(`${item.id}: PDF 주석의 모양(appearance)이 없습니다.`);
            }
        });
        if (written !== want.length) throw new Refusal(`PDF 주석 ${written}개, 기대 ${want.length}개.`);
        return { ok: true };
    } catch (error) {
        if (error instanceof Refusal) return { ok: false, reason: error.message };
        return { ok: false, reason: `보존 여부를 판정하지 못했습니다: ${error instanceof Error ? error.message : String(error)}` };
    }
}
