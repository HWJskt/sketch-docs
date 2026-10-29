import type { Annotation } from 'svelte-pdf-mini';
import type { PageItem } from './pages';
import { annotationKey } from './annotationState';

export interface PageSnapshot { pages: PageItem[]; annotations: Annotation[]; bytes: Uint8Array; edited: boolean; losses: string[] }
const contentKey = (s: PageSnapshot) => JSON.stringify(s.pages) + annotationKey(s.annotations);
/** One chronological history; no page/annotation undo stacks can diverge. Bytes are immutable and shared. */
export function createPageHistory(initial: PageSnapshot) {
    let past: PageSnapshot[] = [], future: PageSnapshot[] = [], current = initial;
    let saved = contentKey(initial);
    let lastGroup: string | undefined, lastTime = 0;
    return {
        get current() { return current; },
        get canUndo() { return past.length > 0; },
        get canRedo() { return future.length > 0; },
        get dirty() { return contentKey(current) !== saved; },
        markSaved(snapshot: PageSnapshot) { saved = contentKey(snapshot); },
        push(next: PageSnapshot, group?: string) {
            if (contentKey(next) === contentKey(current)) { current = next; return; }
            const now = Date.now();
            if (!group || group !== lastGroup || now - lastTime > 1000) past = [...past, current];
            lastGroup = group; lastTime = now; future = []; current = next;
        },
        undo() { lastGroup = undefined; if (past.length) { future = [current, ...future]; current = past[past.length - 1]; past = past.slice(0, -1); } return current; },
        redo() { lastGroup = undefined; if (future.length) { past = [...past, current]; current = future[0]; future = future.slice(1); } return current; },
    };
}
