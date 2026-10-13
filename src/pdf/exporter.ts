// Sends save requests to the export worker (src/pdf/export.worker.ts). A request that takes longer than
// the limit is refused and the worker is replaced, so a stuck export cannot block later saves; answers that
// arrive after their request ended are ignored.
import type { Annotation } from 'svelte-pdf-mini';

export interface ExportRequest { id: number; bytes: Uint8Array; annotations: Annotation[] }
export type ExportResult = { id: number; ok: true; bytes: Uint8Array } | { id: number; ok: false; reason: string };
export interface WorkerLike { postMessage(message: ExportRequest): void; terminate(): void; onmessage: ((event: { data: ExportResult }) => void) | null; onerror: ((event: { message?: string }) => void) | null }

export const EXPORT_LIMIT_MS = 120_000;
const startWorker = (): WorkerLike => new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export function createExporter({ start = startWorker, limitMs = EXPORT_LIMIT_MS }: { start?: () => WorkerLike; limitMs?: number } = {}) {
    let worker: WorkerLike | null = null;
    let next = 0;
    const waiting = new Map<number, { resolve: (result: ExportResult) => void; timer: ReturnType<typeof setTimeout> }>();
    const settle = (result: ExportResult) => {
        const entry = waiting.get(result.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        waiting.delete(result.id);
        entry.resolve(result);
    };
    const replace = (reason: string) => {
        worker?.terminate();
        worker = null;
        for (const id of [...waiting.keys()]) settle({ id, ok: false, reason });
    };
    const current = () => {
        if (!worker) {
            const started = start();
            started.onmessage = event => { if (worker === started) settle(event.data); };
            started.onerror = event => { if (worker === started) replace(`PDF를 만드는 작업이 멈췄습니다. ${event.message ?? ''}`.trim()); };
            worker = started;
        }
        return worker;
    };
    return {
        /** Resolves with the saved bytes or a refusal; never rejects. */
        run(bytes: Uint8Array, annotations: Annotation[]): Promise<ExportResult> {
            const id = ++next;
            return new Promise(resolve => {
                const timer = setTimeout(() => replace(`PDF를 만드는 데 ${Math.round(limitMs / 1000)}초가 넘게 걸려 중단했습니다.`), limitMs);
                waiting.set(id, { resolve, timer });
                // Starting the worker or sending to it can throw synchronously; that is a refusal like any other.
                try { current().postMessage({ id, bytes: bytes.slice(), annotations: plain(annotations) }); }
                catch (error) { replace(`PDF를 만드는 작업을 시작하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`); }
            });
        },
        dispose() { replace('PDF 편집기를 닫았습니다.'); },
    };
}

// Plain data for postMessage: Svelte state proxies cannot be cloned.
function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
