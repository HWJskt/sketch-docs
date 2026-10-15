// What an .xlsx holds, read into one flat list of items, and the differences between two of them
// (docs/plans/2026-10-15-xlsx-edit.md §3.5). Parts are reached through their relationships, not their names
// (a writer renames them), styles are compared as the formats they resolve to (a writer renumbers them),
// and pictures by their bytes. An item is `area|key` → a canonical string; two packages that give the same
// list hold the same things *as far as this list looks*. What it does not look at is not compared.
import { unzipSync } from 'fflate';
import { allText, attr, child, children, parseXml, type XmlElement } from './xml';

export type Inventory = Map<string, string>;
export interface Difference { area: string; key: string; before: string | undefined; after: string | undefined }

const NONE: XmlElement = { name: '', local: '', attrs: {}, children: [], text: '' };
const relKind = (type: string) => type.slice(type.lastIndexOf('/') + 1);
// Canonical JSON: keys sorted, and empty strings and empty objects left out like missing values.
const json = (value: unknown) => JSON.stringify(value, (_key, v) => {
    if (v === undefined || v === '') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== '').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return v;
});
const round = (value: string | undefined, digits = 2) => (value === undefined || value === '' || !Number.isFinite(Number(value)) ? value : String(Number(Number(value).toFixed(digits))));

