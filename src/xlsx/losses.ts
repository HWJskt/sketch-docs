// What saving over the opened file loses, in words (docs/plans/2026-10-15-xlsx-edit.md §3.5, decision Q2 ②:
// allowed after a warning that names what goes). The differences between the opened file and the engine's
// first snapshot of it (compare.ts) are named with the element names measured in docs/xlsx-roundtrip-losses.md
// ("저장 전 경고에 쓸 요소 이름"; a test keeps the two lists the same). A difference no measured name fits
// still shows, under the name of the comparison area it is in.
import type { Difference } from './compare';
import { warningText } from './engineWarnings';

/** The measured names, as docs/xlsx-roundtrip-losses.md lists them. */
export const MEASURED = {
    conditional: '조건부 서식 규칙',
    chartKind: '차트 계열 종류(콤보 차트)',
    chartStyle: '차트 스타일',
    vertical: '셀 맞춤(세로)',
    dynamicArray: '동적 배열 수식',
    shapes: '그룹 도형·연결선',
    rich: '셀 안 부분 서식',
    cr: '줄 바꿈 문자(CR)',
    linkText: '하이퍼링크 표시 텍스트',
    protection: '시트 보호 옵션',
    pageBreaks: '인쇄 설정(자동 쪽 나눔)',
    dpi: '인쇄 설정(DPI)',
    extensions: '통합 문서 확장',
    vba: '매크로(VBA)',
    created: '만든 날짜',
    widths: '열 너비(미세)',
} as const;
/** Comparison areas without a measured loss of their own. */
const AREAS: Record<string, string> = {
    cell: '셀 값·수식', row: '행 높이·숨김', column: '열 너비·숨김', merge: '병합 셀', view: '시트 보기(틀 고정·확대 등)',
    'sheet-props': '시트 속성', print: '인쇄 설정', protection: '시트 보호', validation: '데이터 유효성', hyperlink: '하이퍼링크',
    note: '메모', thread: '스레드 댓글', table: '표', filter: '자동 필터', picture: '그림', chart: '차트', shape: '도형',
    name: '이름 정의', 'external-link': '외부 연결', document: '문서 속성', 'custom-property': '사용자 문서 속성',
    sheet: '시트', 'ignored-errors': '오류 표시 무시 설정', 'rich-text': MEASURED.rich, 'conditional-format': MEASURED.conditional, extensions: MEASURED.extensions,
};
const UNKNOWN = '이 프로그램이 알 수 없는 내용';
const UNITS: Record<string, string> = {
    [MEASURED.vertical]: '셀', [MEASURED.dynamicArray]: '셀', [MEASURED.rich]: '곳', [MEASURED.cr]: '셀', [MEASURED.widths]: '열',
    [AREAS.cell]: '셀', [AREAS.column]: '열', [MEASURED.conditional]: '범위', [MEASURED.protection]: '시트', [MEASURED.pageBreaks]: '시트', [MEASURED.dpi]: '시트',
};
/** Said once, whatever the count (they belong to the whole workbook). */
const ONCE: string[] = [MEASURED.vba, MEASURED.created];

const parse = (text: string | undefined) => { try { return text === undefined ? undefined : JSON.parse(text); } catch { return text; } };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const without = (value: Record<string, unknown> | undefined, ...keys: string[]) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));

