// The shell's side of the Excel engine bridge (overlays/gridcraft/sketch-bridge.patch, sketch.rs). Only
// messages from the engine frame's window on this origin, in this protocol, are heard. The engine
// handles opens in order, so every successful answer newer than the last one applied says what it shows
// (`onShown`), even one the shell stopped waiting for; a request's promise settles only for the latest one.
// Editing (`&mode=edit`), the engine reports its state and asks the shell to open, save or export; a save
// takes a snapshot, and only after the file was written does the shell send `saved` for it.
export const PROTOCOL = 2;
/** The largest workbook sent to the engine; the engine refuses larger ones as well. */
export const MAX_XLSX_BYTES = 100 * 1024 * 1024;

export type OpenResult =
    | { ok: true; name: string; sheets: string[]; warnings: string[]; docUid: number }
    | { ok: false; code: 'password' | 'error' | 'timeout' | 'superseded' | 'not-ready' | 'too-large'; error: string };
export type Blocked = 'edit' | 'save' | 'print' | 'drop' | 'refused';
/** The shown workbook as the .xlsx a save writes; `id` names it for `saved`/`discard`. */
export type SnapshotResult =
    | { ok: true; id: number; docUid: number; rev: number; bytes: Uint8Array }
    | { ok: false; code: 'error' | 'timeout' | 'not-ready'; error: string };
export type ExportResult = { ok: true; bytes: Uint8Array } | { ok: false; code: 'error' | 'timeout' | 'not-ready'; error: string };
/** Editing: whether the workbook has unsaved changes, or a cell or text box is being typed in. */
export interface EngineState { dirty: boolean; editing: boolean; rev: number }
export type EngineRequest =
    | { action: 'save' | 'saveAs' | 'exportCsv' | 'exportPdf' }
    | { action: 'open'; file?: { name: string; bytes: Uint8Array } };

interface Pending { requestId: number; epoch: number; resolve: (result: OpenResult) => void; timer: ReturnType<typeof setTimeout> }
interface Waiting<T> { epoch: number; resolve: (result: T) => void; timer: ReturnType<typeof setTimeout> }

