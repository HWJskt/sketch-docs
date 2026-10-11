// One worker owns the shell and Word engine; embedded engines must not replace it.
export const offlineReady = (async () => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
            const finish = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', finish); resolve(); };
            const timer = setTimeout(finish, 3000);
            navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
        });
    } catch { /* Online use does not require offline storage. */ }
})();