// Writers differ in spelling, not meaning: booleans as 1/true, attributes left at their schema default or
// written out, sheet names quoted or not, numbers in exponent form. These are made the same before comparing.
const bool = (value: string | undefined) => (value === 'true' ? '1' : value === 'false' ? '0' : value);
/** Attributes with booleans spelled one way and those at their default (ECMA-376 Part 1) left out. */
function norm(attrs: Record<string, string> | undefined, defaults: Record<string, string> = {}): Record<string, string> | undefined {
    if (!attrs) return undefined;
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(attrs)) {
        if (/(^|:)id$/.test(key) || key.startsWith('xmlns') || key.startsWith('xr:') || key.startsWith('mc:')) continue;
        const value = bool(raw)!;
        if (defaults[key] !== undefined && defaults[key] === value) continue;
        out[key] = value;
    }
    return out;
}
const DEFAULTS = {
    sheetProtection: { sheet: '0', objects: '0', scenarios: '0', formatCells: '1', formatColumns: '1', formatRows: '1', insertColumns: '1', insertRows: '1', insertHyperlinks: '1', deleteColumns: '1', deleteRows: '1', selectLockedCells: '0', sort: '1', autoFilter: '1', pivotTables: '1', selectUnlockedCells: '0' },
    workbookProtection: { lockStructure: '0', lockWindows: '0', lockRevision: '0' },
    dataValidation: { showDropDown: '0', showInputMessage: '0', showErrorMessage: '0', allowBlank: '0', operator: 'between', errorStyle: 'stop', imeMode: 'noControl', type: 'none' },
    tableStyleInfo: { showFirstColumn: '0', showLastColumn: '0', showRowStripes: '0', showColumnStripes: '0' },
    pageSetup: { orientation: 'default', scale: '100', fitToWidth: '1', fitToHeight: '1', firstPageNumber: '1', useFirstPageNumber: '0', pageOrder: 'downThenOver', blackAndWhite: '0', draft: '0', cellComments: 'none', errors: 'displayed', horizontalDpi: '600', verticalDpi: '600', copies: '1', usePrinterDefaults: '1', paperSize: '1' },
    printOptions: { horizontalCentered: '0', verticalCentered: '0', headings: '0', gridLines: '0', gridLinesSet: '1' },
    outlinePr: { summaryBelow: '1', summaryRight: '1', applyStyles: '0', showOutlineSymbols: '1' },
    pageSetUpPr: { fitToPage: '0', autoPageBreaks: '1' },
    sheetFormatPr: { baseColWidth: '8', zeroHeight: '0', customHeight: '0', thickTop: '0', thickBottom: '0' },
    filters: { blank: '0' },
    alignment: { horizontal: 'general', vertical: 'bottom', wrapText: '0', shrinkToFit: '0', indent: '0', textRotation: '0', readingOrder: '0', justifyLastLine: '0', relativeIndent: '0' },
    protection: { locked: '1', hidden: '0' },
};
/** A quoted sheet name that needs no quotes is written without them ('매출'!A1 → 매출!A1). */
const formula = (text: string | undefined) => text?.replace(/'((?:[^'\s!()+\-*\/,;&=<>^%"]|'')+)'!/gu, (whole, name: string) => (/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) ? `${name}!` : whole));
const number = (value: string | undefined) => (value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? String(Number(value)) : value);

/** Excel's built-in number formats a writer may spell out instead of numbering (ECMA-376 §18.8.30). */
const BUILTIN_FORMATS: Record<string, string> = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
    14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm',
    37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

/** FNV-1a 64-bit over the bytes, with the length: tells pictures apart (not a security hash). */
export function bytesId(bytes: Uint8Array): string {
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    return `${bytes.length}:${hash.toString(16)}`;
}

class Package {
    readonly files: Record<string, Uint8Array>;
    readonly types = new Map<string, string>();
    /** Parts something here read: the rest is counted by kind only. */
    readonly read = new Set<string>();
    private readonly cache = new Map<string, XmlElement | null>();
    constructor(bytes: Uint8Array) {
        this.files = unzipSync(bytes);
        const content = this.xml('[Content_Types].xml');
        const defaults = new Map(children(content ?? undefined, 'Default').map(d => [String(attr(d, 'Extension')).toLowerCase(), String(attr(d, 'ContentType'))]));
        for (const name of Object.keys(this.files)) {
            if (name.endsWith('/')) continue;
            const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
            if (defaults.has(ext)) this.types.set(name, defaults.get(ext)!);
        }
        for (const o of children(content ?? undefined, 'Override')) this.types.set(String(attr(o, 'PartName')).replace(/^\//, ''), String(attr(o, 'ContentType')));
    }
    text(name: string) { const bytes = this.files[name]; return bytes ? new TextDecoder().decode(bytes) : undefined; }
    xml(name: string): XmlElement | null {
        this.read.add(name);
        if (!this.cache.has(name)) { const text = this.text(name); this.cache.set(name, text === undefined ? null : parseXml(text)); }
        return this.cache.get(name)!;
    }
    /** Relationships of `part`: id → { kind, target (a part name, or the external target), external }. */
    rels(part: string): Map<string, { kind: string; target: string; external: boolean }> {
        const slash = part.lastIndexOf('/');
        const dir = slash < 0 ? '' : part.slice(0, slash + 1);
        const rels = this.xml(`${dir}_rels/${part.slice(slash + 1)}.rels`);
        this.read.add('[Content_Types].xml');
        const out = new Map<string, { kind: string; target: string; external: boolean }>();
        for (const r of children(rels ?? undefined, 'Relationship')) {
            const external = attr(r, 'TargetMode') === 'External';
            const target = String(attr(r, 'Target'));
            out.set(String(attr(r, 'Id')), { kind: relKind(String(attr(r, 'Type'))), target: external ? target : resolve(dir, target), external });
        }
        return out;
    }
    related(part: string, kind: string) { return [...this.rels(part).values()].filter(r => r.kind === kind && !r.external).map(r => r.target); }
}

function resolve(dir: string, target: string): string {
    const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
    const out: string[] = [];
    for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.' && part !== '') out.push(part); }
    return out.join('/');
}

function color(element: XmlElement | undefined) {
    // indexed 64 is the system's automatic colour, the same as naming none. Tints are compared to 1/1000
    // (a writer may round -0.2499… to -0.25).
    if (!element || attr(element, 'indexed') === '64' || bool(attr(element, 'auto')) === '1') return undefined;
    const rgb = attr(element, 'rgb');
    return json({ rgb: rgb ? rgb.toUpperCase().replace(/^FF(?=[0-9A-F]{6}$)/, '') : undefined, theme: attr(element, 'theme'), indexed: attr(element, 'indexed'), tint: round(attr(element, 'tint'), 3), auto: attr(element, 'auto') });
}
const flag = (element: XmlElement | undefined, name: string) => {
    const e = child(element, name);
    return e ? bool(attr(e, 'val') ?? '1') : undefined;
};

/** Each cell format as the font, fill, border, number format, alignment and protection it resolves to. */
function readStyles(pkg: Package, workbook: string) {
    const part = pkg.related(workbook, 'styles')[0];
    const styles = part ? pkg.xml(part) : null;
    const formats = new Map(children(child(styles ?? undefined, 'numFmts'), 'numFmt').map(f => [String(attr(f, 'numFmtId')), String(attr(f, 'formatCode'))]));
    const format = (id: string | undefined) => formats.get(id ?? '0') ?? BUILTIN_FORMATS[id ?? '0'] ?? `builtin:${id}`;
    // A cell format's font without a name, size or colour takes the workbook's default font's (font 0);
    // a conditional format's font only names what it changes.
    const font = (f: XmlElement | undefined, base?: XmlElement) => f && json({ name: attr(child(f, 'name'), 'val') ?? attr(child(base, 'name'), 'val'), size: round(attr(child(f, 'sz'), 'val') ?? attr(child(base, 'sz'), 'val')), bold: flag(f, 'b'), italic: flag(f, 'i'), underline: flag(f, 'u'), strike: flag(f, 'strike'), color: color(child(f, 'color') ?? child(base, 'color')), vertAlign: attr(child(f, 'vertAlign'), 'val'), charset: undefined });
    const fill = (f: XmlElement | undefined) => {
        const pattern = child(f, 'patternFill');
        if (pattern) {
            const fg = color(child(pattern, 'fgColor')), bg = color(child(pattern, 'bgColor'));
            // A conditional format's solid fill takes its colour from bgColor; some writers repeat it as fgColor.
            return json({ pattern: attr(pattern, 'patternType') ?? (bg ? 'solid' : 'none'), fg: fg === bg ? undefined : fg, bg });
        }
        const gradient = child(f, 'gradientFill');
        return gradient ? json({ gradient: gradient.attrs, stops: children(gradient, 'stop').map(s => [attr(s, 'position'), color(child(s, 'color'))]) }) : undefined;
    };
    const border = (b: XmlElement | undefined) => b && json({
        ...Object.fromEntries(['left', 'right', 'top', 'bottom', 'diagonal'].map(side => { const s = child(b, side); return [side, attr(s, 'style') ? json({ style: attr(s, 'style'), color: color(child(s, 'color')) }) : undefined]; })),
        diagonalUp: attr(b, 'diagonalUp'), diagonalDown: attr(b, 'diagonalDown'),
    });
    const fonts = children(child(styles ?? undefined, 'fonts'), 'font');
    const fills = children(child(styles ?? undefined, 'fills'), 'fill');
    const borders = children(child(styles ?? undefined, 'borders'), 'border');
    const xf = (x: XmlElement) => json({
        format: format(attr(x, 'numFmtId')), font: font(fonts[Number(attr(x, 'fontId') ?? 0)], fonts[0]), fill: fill(fills[Number(attr(x, 'fillId') ?? 0)]),
        border: border(borders[Number(attr(x, 'borderId') ?? 0)]), alignment: norm(child(x, 'alignment')?.attrs, DEFAULTS.alignment), protection: norm(child(x, 'protection')?.attrs, DEFAULTS.protection),
    });
    const cellXfs = children(child(styles ?? undefined, 'cellXfs'), 'xf').map(xf);
    const dxfs = children(child(styles ?? undefined, 'dxfs'), 'dxf').map(d => json({ font: font(child(d, 'font')), fill: fill(child(d, 'fill')), border: border(child(d, 'border')), format: child(d, 'numFmt') ? attr(child(d, 'numFmt'), 'formatCode') : undefined }));
    return { cell: (s: string | undefined) => cellXfs[Number(s ?? 0)] ?? `missing-style:${s}`, dxf: (id: string | undefined) => (id === undefined ? undefined : dxfs[Number(id)] ?? `missing-dxf:${id}`) };
}

// --- shared formulas: a dependent cell's formula is the master's with its relative references moved ---
const columnNumber = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const columnLetters = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const splitRef = (ref: string) => { const m = /^([A-Z]+)(\d+)$/i.exec(ref); return m ? { col: columnNumber(m[1]), row: Number(m[2]) } : undefined; };
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
    // Strings are kept as they are; outside them, A1 references (optionally $-anchored, not function names) move.
    return formula.split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part : part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (whole, colAbs: string, col: string, rowAbs: string, row: string, offset: number, all: string) => {
        if (/[A-Za-z_.\d]/.test(all[offset - 1] ?? '')) return whole;
        const c = colAbs ? columnNumber(col) : columnNumber(col) + dCol;
        const r = rowAbs ? Number(row) : Number(row) + dRow;
        return c < 1 || r < 1 ? '#REF!' : `${colAbs}${columnLetters(c)}${rowAbs}${r}`;
    })).join('');
}