export function createXlsxBridge({ target, origin, timeoutMs = 60000, onReady = () => {}, onFailed = () => {}, onBlocked = () => {}, onShown = () => {}, onState = () => {}, onRequest = () => {} }: {
    /** The engine frame's window, if it exists. */
    target: () => Window | null | undefined;
    origin: string;
    timeoutMs?: number;
    onReady?: (version: string, mode: string) => void;
    onFailed?: (error: string) => void;
    onBlocked?: (action: Blocked, command?: string) => void;
    /** The engine now shows this workbook (a successful answer newer than any applied before). */
    onShown?: (result: Extract<OpenResult, { ok: true }>) => void;
    onState?: (state: EngineState) => void;
    onRequest?: (request: EngineRequest) => void;
}) {
    let ready = false, requestId = 0, epoch = 0, applied = 0;
    let pending: Pending | undefined;
    const settle = (result: OpenResult) => {
        if (!pending) return;
        clearTimeout(pending.timer);
        const { resolve } = pending;
        pending = undefined;
        resolve(result);
    };
    // Snapshot and export answers by request id; each must come back with the epoch it was asked in.
    const waiting = new Map<number, Waiting<never>>();
    const settleWaiting = <T>(id: number, result: T) => {
        const entry = waiting.get(id) as Waiting<T> | undefined;
        if (!entry) return;
        clearTimeout(entry.timer);
        waiting.delete(id);
        entry.resolve(result);
    };
    function ask<T>(type: string, extra: Record<string, unknown>, timeout: T): Promise<T> {
        const window = target();
        const id = ++requestId;
        return new Promise(resolve => {
            waiting.set(id, { epoch, resolve, timer: setTimeout(() => settleWaiting(id, timeout), timeoutMs) } as unknown as Waiting<never>);
            window!.postMessage({ type, protocol: PROTOCOL, requestId: id, epoch, ...extra }, origin);
        });
    }
    const notReady = { ok: false as const, code: 'not-ready' as const, error: 'Excel이 아직 준비되지 않았습니다.' };
    const buffer = (value: unknown) => (value instanceof ArrayBuffer ? new Uint8Array(value) : undefined);
    return {
        get ready() { return ready; },
        /** The page's `message` listener. Returns whether the message was the engine's. */
        handle(event: MessageEvent): boolean {
            const source = target();
            if (!source || event.source !== source || event.origin !== origin) return false;
            const data = event.data as Record<string, unknown> | null;
            if (!data || typeof data !== 'object' || data.protocol !== PROTOCOL || typeof data.type !== 'string') return false;
            switch (data.type) {
                case 'sketch-xlsx:ready': ready = true; onReady(String(data.version ?? ''), String(data.mode ?? 'view')); return true;
                case 'sketch-xlsx:failed': ready = false; onFailed(String(data.error ?? '')); settle({ ok: false, code: 'error', error: String(data.error ?? '') }); return true;
                case 'sketch-xlsx:blocked': onBlocked(String(data.action) as Blocked, typeof data.command === 'string' ? data.command : undefined); return true;
                case 'sketch-xlsx:state': onState({ dirty: data.dirty === true, editing: data.editing === true, rev: Number(data.rev) || 0 }); return true;
                case 'sketch-xlsx:request': {
                    const action = String(data.action);
                    const bytes = buffer(data.bytes);
                    if (action === 'open') onRequest(bytes ? { action, file: { name: String(data.name ?? ''), bytes } } : { action });
                    else if (action === 'save' || action === 'saveAs' || action === 'exportCsv' || action === 'exportPdf') onRequest({ action });
                    return true;
                }
                case 'sketch-xlsx:snapshot': {
                    const id = data.requestId;
                    if (typeof id !== 'number' || waiting.get(id)?.epoch !== data.epoch) return true;
                    const bytes = buffer(data.bytes);
                    settleWaiting<SnapshotResult>(id, data.ok === true && bytes && typeof data.docUid === 'number'
                        ? { ok: true, id, docUid: data.docUid, rev: Number(data.rev) || 0, bytes }
                        : { ok: false, code: 'error', error: String(data.error ?? '통합 문서를 저장 형식으로 만들지 못했습니다.') });
                    return true;
                }
                case 'sketch-xlsx:exported': {
                    const id = data.requestId;
                    if (typeof id !== 'number' || waiting.get(id)?.epoch !== data.epoch) return true;
                    const bytes = buffer(data.bytes);
                    settleWaiting<ExportResult>(id, data.ok === true && bytes ? { ok: true, bytes } : { ok: false, code: 'error', error: String(data.error ?? '내보내지 못했습니다.') });
                    return true;
                }
                case 'sketch-xlsx:opened': {
                    const id = data.requestId;
                    if (typeof id !== 'number' || id <= applied || id > requestId) return true;
                    applied = id;
                    const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
                    const result: OpenResult = data.ok === true
                        ? { ok: true, name: String(data.name ?? ''), sheets: list(data.sheets), warnings: list(data.warnings), docUid: Number(data.docUid) || 0 }
                        : { ok: false, code: data.code === 'password' ? 'password' : 'error', error: String(data.error ?? '') };
                    if (result.ok) onShown(result);
                    if (pending && id === pending.requestId && data.epoch === pending.epoch) settle(result);
                    return true;
                }
            }
            return false;
        },
        /** Sends a workbook to the engine. A newer open supersedes this one; the engine keeps the shown workbook on failure. */
        open(name: string, bytes: Uint8Array): Promise<OpenResult> {
            const window = target();
            if (!ready || !window) return Promise.resolve({ ok: false, code: 'not-ready', error: 'Excel이 아직 준비되지 않았습니다.' });
            if (bytes.byteLength > MAX_XLSX_BYTES) return Promise.resolve({ ok: false, code: 'too-large', error: `${MAX_XLSX_BYTES / 1024 / 1024}MB보다 큰 파일은 열 수 없습니다.` });
            settle({ ok: false, code: 'superseded', error: '다른 파일을 여는 중입니다.' });
            const copy = bytes.slice();
            return new Promise(resolve => {
                const request: Pending = { requestId: ++requestId, epoch: ++epoch, resolve, timer: setTimeout(() => settle({ ok: false, code: 'timeout', error: '파일을 여는 데 시간이 너무 오래 걸립니다.' }), timeoutMs) };
                pending = request;
                window.postMessage({ type: 'sketch-xlsx:open', protocol: PROTOCOL, requestId: request.requestId, epoch: request.epoch, name, bytes: copy.buffer }, origin, [copy.buffer]);
            });
        },
        /** The workbook the engine shows now, encoded as a save would write it. Answers for an older document (epoch) are ignored. */
        snapshot(): Promise<SnapshotResult> {
            if (!ready || !target()) return Promise.resolve(notReady);
            return ask<SnapshotResult>('sketch-xlsx:snapshot', {}, { ok: false, code: 'timeout', error: '통합 문서를 저장 형식으로 만드는 데 시간이 너무 오래 걸립니다.' });
        },
        /** The file now holds snapshot `id`: the engine makes it the saved state (titled `name`). Send only after the write closed. */
        saved(id: number, docUid: number, name?: string) { target()?.postMessage({ type: 'sketch-xlsx:saved', protocol: PROTOCOL, requestId: id, epoch, docUid, name }, origin); },
        /** Snapshot `id` was not written (cancelled or failed): the engine lets it go. */
        discard(id: number) { target()?.postMessage({ type: 'sketch-xlsx:discard', protocol: PROTOCOL, requestId: id }, origin); },
        /** CSV (the active sheet) or PDF bytes for a new file. */
        exportFile(format: 'csv' | 'pdf'): Promise<ExportResult> {
            if (!ready || !target()) return Promise.resolve(notReady);
            return ask<ExportResult>('sketch-xlsx:export', { format }, { ok: false, code: 'timeout', error: '내보내는 데 시간이 너무 오래 걸립니다.' });
        },
        get busy() { return !!pending; },
    };
}
