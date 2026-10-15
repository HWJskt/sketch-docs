// The shell's side of the view-only Excel engine bridge (overlays/gridcraft/view-only.patch, sketch.rs).
// Only messages from the engine frame's window on this origin, in this protocol, are heard. The engine
// handles opens in order, so every successful answer newer than the last one applied says what it shows
// (`onShown`), even one the shell stopped waiting for; a request's promise settles only for the latest one.
export const PROTOCOL = 1;
/** The largest workbook sent to the engine; the engine refuses larger ones as well. */
export const MAX_XLSX_BYTES = 100 * 1024 * 1024;

export type OpenResult =
    | { ok: true; name: string; sheets: string[]; warnings: string[] }
    | { ok: false; code: 'password' | 'error' | 'timeout' | 'superseded' | 'not-ready' | 'too-large'; error: string };
export type Blocked = 'edit' | 'save' | 'print' | 'drop';
/** The shown workbook as the .xlsx a save writes (`docUid` names the engine's document). */
export type SnapshotResult =
    | { ok: true; docUid: number; bytes: Uint8Array }
    | { ok: false; code: 'error' | 'timeout' | 'not-ready'; error: string };

interface Pending { requestId: number; epoch: number; resolve: (result: OpenResult) => void; timer: ReturnType<typeof setTimeout> }

export function createXlsxBridge({ target, origin, timeoutMs = 60000, onReady = () => {}, onFailed = () => {}, onBlocked = () => {}, onShown = () => {} }: {
    /** The engine frame's window, if it exists. */
    target: () => Window | null | undefined;
    origin: string;
    timeoutMs?: number;
    onReady?: (version: string) => void;
    onFailed?: (error: string) => void;
    onBlocked?: (action: Blocked) => void;
    /** The engine now shows this workbook (a successful answer newer than any applied before). */
    onShown?: (result: Extract<OpenResult, { ok: true }>) => void;
}) {
    let ready = false, requestId = 0, epoch = 0, applied = 0;
    let pending: Pending | undefined;
    const snapshots = new Map<number, { epoch: number; resolve: (result: SnapshotResult) => void; timer: ReturnType<typeof setTimeout> }>();
    const settleSnapshot = (id: number, result: SnapshotResult) => {
        const waiting = snapshots.get(id);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        snapshots.delete(id);
        waiting.resolve(result);
    };
    const settle = (result: OpenResult) => {
        if (!pending) return;
        clearTimeout(pending.timer);
        const { resolve } = pending;
        pending = undefined;
        resolve(result);
    };
    return {
        get ready() { return ready; },
        /** The page's `message` listener. Returns whether the message was the engine's. */
        handle(event: MessageEvent): boolean {
            const source = target();
            if (!source || event.source !== source || event.origin !== origin) return false;
            const data = event.data as Record<string, unknown> | null;
            if (!data || typeof data !== 'object' || data.protocol !== PROTOCOL || typeof data.type !== 'string') return false;
            switch (data.type) {
                case 'sketch-xlsx:ready': ready = true; onReady(String(data.version ?? '')); return true;
                case 'sketch-xlsx:failed': ready = false; onFailed(String(data.error ?? '')); settle({ ok: false, code: 'error', error: String(data.error ?? '') }); return true;
                case 'sketch-xlsx:blocked': onBlocked(String(data.action) as Blocked); return true;
                case 'sketch-xlsx:snapshot': {
                    const id = data.requestId;
                    if (typeof id !== 'number' || snapshots.get(id)?.epoch !== data.epoch) return true;
                    settleSnapshot(id, data.ok === true && data.bytes instanceof ArrayBuffer && typeof data.docUid === 'number'
                        ? { ok: true, docUid: data.docUid, bytes: new Uint8Array(data.bytes) }
                        : { ok: false, code: 'error', error: String(data.error ?? '통합 문서를 저장 형식으로 만들지 못했습니다.') });
                    return true;
                }
                case 'sketch-xlsx:opened': {
                    const id = data.requestId;
                    if (typeof id !== 'number' || id <= applied || id > requestId) return true;
                    applied = id;
                    const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
                    const result: OpenResult = data.ok === true
                        ? { ok: true, name: String(data.name ?? ''), sheets: list(data.sheets), warnings: list(data.warnings) }
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
            if (!ready || !window) return Promise.resolve({ ok: false, code: 'not-ready', error: 'Excel 보기가 아직 준비되지 않았습니다.' });
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
            const window = target();
            if (!ready || !window) return Promise.resolve({ ok: false, code: 'not-ready', error: 'Excel이 아직 준비되지 않았습니다.' });
            const id = ++requestId;
            return new Promise(resolve => {
                snapshots.set(id, { epoch, resolve, timer: setTimeout(() => settleSnapshot(id, { ok: false, code: 'timeout', error: '통합 문서를 저장 형식으로 만드는 데 시간이 너무 오래 걸립니다.' }), timeoutMs) });
                window.postMessage({ type: 'sketch-xlsx:snapshot', protocol: PROTOCOL, requestId: id, epoch }, origin);
            });
        },
        get busy() { return !!pending; },
    };
}
