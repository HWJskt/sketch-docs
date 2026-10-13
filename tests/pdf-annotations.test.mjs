import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationKey, createDirtyTracker } from '../src/pdf/annotationState.ts';

const at = '2026-10-13T00:00:00.000Z';
const note = (id, extra = {}) => ({ id, kind: 'note', page: 1, rect: [1, 2, 3, 4], color: [1, 0, 0], opacity: 1, createdAt: at, modifiedAt: at, ...extra });

test('adding annotations makes the document dirty; undoing back to the saved list makes it clean', () => {
    const tracker = createDirtyTracker();
    assert.equal(tracker.isDirty([]), false);
    const added = [note('a'), note('b')];
    assert.equal(tracker.isDirty(added), true);
    assert.equal(tracker.isDirty([]), false, 'undo to nothing');
    tracker.reset(added);
    assert.equal(tracker.isDirty([note('b'), note('a')]), false, 'order does not matter');
    assert.equal(tracker.isDirty([note('a'), note('b', { color: [0, 0, 1] })]), true, 'a change in any field counts');
});

test('foreign annotations (read-only, already in the file) do not count', () => {
    const tracker = createDirtyTracker();
    assert.equal(tracker.isDirty([note('existing', { origin: 'foreign' })]), false);
});

test('the key ignores object key order', () => {
    assert.equal(annotationKey([{ id: 'x', kind: 'note', page: 1 }]), annotationKey([{ page: 1, kind: 'note', id: 'x' }]));
});
