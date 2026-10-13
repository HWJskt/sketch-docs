import { exportPdf, importAnnotations, saveSupport } from 'svelte-pdf-mini/pdf-codec';
import { ANNOTATIONS, compare } from './annotations.js';
try {
    const original = new Uint8Array(await (await fetch('/fixtures/a-basic.pdf')).arrayBuffer());
    const output = await exportPdf(original.slice(), ANNOTATIONS);
    const imported = await importAnnotations(output.slice());
    const prefix = output.length > original.length && original.every((byte, i) => output[i] === byte);
    postMessage({
        problems: compare(ANNOTATIONS, imported.annotations),
        read: imported.annotations.length, foreign: imported.foreign, warnings: imported.warnings,
        incrementalPrefix: prefix, originalBytes: original.length, outputBytes: output.length,
        saveSupport: await saveSupport(original),
    });
} catch (error) {
    postMessage({ error: String(error?.stack ?? error) });
}
