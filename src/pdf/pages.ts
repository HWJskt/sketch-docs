import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, degrees, type PDFObject } from '@cantoo/pdf-lib';
import { EMBEDDED_FILE_NAME, PRIVATE_KEY, exportPdf } from 'svelte-pdf-mini/pdf-codec';
import type { Annotation } from 'svelte-pdf-mini';
import { saveBlockReason } from './protection';

export interface PageItem { id: string; source?: string; index?: number; blank?: { x: number; y: number; width: number; height: number; rotation: number } }
export interface PageSource { id: string; bytes: Uint8Array; count: number; losses: string[] }
const key = PDFName.of;

/** Boundary is measured before removing the selected pages. */
export function movePages(list: PageItem[], selected: string[], boundary: number): PageItem[] {
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > list.length) throw new Error('삽입 위치가 올바르지 않습니다.');
    const picked = new Set(selected);
    const moving = list.filter(p => picked.has(p.id));
    const rest = list.filter(p => !picked.has(p.id));
    const at = list.slice(0, boundary).filter(p => !picked.has(p.id)).length;
    return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}
export function deletePages(list: PageItem[], selected: string[]): PageItem[] {
    const next = list.filter(p => !selected.includes(p.id));
    if (!next.length) throw new Error('마지막 한 쪽은 삭제할 수 없습니다.');
    return next;
}
export function selectPages(list: PageItem[], selected: string[], anchor: string | null, clicked: string, modifiers: { shift?: boolean; toggle?: boolean }): string[] {
    const at = list.findIndex(p => p.id === clicked), from = list.findIndex(p => p.id === anchor);
    if (at < 0) return selected;
    if (modifiers.shift && from >= 0) return list.slice(Math.min(at, from), Math.max(at, from) + 1).map(p => p.id);
    if (modifiers.toggle) return selected.includes(clicked) ? selected.filter(id => id !== clicked) : [...selected, clicked];
    return [clicked];
}
export function remapAnnotations(list: Annotation[], before: PageItem[], after: PageItem[]): Annotation[] {
    const indices = new Map(after.map((p, index) => [p.id, index + 1]));
    return list.flatMap(a => { const page = indices.get(before[a.page - 1]?.id); return page ? [{ ...a, page }] : []; });
}

/** Only report features actually present. These catalog structures are not copied by copyPages. */
export async function inspectLosses(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
    const risks = new Set<string>();
    const labels: Record<string, string> = { Outlines: '목차·북마크', Dests: '페이지 목적지', AcroForm: '양식 필드', PageLabels: '페이지 번호 이름', StructTreeRoot: '구조 태그', MarkInfo: '접근성 태그 정보', Metadata: '문서 메타데이터', OpenAction: '문서 열기 동작', AA: '문서 동작' };
    for (const entry of doc.catalog.keys()) {
        const name = entry.decodeText();
        if (['Type', 'Pages'].includes(name)) continue;
        if (name === 'Names') {
            const names = doc.catalog.lookupMaybe(entry, PDFDict);
            for (const tree of names?.keys() ?? []) {
                if (tree.decodeText() === 'EmbeddedFiles') {
                    const visited = new Set<PDFObject>();
                    const inspectFiles = (value: PDFObject) => {
                        const node = doc.context.lookup(value);
                        if (!(node instanceof PDFDict) || visited.has(node)) throw new Error('첨부 파일 이름 트리를 읽지 못했습니다.');
                        visited.add(node);
                        const entries = node.lookupMaybe(key('Names'), PDFArray);
                        if (entries) {
                            if (entries.size() % 2) throw new Error('첨부 파일 이름 목록이 올바르지 않습니다.');
                            for (let i = 0; i < entries.size(); i += 2) {
                                const label = doc.context.lookup(entries.get(i));
                                if (!(label instanceof PDFString || label instanceof PDFHexString)) throw new Error('첨부 파일 이름을 읽지 못했습니다.');
                                if (label.decodeText() !== EMBEDDED_FILE_NAME) risks.add('첨부 파일');
                            }
                        }
                        const kids = node.lookupMaybe(key('Kids'), PDFArray);
                        kids?.asArray().forEach(inspectFiles);
                    };
                    inspectFiles(names!.get(tree)!);
                } else risks.add(tree.decodeText() === 'Dests' ? '페이지 목적지' : `문서 이름 정보 (${tree.decodeText()})`);
            }
        } else if (name === 'AF') {
            const associated = doc.catalog.lookup(entry);
            if (!(associated instanceof PDFArray)) throw new Error('연결 첨부 파일 정보를 읽지 못했습니다.');
            for (const item of associated.asArray()) {
                const spec = doc.context.lookup(item);
                const label = spec instanceof PDFDict ? doc.context.lookup(spec.get(key('UF')) ?? spec.get(key('F'))) : undefined;
                if (!(label instanceof PDFString || label instanceof PDFHexString) || label.decodeText() !== EMBEDDED_FILE_NAME) risks.add('연결 첨부 파일');
            }
        } else risks.add(labels[name] ?? `문서 정보 (${name})`);
    }
    // Internal page references can appear in links, actions and annotations outside the catalog.
    const seen = new Set<PDFObject>();
    const visit = (object: PDFObject) => {
        if (seen.has(object)) return;
        seen.add(object);
        if (object instanceof PDFArray) object.asArray().forEach(visit);
        if (!(object instanceof PDFDict)) return;
        if (object.has(key('Dest')) || doc.context.lookup(object.get(key('S'))) === key('GoTo')) risks.add('페이지를 가리키는 링크·목적지');
        for (const [, value] of object.entries()) visit(value);
    };
    for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
    if (doc.getTitle() || doc.getAuthor() || doc.getSubject() || doc.getKeywords()) risks.add('제목·작성자 등 문서 속성');
    return [...risks].sort();
}

