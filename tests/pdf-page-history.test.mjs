import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageHistory } from '../src/pdf/pageHistory.ts';
const initial = { pages: [{ id: 'a' }, { id: 'b' }], annotations: [], bytes: new Uint8Array([1]), edited: false, losses: [] };
test('one history restores pages and annotations together in the order they were edited', () => {
    const h = createPageHistory(initial);
    h.push({ ...h.current, annotations: [{ id: 'note', page: 2 }] });
    h.push({ ...h.current, pages: [{ id: 'b' }, { id: 'a' }], annotations: [{ id: 'note', page: 1 }], edited: true });
    h.push({ ...h.current, pages: [{ id: 'a' }], annotations: [] });
    assert.deepEqual(h.undo().annotations, [{ id: 'note', page: 1 }]);
    assert.deepEqual(h.undo().annotations, [{ id: 'note', page: 2 }]);
    assert.deepEqual(h.undo().annotations, []);
    assert.equal(h.canUndo, false);
    assert.deepEqual(h.redo().annotations, [{ id: 'note', page: 2 }]);
    h.push({ ...h.current, annotations: [{ id: 'new', page: 1 }] });
    assert.equal(h.canRedo, false);
});
test('saved snapshot remains dirty after subsequent edit, undo to saved is clean', () => {
    const h = createPageHistory(initial);
    h.push({ ...h.current, pages: [{ id: 'b' }, { id: 'a' }], edited: true });
    const saved = h.current;
    h.push({ ...h.current, annotations: [{ id: 'later', page: 1 }] });
    h.markSaved(saved);
    assert.equal(h.dirty, true);
    h.undo(); assert.equal(h.dirty, false);
    h.undo(); assert.equal(h.dirty, true);
});
