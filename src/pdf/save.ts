// The PDF save transaction (docs/plans/2026-10-13-pdf-viewer.md, "트랜잭션"). Saves in a tab run one at a
// time. Each export is checked in the worker first; the file is then written inside a lock shared by every
// tab, after re-checking that it still has the content this editor opened or last saved. Before the first
// overwrite of a file in this session, its original bytes go to the recovery store; if that fails, nothing
// is written. The caller applies a result only to the same document (epoch) it was started for.
import type { Annotation } from 'svelte-pdf-mini';
import { fingerprint, writeIfUnchanged } from '../fileAccess';
import type { ExportResult } from './exporter';
import { writeNewFile, type NewFileTarget } from './newFile';

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
    /** The file's bytes as opened or last saved: what the export starts from. */
    original: Uint8Array;
    annotations: Annotation[];
    /** Page-save picker: disk bytes for verified recovery, distinct from the reconstructed export input. */
    pickerOriginal?: Uint8Array;
    /** Page reconstruction can only write a new target. */
    allowOverwrite?: boolean;
    /** Confirm actual reconstruction losses after validation, before opening any picker. */
    confirm?: () => Promise<boolean>;
    /** For new directory targets only: the document can change while selection or the lock is pending. */
    isCurrent?: () => boolean;
    /**
     * Asked after validation. Annotation-only saves retain the existing save picker; reconstructed pages
     * choose a directory and unused name, resolved inside the lock. Null means the user cancelled.
     */
    target: () => Promise<SaveTarget | NewFileTarget | PickedTarget | null>;
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
        let target: SaveTarget | NewFileTarget | PickedTarget | null;
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
                    const handle = (selected as PickedTarget).handle;
                    const write = async (bytes: Uint8Array<ArrayBuffer>) => {
                        const stream = await handle.createWritable();
                        try { await stream.write(bytes); await stream.close(); }
                        catch (error) { await stream.abort().catch(() => undefined); throw error; }
                    };
                    // No epoch/identity/hash checks after selection: Chromium may already have emptied it.
                    try { await write(output); }
                    catch (error) {
                        try { await write(original); }
                        catch (restoreError) { return refused(`PDF 저장에 실패했고 원본 바이트 되쓰기도 실패했습니다. ${message(error)} / ${message(restoreError)} 저장 전 원본 복원에서 보관한 사본을 복원하세요.`); }
                        return refused(`PDF 저장에 실패하여 선택한 파일을 원본 바이트로 되돌렸습니다. ${message(error)}`);
                    }
                    return { ok: true, epoch: job.epoch, revision: job.revision, bytes: result.bytes, hash, handle };
                });
            }
            target = await job.target();
        }
        catch (error) { return refused(message(error)); }
        if (!target) return { ok: false, epoch: job.epoch, revision: job.revision, reason: '', cancelled: true };
        if ('picked' in target) return refused('복구 원본 없이 저장 선택기를 사용할 수 없습니다.');
        if ('overwrite' in target && target.overwrite && job.allowOverwrite === false) return refused('페이지를 편집한 문서는 다른 이름으로 저장해야 합니다.');
        const chosen = target;
        let handle: FileSystemFileHandle | null;
        try {
            handle = await lock(async () => {
                if ('directory' in chosen) {
                    if (job.isCurrent && !job.isCurrent()) return null;
                    return writeNewFile(chosen, new Uint8Array(result.bytes), job.isCurrent);
                }
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
        if (!handle) return { ok: false, epoch: job.epoch, revision: job.revision, reason: '', cancelled: true };
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
