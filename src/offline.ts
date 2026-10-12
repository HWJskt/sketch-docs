// One worker owns the shell and Word engine; embedded engines must not replace it.
// Offline storage is optional: registration or a worker that never takes control must not
// hold back online editing longer than CONTROL_LIMIT_MS.
const CONTROL_LIMIT_MS = 10000;
export const offlineReady = (async () => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    const timer = setTimeout(finish, CONTROL_LIMIT_MS);
    if (container.controller) finish();
    container.addEventListener('controllerchange', () => finish(), { once: true });
    void (async () => {
        const registration = await container.register(`./sw.js?v=${encodeURIComponent(__BUILD_ID__)}`);
        const worker = registration.installing ?? registration.waiting;
        // An active worker that does not control this page (forced reload) will not claim it now.
        if (!worker) return finish();
        worker.addEventListener('statechange', () => { if (worker.state === 'redundant') finish(); });
    })().catch(finish);
    await settled;
    clearTimeout(timer);
})();