function readSheet(pkg: Package, part: string, sheet: string, styles: ReturnType<typeof readStyles>, strings: XmlElement[], put: (area: string, key: string, value: unknown) => void) {
    const ws = pkg.xml(part);
    if (!ws) { put('sheet', `${sheet}`, 'missing-part'); return; }
    const rels = pkg.rels(part);
    const shared = new Map<string, { formula: string; row: number; col: number }>();
    for (const row of children(child(ws, 'sheetData'), 'row')) {
        const r = attr(row, 'r');
        const rowInfo = { height: attr(row, 'customHeight') === '1' || attr(row, 'customHeight') === 'true' ? round(attr(row, 'ht')) : undefined, hidden: attr(row, 'hidden'), outline: attr(row, 'outlineLevel'), collapsed: attr(row, 'collapsed'), style: attr(row, 'customFormat') === '1' ? styles.cell(attr(row, 's')) : undefined };
        if (r && Object.values(rowInfo).some(v => v !== undefined && v !== '0' && v !== 'false')) put('row', `${sheet}!${r}`, rowInfo);
        for (const c of children(row, 'c')) {
            const ref = String(attr(c, 'r'));
            const type = attr(c, 't') ?? 'n';
            const f = child(c, 'f');
            let text = f ? formula(f.text) : undefined;
            if (f && attr(f, 't') === 'shared') {
                const si = String(attr(f, 'si'));
                const at = splitRef(ref);
                if (text && at) shared.set(si, { formula: text, ...at });
                else if (at && shared.has(si)) { const m = shared.get(si)!; text = shiftFormula(m.formula, at.row - m.row, at.col - m.col); }
            }
            const v = child(c, 'v')?.text;
            const rich = type === 's' ? strings[Number(v)] : type === 'inlineStr' ? child(c, 'is') : undefined;
            const value = type === 's' || type === 'inlineStr' ? (rich ? allText(rich) : undefined) : type === 'n' ? number(v) : v;
            const kind = type === 's' || type === 'inlineStr' || type === 'str' ? 'string' : type;
            if (value === undefined && text === undefined && !attr(c, 's')) continue;
            put('cell', `${sheet}!${ref}`, { kind, value, formula: text, array: f && attr(f, 't') === 'array' ? attr(f, 'ref') : undefined, style: styles.cell(attr(c, 's')) });
            const runs = children(rich, 'r');
            if (runs.length) put('rich-text', `${sheet}!${ref}`, runs.map(run => [allText(child(run, 't')), child(run, 'rPr')?.children.map(p => [p.local, p.attrs])]));
        }
    }
    for (const col of children(child(ws, 'cols'), 'col')) {
        for (let i = Number(attr(col, 'min')); i <= Number(attr(col, 'max')) && i <= 16384; i++) {
            put('column', `${sheet}!${columnLetters(i)}`, { width: attr(col, 'customWidth') === '1' || attr(col, 'customWidth') === 'true' ? round(attr(col, 'width')) : undefined, hidden: attr(col, 'hidden'), outline: attr(col, 'outlineLevel'), style: attr(col, 'style') ? styles.cell(attr(col, 'style')) : undefined });
        }
    }
    put('merge', sheet, children(child(ws, 'mergeCells'), 'mergeCell').map(m => attr(m, 'ref')).sort());
    const view = child(child(ws, 'sheetViews'), 'sheetView');
    const pane = child(view, 'pane');
    put('view', sheet, { pane: pane && { x: attr(pane, 'xSplit'), y: attr(pane, 'ySplit'), topLeft: attr(pane, 'topLeftCell'), state: attr(pane, 'state') }, gridLines: attr(view, 'showGridLines'), zoom: attr(view, 'zoomScale'), rtl: attr(view, 'rightToLeft'), headings: attr(view, 'showRowColHeaders'), mode: attr(view, 'view') });
    const pr = child(ws, 'sheetPr');
    put('sheet-props', sheet, { tab: color(child(pr, 'tabColor')), outline: norm(child(pr, 'outlinePr')?.attrs, DEFAULTS.outlinePr), fit: norm(child(pr, 'pageSetUpPr')?.attrs, DEFAULTS.pageSetUpPr), defaults: norm(Object.fromEntries(Object.entries(child(ws, 'sheetFormatPr')?.attrs ?? {}).filter(([k]) => !/^outlineLevel(Row|Col)$/.test(k))), DEFAULTS.sheetFormatPr) });
    children(ws, 'conditionalFormatting').forEach(cf => put('conditional-format', `${sheet}!${attr(cf, 'sqref')}`,
        children(cf, 'cfRule').map(rule => ({ type: attr(rule, 'type'), operator: attr(rule, 'operator'), text: attr(rule, 'text'), rank: attr(rule, 'rank'), percent: attr(rule, 'percent'), bottom: attr(rule, 'bottom'), aboveAverage: attr(rule, 'aboveAverage'), timePeriod: attr(rule, 'timePeriod'), stop: attr(rule, 'stopIfTrue'), formulas: children(rule, 'formula').map(f => formula(f.text)), format: styles.dxf(attr(rule, 'dxfId')), scale: child(rule, 'colorScale') && children(child(rule, 'colorScale'), 'color').map(color), bar: child(rule, 'dataBar') && color(child(child(rule, 'dataBar'), 'color')), icons: child(rule, 'iconSet')?.attrs }))));
    for (const dv of children(child(ws, 'dataValidations'), 'dataValidation')) put('validation', `${sheet}!${attr(dv, 'sqref')}`, { ...norm(dv.attrs, DEFAULTS.dataValidation), sqref: undefined, f1: formula(child(dv, 'formula1')?.text), f2: formula(child(dv, 'formula2')?.text) });
    for (const link of children(child(ws, 'hyperlinks'), 'hyperlink')) {
        const id = attr(link, 'id');
        put('hyperlink', `${sheet}!${attr(link, 'ref')}`, { target: id ? rels.get(id)?.target : undefined, location: attr(link, 'location'), display: attr(link, 'display'), tooltip: attr(link, 'tooltip') });
    }
    // Margins compared to 1/10000 inch: a writer may keep them as 32-bit floats (0.3 → 0.30000001192…).
    put('print', sheet, { margins: Object.fromEntries(Object.entries(child(ws, 'pageMargins')?.attrs ?? {}).map(([k, v]) => [k, round(v, 4)])), setup: norm(Object.fromEntries(Object.entries(child(ws, 'pageSetup')?.attrs ?? {}).map(([k, v]) => [k, k === 'orientation' && v === 'portrait' ? 'default' : v])), DEFAULTS.pageSetup), options: norm(child(ws, 'printOptions')?.attrs, DEFAULTS.printOptions), header: child(child(ws, 'headerFooter'), 'oddHeader')?.text, footer: child(child(ws, 'headerFooter'), 'oddFooter')?.text,
        // Even and first pages have their own header and footer (review 2026-10-16 #4: not compared before).
        evenHeader: child(child(ws, 'headerFooter'), 'evenHeader')?.text, evenFooter: child(child(ws, 'headerFooter'), 'evenFooter')?.text,
        firstHeader: child(child(ws, 'headerFooter'), 'firstHeader')?.text, firstFooter: child(child(ws, 'headerFooter'), 'firstFooter')?.text,
        headerFlags: norm(child(ws, 'headerFooter')?.attrs, { differentOddEven: '0', differentFirst: '0', scaleWithDoc: '1', alignWithMargins: '1' }), rowBreaks: children(child(ws, 'rowBreaks'), 'brk').map(b => attr(b, 'id')), colBreaks: children(child(ws, 'colBreaks'), 'brk').map(b => attr(b, 'id')) });
    put('protection', sheet, norm(child(ws, 'sheetProtection')?.attrs, DEFAULTS.sheetProtection));
    // Error checks the author turned off for ranges (review #4).
    put('ignored-errors', sheet, children(child(ws, 'ignoredErrors'), 'ignoredError').map(e => norm(e.attrs)));
    const filter = child(ws, 'autoFilter');
    if (filter) put('filter', sheet, { ref: attr(filter, 'ref'), columns: children(filter, 'filterColumn').map(c => [attr(c, 'colId'), c.children.map(x => [x.local, norm(x.attrs, x.local === 'filters' ? DEFAULTS.filters : {}), x.children.map(y => y.attrs)])]) });
    put('extensions', sheet, children(child(ws, 'extLst'), 'ext').map(e => attr(e, 'uri')).sort());
    for (const target of pkg.related(part, 'table')) {
        const t = pkg.xml(target);
        put('table', `${sheet}!${attr(t ?? undefined, 'displayName') ?? attr(t ?? undefined, 'name')}`, { ref: attr(t ?? undefined, 'ref'), header: attr(t ?? undefined, 'headerRowCount') === '0' ? '0' : undefined, totals: attr(t ?? undefined, 'totalsRowCount') === '0' ? undefined : attr(t ?? undefined, 'totalsRowCount'), columns: children(child(t ?? undefined, 'tableColumns'), 'tableColumn').map(c => [attr(c, 'name'), attr(c, 'totalsRowFunction'), formula(child(c, 'calculatedColumnFormula')?.text)]), style: norm(child(t ?? undefined, 'tableStyleInfo')?.attrs, DEFAULTS.tableStyleInfo) });
    }
    for (const target of pkg.related(part, 'comments')) {
        const comments = pkg.xml(target);
        const authors = children(child(comments ?? undefined, 'authors'), 'author').map(a => a.text);
        for (const c of children(child(comments ?? undefined, 'commentList'), 'comment')) put('note', `${sheet}!${attr(c, 'ref')}`, { author: authors[Number(attr(c, 'authorId'))], text: allText(child(c, 'text')) });
    }
    for (const target of pkg.related(part, 'threadedComment')) {
        for (const c of children(pkg.xml(target) ?? undefined, 'threadedComment')) put('thread', `${sheet}!${attr(c, 'ref')}#${attr(c, 'id')}`, { text: allText(child(c, 'text')), parent: attr(c, 'parentId') ? 'reply' : undefined, done: attr(c, 'done') });
    }
    for (const target of pkg.related(part, 'drawing')) readDrawing(pkg, target, sheet, put);
}

