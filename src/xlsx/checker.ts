// Sends the save check to its worker (check.worker.ts). A check that takes longer than the limit fails and
// the worker is replaced; answers after their request ended are ignored. Never rejects.
export type CheckRequest =
    | { id: number; op: 'losses'; original: Uint8Array; roundtrip: Uint8Array; warnings: string[] }
    | { id: number; op: 'structure'; bytes: Uint8Array };
export type CheckResult = { id: number; ok: true; lines: string[]; structure: string } | { id: number; ok: false; reason: string };
type Ask = { op: 'losses'; original: Uint8Array; roundtrip: Uint8Array; warnings: string[] } | { op: 'structure'; bytes: Uint8Array };

export const CHECK_LIMIT_MS = 120_000;
const startWorker = () => new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module' });

export function createChecker(start: () => Worker = startWorker, limitMs = CHECK_LIMIT_MS) {
    let worker: Worker | null = null;
    let next = 0;
    const waiting = new Map<number, { resolve: (result: CheckResult) => void; timer: ReturnType<typeof setTimeout> }>();
    const settle = (result: CheckResult) => {
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
            started.onerror = event => { if (worker === started) replace(`검사가 멈췄습니다. ${event.message ?? ''}`.trim()); };
            worker = started;
        }
        return worker;
    };
    function run(ask: Ask): Promise<CheckResult> {
        const id = ++next;
        return new Promise(resolve => {
            const timer = setTimeout(() => replace(`검사가 ${Math.round(limitMs / 1000)}초 안에 끝나지 않았습니다.`), limitMs);
            waiting.set(id, { resolve, timer });
            try { current().postMessage({ id, ...ask }); }
            catch (error) { replace(`검사를 시작하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`); }
        });
    }
    return {
        /** The opened file against the engine's snapshot of it right after opening. */
        losses: (original: Uint8Array, roundtrip: Uint8Array, warnings: string[]) => run({ op: 'losses', original, roundtrip, warnings: [...warnings] }),
        structure: (bytes: Uint8Array) => run({ op: 'structure', bytes }),
        dispose() { replace('Excel 편집기를 닫았습니다.'); },
    };
}
