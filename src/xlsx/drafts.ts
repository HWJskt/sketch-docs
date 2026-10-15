// Copies of workbooks being edited, kept in the origin private file system so a closed or crashed tab
// can be recovered (docs/plans/2026-10-15-xlsx-edit.md §3.6). A copy is the engine's own .xlsx (a save's
// snapshot), so it loses what a save loses. Each tab writes its own copy, keyed by the file (name and the
// hash it held when opened) and the tab; while the tab lives it holds the copy's Web Lock. Only a tab that
// takes that lock may offer the copy or remove it, so a copy another tab is still editing is never touched.
import { fingerprint } from '../fileAccess';

export const DRAFT_FOLDER = 'sketch-docs-xlsx-drafts';
/** Copies past this many, oldest first, are removed when no tab holds them. */
export const DRAFT_LIMIT = 10;
/** A copy is made after this long without a change. */
export const DRAFT_IDLE_MS = 30000;

export interface DraftMeta {
    /** The file's name and the hash it held when opened (`source`). */
    name: string; source: string; tab: string;
    savedAt: number; size: number; hash: string;
    /** The engine (`version` from its ready message), its document id and epoch, and the workbook revision. */
    engine: string; docUid: number; epoch: number; rev: number;
    /** How long the snapshot took, in milliseconds. */
    snapshotMs: number;
}
export interface Draft extends DraftMeta { key: string }
/** Holding a copy's lock; call to let it go. */
export type Release = () => void;

export const draftKey = (name: string, source: string, tab: string) => `${source.slice(0, 16)}--${tab}--${encodeURIComponent(name)}`;
export const draftLock = (key: string) => `sketch-docs-xlsx-draft@${key}`;

/** Takes a copy's lock and keeps it until released; with `ifAvailable`, null when another holds it. */
export function holdLock(key: string, ifAvailable = false, locks: LockManager = navigator.locks): Promise<Release | null> {
    return new Promise((resolve, reject) => {
        let release!: Release;
        const held = new Promise<void>(done => { release = done; });
        locks.request(draftLock(key), { ifAvailable }, lock => {
            if (!lock) { resolve(null); return; }
            resolve(release);
            return held;
        }).catch(reject);
    });
}

export function createDraftStore(root: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(), locks: LockManager = navigator.locks) {
    const folder = async () => (await root()).getDirectoryHandle(DRAFT_FOLDER, { create: true });
    async function writeFile(dir: FileSystemDirectoryHandle, file: string, data: Uint8Array | string) {
        const stream = await (await dir.getFileHandle(file, { create: true })).createWritable();
        try { await stream.write(typeof data === 'string' ? data : new Uint8Array(data)); await stream.close(); }
        catch (error) { await stream.abort().catch(() => undefined); throw error; }
    }
    async function list(): Promise<Draft[]> {
        const dir = await folder();
        const drafts: Draft[] = [];
        for await (const [file, entry] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
            if (entry.kind !== 'file' || !file.endsWith('.json')) continue;
            try {
                const meta = JSON.parse(await (await (await dir.getFileHandle(file)).getFile()).text()) as DraftMeta;
                if (typeof meta.name === 'string' && typeof meta.source === 'string' && typeof meta.hash === 'string') drafts.push({ ...meta, key: file.slice(0, -5) });
            } catch { /* a copy whose description cannot be read is not offered */ }
        }
        return drafts.sort((a, b) => b.savedAt - a.savedAt);
    }
    async function remove(key: string) {
        const dir = await folder();
        // The description goes first: without it the copy is no longer listed.
        await dir.removeEntry(`${key}.json`).catch(() => undefined);
        await dir.removeEntry(`${key}.xlsx`).catch(() => undefined);
    }
    return {
        list,
        remove,
        /**
         * Writes this tab's copy (the caller holds its lock). The workbook is read back before its description
         * is written, so a listed copy always reads back as written. Then copies past the limit that no tab
         * holds are removed.
         */
        async write(key: string, meta: Omit<DraftMeta, 'size' | 'hash' | 'savedAt'>, bytes: Uint8Array) {
            const dir = await folder();
            const hash = await fingerprint(new Blob([new Uint8Array(bytes)]));
            await writeFile(dir, `${key}.xlsx`, bytes);
            if (await fingerprint(await (await dir.getFileHandle(`${key}.xlsx`)).getFile()) !== hash) {
                await remove(key);
                throw new Error('복구 사본이 쓴 내용과 다릅니다.');
            }
            await writeFile(dir, `${key}.json`, JSON.stringify({ ...meta, savedAt: Date.now(), size: bytes.byteLength, hash } satisfies DraftMeta));
            for (const old of (await list()).slice(DRAFT_LIMIT)) {
                if (old.key === key) continue;
                const release = await holdLock(old.key, true, locks);
                if (!release) continue;
                try { await remove(old.key); } finally { release(); }
            }
            // A workbook left without its description (a tab closed between the two writes or removes) is never
            // listed: it goes once no tab holds it (review 2026-10-16 #7).
            const described = new Set((await list()).map(d => d.key));
            const orphans: string[] = [];
            for await (const [file, entry] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
                if (entry.kind === 'file' && file.endsWith('.xlsx') && !described.has(file.slice(0, -5)) && file.slice(0, -5) !== key) orphans.push(file.slice(0, -5));
            }
            for (const orphan of orphans) {
                const release = await holdLock(orphan, true, locks);
                if (!release) continue;
                try { await remove(orphan); } finally { release(); }
            }
        },
        /** A copy's workbook, if it still reads back as written. */
        async read(draft: Draft): Promise<Uint8Array> {
            const file = await (await (await folder()).getFileHandle(`${draft.key}.xlsx`)).getFile();
            if (await fingerprint(file) !== draft.hash) throw new Error('복구 사본이 손상되었습니다.');
            return new Uint8Array(await file.arrayBuffer());
        },
        /**
         * The newest copy of this file (name and source hash) that no tab holds, with its lock now held by the
         * caller; `except` is the caller's own copy. Null when there is none.
         */
        async claim(name: string, source: string, except?: string): Promise<{ draft: Draft; release: Release } | null> {
            for (const draft of await list()) {
                if (draft.name !== name || draft.source !== source || draft.key === except) continue;
                const release = await holdLock(draft.key, true, locks);
                if (!release) continue;
                // Its tab may have removed it and let the lock go since the list was read.
                if ((await list()).some(d => d.key === draft.key)) return { draft, release };
                release();
            }
            return null;
        },
    };
}
export type DraftStore = ReturnType<typeof createDraftStore>;
