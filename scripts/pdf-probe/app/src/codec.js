const worker = new Worker(new URL('./codec.worker.js', import.meta.url), { type: 'module' });
window.__codec = new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => reject(new Error(event.message));
});