/** A source is immutable and prepared once, before any page edit can replace the viewer. */
export async function prepareSource(id: string, bytes: Uint8Array, inserted: boolean): Promise<PageSource> {
    const blocked = await saveBlockReason(bytes);
    if (blocked) throw new Error(inserted ? `이 PDF는 삽입할 수 없습니다. ${blocked}` : blocked);
    const losses = await inspectLosses(bytes);
    // Original editable annotations live in the host snapshot, never in the page-content base.
    const clean = inserted ? bytes.slice() : await exportPdf(bytes.slice(), []);
    const doc = await PDFDocument.load(clean, { updateMetadata: false });
    if (!doc.getPageCount()) throw new Error('쪽이 없는 PDF는 삽입할 수 없습니다.');
    if (inserted) {
        for (const page of doc.getPages()) {
            const annots = page.node.Annots();
            for (const [index, ref] of (annots?.asArray() ?? []).entries()) {
                const dict = doc.context.lookup(ref);
                if (!(dict instanceof PDFDict)) throw new Error('삽입 PDF의 주석을 읽지 못했습니다.');
                dict.delete(key(PRIVATE_KEY));
                // Names must not collide with original or other inserted annotations on the next export.
                dict.set(key('NM'), PDFString.of(`${id}-${page.ref.objectNumber}-${index}`));
            }
        }
    }
    return { id, bytes: await doc.save(), count: doc.getPageCount(), losses };
}

export async function blankPage(sources: PageSource[], neighbor: PageItem, id: string): Promise<PageItem> {
    if (neighbor.blank) return { id, blank: { ...neighbor.blank } };
    const source = sources.find(s => s.id === neighbor.source);
    if (!source) throw new Error('기준 페이지를 찾지 못했습니다.');
    const doc = await PDFDocument.load(source.bytes.slice(), { updateMetadata: false });
    const page = doc.getPage(neighbor.index!);
    return { id, blank: { ...page.getMediaBox(), rotation: page.getRotation().angle } };
}

export async function assemblePages(sources: PageSource[], list: PageItem[]): Promise<Uint8Array> {
    if (!list.length) throw new Error('문서에는 한 쪽 이상 있어야 합니다.');
    const out = await PDFDocument.create();
    const copied = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>>();
    // One copier per source keeps shared page resources and annotation relationships intact.
    for (const source of sources) {
        const selected = list.filter(p => p.source === source.id);
        if (!selected.length) continue;
        const doc = await PDFDocument.load(source.bytes.slice(), { updateMetadata: false });
        copied.set(source.id, await out.copyPages(doc, selected.map(p => p.index!)));
    }
    for (const item of list) {
        if (item.blank) {
            const { x, y, width, height, rotation } = item.blank;
            const page = out.addPage([width, height]);
            page.setMediaBox(x, y, width, height); page.setRotation(degrees(rotation));
        } else {
            const page = copied.get(item.source!)?.shift();
            if (!page) throw new Error('페이지 원본을 찾지 못했습니다.');
            out.addPage(page);
            for (const ref of page.node.Annots()?.asArray() ?? []) {
                const dict = out.context.lookup(ref);
                if (dict instanceof PDFDict) dict.set(key('P'), page.ref);
            }
        }
    }
    const bytes = await out.save();
    const read = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
    if (read.getPageCount() !== list.length) throw new Error('만든 PDF의 쪽 수가 다릅니다.');
    return bytes;
}