function readDrawing(pkg: Package, part: string, sheet: string, put: (area: string, key: string, value: unknown) => void) {
    const drawing = pkg.xml(part);
    const rels = pkg.rels(part);
    const at = (anchor: XmlElement) => { const from = child(anchor, 'from'); return from ? `${child(from, 'col')?.text}:${child(from, 'row')?.text}` : 'absolute'; };
    for (const anchor of drawing?.children ?? []) {
        if (!/Anchor$/.test(anchor.local)) continue;
        const where = `${sheet}@${at(anchor)}`;
        const pic = child(anchor, 'pic');
        const frame = child(anchor, 'graphicFrame');
        if (pic) {
            const embed = attr(child(child(pic, 'blipFill'), 'blip'), 'embed');
            const media = embed ? rels.get(embed)?.target : undefined;
            if (media) pkg.read.add(media);
            put('picture', where, { bytes: media && pkg.files[media] ? bytesId(pkg.files[media]) : 'missing', name: attr(child(child(pic, 'nvPicPr'), 'cNvPr'), 'descr') });
        } else if (frame) {
            const chartRef = frame.children.length ? findDeep(frame, 'chart') : undefined;
            const id = chartRef && attr(chartRef, 'id');
            const chart = id ? rels.get(id)?.target : undefined;
            put('chart', where, chart ? chartSummary(pkg, chart) : 'graphic-frame');
        } else {
            put('shape', where, { kind: anchor.children.filter(c => !['from', 'to', 'pos', 'ext', 'clientData'].includes(c.local)).map(c => c.local), text: allText(anchor).trim() });
        }
    }
}
function findDeep(element: XmlElement, local: string): XmlElement | undefined {
    for (const c of element.children) { if (c.local === local) return c; const deep = findDeep(c, local); if (deep) return deep; }
    return undefined;
}
function chartSummary(pkg: Package, part: string) {
    const chart = pkg.xml(part);
    const plot = findDeep(chart ?? NONE, 'plotArea');
    const kinds = (plot?.children ?? []).filter(c => /Chart$/.test(c.local));
    return json({
        title: allText(findDeep(child(chart ?? undefined, 'chart') ?? NONE, 'title') ?? undefined).trim(),
        kinds: kinds.map(k => ({ kind: k.local, grouping: attr(child(k, 'grouping'), 'val'), dir: attr(child(k, 'barDir'), 'val'),
            series: children(k, 'ser').map(s => ({ name: formula(findDeep(child(s, 'tx') ?? NONE, 'f')?.text) ?? allText(child(s, 'tx')).trim(), categories: formula(findDeep(child(s, 'cat') ?? NONE, 'f')?.text), values: formula(findDeep(child(s, 'val') ?? child(s, 'yVal') ?? NONE, 'f')?.text) })) })),
        legend: attr(child(findDeep(chart ?? NONE, 'legend') ?? undefined, 'legendPos'), 'val'),
    });
}