function name(d: Difference): string | null {
    const before = parse(d.before), after = parse(d.after);
    switch (d.area) {
        case 'document': return d.key === 'created' ? MEASURED.created : AREAS.document;
        case 'workbook':
            if (d.key === 'extensions') return MEASURED.extensions;
            if (d.key === 'fileSharing') return '읽기 전용 권장·쓰기 암호';
            return d.key === 'protection' ? '통합 문서 보호' : d.key === 'date1904' ? '날짜 체계(1904)' : '시트 목록';
        case 'part-kind':
            if (/vbaProject/i.test(d.key)) return MEASURED.vba;
            if (/chartstyle|chartcolorstyle/i.test(d.key)) return MEASURED.chartStyle;
            if (/sheetMetadata/i.test(d.key)) return MEASURED.dynamicArray;
            // Excel builds the calculation chain again; it is not lost content.
            if (/calcChain/i.test(d.key)) return null;
            return UNKNOWN;
        case 'chart': return MEASURED.chartKind;
        case 'shape': return MEASURED.shapes;
        case 'protection': return MEASURED.protection;
        case 'hyperlink':
            return before && after && same(without(before, 'display'), without(after, 'display')) ? MEASURED.linkText : AREAS.hyperlink;
        case 'sheet-props':
            if (before && after && !same(before.fit, after.fit)) return MEASURED.pageBreaks;
            return AREAS['sheet-props'];
        case 'print': {
            const dpi = (v: { setup?: Record<string, unknown> } | undefined) => [v?.setup?.horizontalDpi, v?.setup?.verticalDpi];
            const rest = (v: { setup?: Record<string, unknown> } | undefined) => ({ ...v, setup: without(v?.setup, 'horizontalDpi', 'verticalDpi') });
            return !same(dpi(before), dpi(after)) && same(rest(before), rest(after)) ? MEASURED.dpi : AREAS.print;
        }
        case 'column': {
            const close = before && after && same(without(before, 'width'), without(after, 'width')) && Math.abs(Number(before.width ?? 0) - Number(after.width ?? 0)) < 0.1;
            return close ? MEASURED.widths : AREAS.column;
        }
        case 'cell': {
            if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return AREAS.cell;
            if (before.array && !after.array) return MEASURED.dynamicArray;
            if (typeof before.value === 'string' && before.value.includes('\r') && after.value === before.value.replace(/\r\n?/g, '\n') && same(without(before, 'value'), without(after, 'value'))) return MEASURED.cr;
            if (before.style !== after.style && same(without(before, 'style'), without(after, 'style'))) {
                const b = parse(before.style), a = parse(after.style);
                if (b && a && typeof b === 'object' && typeof a === 'object' && same(without(b, 'alignment'), without(a, 'alignment'))
                    && same(without(b.alignment, 'vertical'), without(a.alignment, 'vertical'))) return MEASURED.vertical;
                return '셀 서식';
            }
            return AREAS.cell;
        }
        default: return AREAS[d.area] ?? UNKNOWN;
    }
}

/**
 * The warning's lines: each name with how many places it is in, measured names first in the order above,
 * then the others, then what the engine said when it opened the file (in Korean when known, engineWarnings.ts).
 */
export function describeLosses(differences: Difference[], openWarnings: string[] = []): string[] {
    const counts = new Map<string, number>();
    for (const d of differences) {
        const n = name(d);
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const order: string[] = Object.values(MEASURED);
    const names = [...counts.keys()].sort((a, b) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99));
    return [
        ...names.map(n => (ONCE.includes(n) ? n : `${n} ${counts.get(n)}${UNITS[n] ?? '개'}`)),
        ...openWarnings.map(w => `열 때 알린 내용: ${warningText(w)}`),
    ];
}

/** Sheets (names, order, shown or hidden) and defined names: a change here can leave references elsewhere wrong. */
export function structureOf(inventory: Map<string, string>): string {
    return JSON.stringify([...inventory].filter(([key]) => key === 'workbook|sheets' || key.startsWith('name|')).sort());
}
export const STRUCTURE_WARNING = '시트 추가·삭제·이름 바꾸기·이동이나 이름 정의 변경: 다른 시트·연결된 내용의 셀 참조가 맞지 않을 수 있음';
/**
 * Always shown with the warning: row and column inserts and deletes are not detected (the engine does not
 * report which commands ran; plan §3.5 judgment 2), so the warning says what they may do.
 */
export const EDIT_NOTE = '행·열 삽입·삭제나 시트 변경을 했다면 다른 시트·연결된 내용의 셀 참조가 어긋날 수 있습니다.';
