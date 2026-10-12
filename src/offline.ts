// One worker owns the shell and Word engine; embedded engines must not replace it.
// Offline storage is optional: a worker that never takes control must not hold back online editing.
const CONTROL_LIMIT_MS = 10000;
export const offlineReady = (async () => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(__BUILD_ID__)}`);
        await new Promise<void>(resolve => {
            const timer = setTimeout(finish, CONTROL_LIMIT_MS);
            function finish() { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', finish); resolve(); }
            if (navigator.serviceWorker.controller) return finish();
            navigator.serviceWorker.addEventListener('controllerchange', finish);
            const worker = registration.installing ?? registration.waiting;
            // An active worker that does not control this page (forced reload) will not claim it now.
            if (!worker) return finish();
            worker.addEventListener('statechange', () => { if (worker.state === 'redundant') finish(); });
        });
    } catch { /* Online use does not require offline storage. */ }
})();
