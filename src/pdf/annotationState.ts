// Whether the PDF editor has annotations the opened file does not have yet. Compared by content, so undoing
// back to the saved state is clean again. Annotations already in the file and not written by us ("foreign")
// are read-only in this editor (docs/plans/2026-10-13-pdf-viewer.md, preservation check) and not compared.
import type { Annotation } from 'svelte-pdf-mini';

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
    return value;
}
export function annotationKey(list: readonly Annotation[]): string {
    return JSON.stringify(list.filter(item => item.origin !== 'foreign').map(canonical).sort((a, b) => String((a as Annotation).id).localeCompare(String((b as Annotation).id))));
}
export function createDirtyTracker() {
    let saved = annotationKey([]);
    return {
        /** The annotations now in the file (after opening or saving). */
        reset(list: readonly Annotation[]) { saved = annotationKey(list); },
        isDirty(list: readonly Annotation[]) { return annotationKey(list) !== saved; },
    };
}