/** Every item the comparison looks at, for one package. Throws on a package it cannot read. */
export function readWorkbook(bytes: Uint8Array): Inventory {
    const pkg = new Package(bytes);
    const out: Inventory = new Map();
    const put = (area: string, key: string, value: unknown) => {
        const text = typeof value === 'string' ? value : json(value);
        if (text === undefined || text === '[]' || text === '{}') return;
        out.set(`${area}|${key}`, text);
    };
    const workbook = [...pkg.rels('').values()].find(r => r.kind === 'officeDocument')?.target;
    if (!workbook || !pkg.xml(workbook)) throw new Error('No workbook part');
    const wb = pkg.xml(workbook)!;
    const wbRels = pkg.rels(workbook);
    const styles = readStyles(pkg, workbook);
    const sst = pkg.related(workbook, 'sharedStrings')[0];
    const strings = children(sst ? pkg.xml(sst) ?? undefined : undefined, 'si');
    const sheets = children(child(wb, 'sheets'), 'sheet');
    put('workbook', 'sheets', sheets.map(s => [attr(s, 'name'), attr(s, 'state') ?? 'visible']));
    put('workbook', 'date1904', attr(child(wb, 'workbookPr'), 'date1904'));
    put('workbook', 'protection', norm(child(wb, 'workbookProtection')?.attrs, DEFAULTS.workbookProtection));
    // "Read-only recommended" and a password to modify (review #4).
    put('workbook', 'fileSharing', norm(child(wb, 'fileSharing')?.attrs, { readOnlyRecommended: '0' }));
    put('workbook', 'extensions', children(child(wb, 'extLst'), 'ext').map(e => attr(e, 'uri')).sort());
    for (const name of children(child(wb, 'definedNames'), 'definedName')) {
        // The hidden autofilter range Excel keeps for itself; a writer may leave it out and Excel rebuilds it.
        if (attr(name, 'name') === '_xlnm._FilterDatabase') continue;
        const scope = attr(name, 'localSheetId');
        put('name', `${scope === undefined ? '' : attr(sheets[Number(scope)], 'name') + '!'}${attr(name, 'name')}`, { value: formula(name.text), hidden: bool(attr(name, 'hidden')) === '1' ? '1' : undefined });
    }
    sheets.forEach(s => {
        const target = wbRels.get(String(attr(s, `r:id`) ?? attr(s, 'id')));
        if (target && !target.external) readSheet(pkg, target.target, String(attr(s, 'name')), styles, strings, put);
    });
    for (const r of wbRels.values()) if (r.external) put('external-link', r.kind, r.target);
    const core = pkg.xml([...pkg.rels('').values()].find(r => r.kind === 'core-properties')?.target ?? '');
    for (const field of ['title', 'subject', 'creator', 'keywords', 'description', 'category', 'created']) put('document', field, child(core ?? undefined, field)?.text);
    const custom = pkg.xml([...pkg.rels('').values()].find(r => r.kind === 'custom-properties')?.target ?? '');
    for (const p of children(custom ?? undefined, 'property')) put('custom-property', String(attr(p, 'name')), allText(p));
    // What else the package carries, by kind: parts nothing above reads still count here.
    const kinds = new Map<string, number>();
    for (const [name, type] of pkg.types) if (!pkg.read.has(name) && !name.endsWith('.rels')) kinds.set(type, (kinds.get(type) ?? 0) + 1);
    for (const [type, count] of kinds) put('part-kind', type, String(count));
    return out;
}

