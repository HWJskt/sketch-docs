// Saves are serialized per tab. Annotation-only writes retain hash checks and first-overwrite recovery.
// Page reconstruction validates and keeps the disk original before its destructive OS picker, then writes
// without post-picker refusal; failed writes retry the memory original. Both paths use the shared Web Lock.
// The caller applies a result only to the same document epoch and preserves edits after the saved snapshot.
import type { Annotation } from 'svelte-pdf-mini';
import { fingerprint, writeIfUnchanged } from '../fileAccess';
import type { ExportResult } from './exporter';

export interface SaveTarget {
    handle: FileSystemFileHandle;
    /** Hash of what the target holds now (a file chosen with a save picker: its contents after choosing). */
    hash: string;
    /** The target is the opened file: keep the original for recovery before the first write. */
    overwrite: boolean;
}
export interface PickedTarget { handle: FileSystemFileHandle; picked: true }
export interface SaveJob {
    epoch: number;
    revision: number;
    name: string;
    /** Export input: disk bytes for annotations, reconstructed bytes for page edits. */
    original: Uint8Array;
    annotations: Annotation[];
    /** Page-save picker: disk bytes for verified recovery, distinct from the reconstructed export input. */
    pickerOriginal?: Uint8Array;
    /** Confirm actual reconstruction losses after validation, before opening any picker. */
    confirm?: () => Promise<boolean>;
    /**
     * Asked after validation. Page saves additionally keep the disk original before the picker, inside
     * the shared lock. Null means the user cancelled or the document changed before choosing.
     */
    target: () => Promise<SaveTarget | PickedTarget | null>;
}
export type SaveOutcome =
    | { ok: true; epoch: number; revision: number; bytes: Uint8Array; hash: string; handle: FileSystemFileHandle }
    | { ok: false; epoch: number; revision: number; reason: string; cancelled?: true };
export interface RecoveryStore { keep(name: string, bytes: Uint8Array, hash: string): Promise<void> }
export type Lock = <T>(work: () => Promise<T>) => Promise<T>;

export const LOCK_NAME = 'sketch-docs-pdf-save';
/** Web Locks across tabs of this origin; without them (old browsers) only this tab is serialized. */
export const webLock: Lock = work => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request(LOCK_NAME, work) as ReturnType<typeof work> : work();
};

export function createSaver({ exporter, lock = webLock, recovery }: { exporter: { run(bytes: Uint8Array, annotations: Annotation[]): Promise<ExportResult> }; lock?: Lock; recovery: RecoveryStore }) {
    let queue: Promise<unknown> = Promise.resolve();
    const backedUp = new WeakSet<FileSystemFileHandle>();
    const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

    async function perform(job: SaveJob): Promise<SaveOutcome> {
        const refused = (reason: string): SaveOutcome => ({ ok: false, epoch: job.epoch, revision: job.revision, reason });
        let result: ExportResult;
        try { result = await exporter.run(job.original, job.annotations); }
        catch (error) { return refused(`PDF를 만들지 못했습니다. ${message(error)}`); }
        if (!result.ok) return refused(result.reason);
        const cancelled = (): SaveOutcome => ({ ok: false, epoch: job.epoch, revision: job.revision, reason: '', cancelled: true });
        let target: SaveTarget | PickedTarget | null;
        try {
            if (job.confirm && !await job.confirm()) return cancelled();
            if (job.pickerOriginal) {
                // Everything fallible that could refuse a save precedes the destructive picker.
                const original = new Uint8Array(job.pickerOriginal);
                const output = new Uint8Array(result.bytes);
                const hash = await fingerprint(new Blob([output]));
                const originalHash = await fingerprint(new Blob([original]));
                return await lock(async () => {
                    try { await recovery.keep(job.name, original, originalHash); }
                    catch (error) { return refused(`저장 전 원본을 보관하지 못해 저장하지 않았습니다. ${message(error)}`); }
                    const selected = await job.target();
                    if (!selected) return cancelled();
                    const handle = selected.handle;
                    const write = async (bytes: Uint8Array<ArrayBuffer>) => {
                        const stream = await handle.createWritable();
                        try { await stream.write(bytes); await stream.close(); }
                        catch (error) { await stream.abort().catch(() => undefined); throw error; }
                    };
                    // No epoch/identity/hash checks after selection: Chromium may already have emptied it.
                    try { await write(output); }
                    catch (error) {
                        try { await write(original); }
                        catch (restoreError) { return refused(`${handle.name}: PDF 저장에 실패했고 원본 바이트 되쓰기도 실패했습니다. ${message(error)} / ${message(restoreError)} 저장 전 원본 복원에서 보관한 사본을 복원하세요.`); }
                        return refused(`${handle.name}: PDF 저장에 실패하여 선택한 파일을 원본 바이트로 되돌렸습니다. ${message(error)}`);
                    }
                    return { ok: true, epoch: job.epoch, revision: job.revision, bytes: result.bytes, hash, handle };
                });
            }
            target = await job.target();
        }
        catch (error) { return refused(message(error)); }
        if (!target) return { ok: false, epoch: job.epoch, revision: job.revision, reason: '', cancelled: true };
        if ('picked' in target) return refused('복구 원본 없이 저장 선택기를 사용할 수 없습니다.');
        const chosen = target;
        let handle: FileSystemFileHandle;
        try {
            handle = await lock(async () => {
                const { handle, hash, overwrite } = chosen;
                // A file changed elsewhere is refused before the recovery store is touched.
                if (await fingerprint(await handle.getFile()) !== hash) throw new Error('파일이 외부에서 변경되었습니다. 다른 이름으로 저장하세요.');
                if (overwrite && !backedUp.has(handle)) {
                    try { await recovery.keep(job.name, job.original, await fingerprint(new Blob([new Uint8Array(job.original)]))); }
                    catch (error) { throw new Error(`저장 전 원본을 보관하지 못해 저장하지 않았습니다. ${message(error)}`); }
                    backedUp.add(handle);
                }
                await writeIfUnchanged(handle, new Uint8Array(result.bytes), hash);
                return handle;
            });
        } catch (error) {
            return refused(message(error));
        }
        return { ok: true, epoch: job.epoch, revision: job.revision, bytes: result.bytes, hash: await fingerprint(new Blob([new Uint8Array(result.bytes)])), handle };
    }

    return {
        /**
         * `job` may be a function: it is called when this save's turn comes, so a save queued behind another
         * starts from the bytes and hash that one left (the annotations it captures stay those of the request).
         */
        save(job: SaveJob | (() => SaveJob)): Promise<SaveOutcome> {
            const run = queue.then(() => perform(typeof job === 'function' ? job() : job));
            queue = run.catch(() => undefined);
            return run;
        },
    };
}
