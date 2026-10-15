// Downloads editor engine files ahead of time into the browser HTTP cache (engines/manifest.json,
// built by scripts/engine-manifest.mjs) and reports progress while the chosen editor waits for them.
export type Engine = 'word' | 'hwp' | 'pdf' | 'xlsx';
export interface ManifestFile { path: string; bytes: number }
export interface EngineFiles { required: ManifestFile[]; warm: ManifestFile[]; requiredBytes: number }
// An engine can be missing: the dev server and builds before the PDF list existed have no `pdf` entry.
export interface Manifest { schemaVersion: number; engines: Partial<Record<Engine, EngineFiles>> }
export interface Progress { loaded: number; total: number }

// `wanted`: an editor is waiting on this file, so choosing another editor must not stop it.
interface Download { loaded: number; done: Promise<void>; controller: AbortController; wanted: boolean }
/** The file list itself could not be read; callers may open the editor without progress. */
export class ManifestError extends Error {}
type Fetch = (url: string, init: RequestInit & { priority?: 'high' | 'low' }) => Promise<Response>;

export function createPreloader({ base, fetch = globalThis.fetch.bind(globalThis), manifestLimitMs = 10000 }: { base: string; fetch?: Fetch; manifestLimitMs?: number }) {
    const downloads = new Map<string, Download>();
    let manifest: Promise<Manifest> | undefined;
    let chosen: Engine | undefined;

    function load(): Promise<Manifest> {
        // The list is optional; a request that hangs must not keep the editor closed.
        manifest ??= fetch(new URL('engines/manifest.json', base).href, { cache: 'no-cache', signal: AbortSignal.timeout(manifestLimitMs) }).then(async response => {
            if (!response.ok) throw new ManifestError(`엔진 목록을 받지 못했습니다 (${response.status}).`);
            return response.json() as Promise<Manifest>;
        }).catch(error => { manifest = undefined; throw error instanceof ManifestError ? error : new ManifestError(String(error)); });
        return manifest;
    }
    async function files(engine: Engine): Promise<EngineFiles> {
        const entry = (await load()).engines[engine];
        if (!entry) throw new ManifestError(`엔진 목록에 ${engine} 항목이 없습니다.`);
        return entry;
    }

    // One download per file; later callers share it. A failed or aborted download is forgotten so a retry starts over.
    function download(file: ManifestFile, priority: 'high' | 'low'): Download {
        const existing = downloads.get(file.path);
        if (existing) { existing.wanted ||= priority === 'high'; return existing; }
        const controller = new AbortController();
        const entry: Download = { loaded: 0, controller, done: Promise.resolve(), wanted: priority === 'high' };
        entry.done = (async () => {
            const response = await fetch(new URL(file.path, base).href, { signal: controller.signal, priority });
            if (!response.ok || !response.body) throw new Error(`엔진 파일을 받지 못했습니다 (${response.status}).`);
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                entry.loaded += value.byteLength;
            }
            entry.loaded = Math.max(entry.loaded, file.bytes);
        })().catch(error => { if (downloads.get(file.path) === entry) downloads.delete(file.path); throw error; });
        downloads.set(file.path, entry);
        return entry;
    }

    function progress(files: ManifestFile[]): Progress {
        let loaded = 0, total = 0;
        for (const file of files) { total += file.bytes; loaded += Math.min(downloads.get(file.path)?.loaded ?? 0, file.bytes); }
        return { loaded, total };
    }

    return {
        /** Fetches every engine's files one at a time at low priority until an editor is chosen. */
        async background(order: Engine[]) {
            const { engines } = await load();
            for (const engine of order) for (const file of [...engines[engine]?.required ?? [], ...engines[engine]?.warm ?? []]) {
                if (chosen) return;
                await download(file, 'low').done.catch(() => {});
            }
        },
        /**
         * Waits for the chosen engine's required files and stops background downloads of other engines
         * (files another editor is waiting on continue).
         * Its warm files continue in the background. `onProgress` fires as bytes arrive.
         */
        async prepare(engine: Engine, { onProgress = () => {}, onStall = () => {}, stallMs = 15000 }: { onProgress?: (progress: Progress) => void; onStall?: () => void; stallMs?: number } = {}) {
            chosen = engine;
            const own = await files(engine);
            const mine = new Set([...own.required, ...own.warm].map(file => file.path));
            for (const [path, entry] of downloads) if (!mine.has(path) && !entry.wanted) entry.controller.abort();
            const required = own.required;
            // A stall only informs the caller; the download keeps going until restart().
            let last = -1, since = Date.now(), warned = false;
            const report = () => {
                const current = progress(required);
                if (current.loaded !== last) { last = current.loaded; since = Date.now(); warned = false; }
                else if (!warned && current.loaded < current.total && Date.now() - since >= stallMs) { warned = true; onStall(); }
                onProgress(current);
            };
            const timer = setInterval(report, 200);
            try {
                const waits = required.map(file => download(file, 'high').done);
                for (const file of own.warm) void download(file, 'low').done.catch(() => {});
                await Promise.all(waits);
            } finally { clearInterval(timer); report(); }
        },
        /** Abandons the chosen engine's unfinished files so the next prepare() starts them again. */
        async restart(engine: Engine) {
            const own = (await load()).engines[engine];
            for (const file of [...own?.required ?? [], ...own?.warm ?? []]) {
                const entry = downloads.get(file.path);
                if (entry && entry.loaded < file.bytes) { downloads.delete(file.path); entry.controller.abort(); }
            }
        },
        progress: async (engine: Engine) => progress((await load()).engines[engine]?.required ?? []),
    };
}
