// The six annotation kinds of the plan (highlight, underline, strike-out, note, pen, rectangle) on fixture A page 1.
const at = '2026-10-13T00:00:00.000Z';
const base = (id, kind, rect, color, extra = {}) => ({ id, kind, page: 1, rect, color, opacity: 1, createdAt: at, modifiedAt: at, origin: 'local', ...extra });
const quad = ([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1];
export const ANNOTATIONS = [
    base('probe-highlight', 'highlight', [72, 712, 300, 740], [1, 0.9, 0.2], { quads: [quad([72, 712, 300, 740])] }),
    base('probe-underline', 'underline', [72, 672, 260, 700], [0.1, 0.4, 1], { quads: [quad([72, 672, 260, 700])] }),
    base('probe-strikeout', 'strikeout', [72, 590, 260, 610], [1, 0.1, 0.1], { quads: [quad([72, 590, 260, 610])] }),
    base('probe-note', 'note', [400, 500, 420, 520], [1, 0.6, 0], { contents: 'probe note 메모' }),
    base('probe-ink', 'ink', [100, 300, 200, 400], [0, 0.5, 0], { paths: [{ points: [[100, 300], [150, 360], [200, 400]] }], width: 2 }),
    base('probe-rect', 'rect', [300, 300, 400, 380], [0.5, 0, 0.5], { width: 2 }),
];
/** Differences between written and read annotations (kind, rect within 0.01, color, contents). */
export function compare(written, read) {
    const problems = [];
    for (const want of written) {
        const got = read.find(item => item.id === want.id);
        if (!got) { problems.push(`${want.id}: missing`); continue; }
        if (got.kind !== want.kind) problems.push(`${want.id}: kind ${got.kind}`);
        if (got.rect.some((value, i) => Math.abs(value - want.rect[i]) > 0.01)) problems.push(`${want.id}: rect ${got.rect}`);
        if (got.color.some((value, i) => Math.abs(value - want.color[i]) > 0.01)) problems.push(`${want.id}: color ${got.color}`);
        if ((got.contents ?? '') !== (want.contents ?? '')) problems.push(`${want.id}: contents ${got.contents}`);
    }
    return problems;
}