/** Whether `ref` (A1) lies in `range` (A1:B2). */
function within(ref: string, range: string) {
    const [a, b = a] = range.split(':').map(splitRef);
    const at = splitRef(ref);
    return !!(a && b && at && at.row >= a.row && at.row <= b.row && at.col >= a.col && at.col <= b.col);
}
/**
 * What `after` says about a cell, as far as `before` can tell: a formula `before` stored without its
 * result gets one when the engine calculates it (not a change), and so do the cells an array formula fills.
 */
function relaxCell(key: string, before: string | undefined, after: string | undefined, arrays: Map<string, string[]>) {
    if (after === undefined) return after;
    const a = JSON.parse(after);
    if (before === undefined) {
        const [sheet, ref] = key.split('!');
        return !a.formula && (arrays.get(sheet) ?? []).some(range => within(ref, range)) ? undefined : after;
    }
    const b = JSON.parse(before);
    if (b.formula !== undefined && b.value === undefined) { delete a.value; a.kind = b.kind; }
    return json(a);
}

export function compareInventories(before: Inventory, after: Inventory): Difference[] {
    const arrays = new Map<string, string[]>();
    for (const [key, value] of before) {
        if (!key.startsWith('cell|')) continue;
        const range = JSON.parse(value).array;
        if (range) { const sheet = key.slice(5, key.lastIndexOf('!')); arrays.set(sheet, [...(arrays.get(sheet) ?? []), range]); }
    }
    const seen = (key: string) => key.startsWith('cell|') ? relaxCell(key.slice(5), before.get(key), after.get(key), arrays) : after.get(key);
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    return keys.filter(key => before.get(key) !== seen(key)).map(key => {
        const at = key.indexOf('|');
        return { area: key.slice(0, at), key: key.slice(at + 1), before: before.get(key), after: after.get(key) };
    });
}
export const compareWorkbooks = (before: Uint8Array, after: Uint8Array) => compareInventories(readWorkbook(before), readWorkbook(after));
