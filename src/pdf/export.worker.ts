// Runs off the main thread: refuse protected files, write the annotations, then check the result against
// the original (src/pdf/preserve.ts). Answers { id, ok: true, bytes } or { id, ok: false, reason }.
import { exportPdf } from 'svelte-pdf-mini/pdf-codec';
import { checkPreservation } from './preserve';
import { saveBlockReason } from './protection';
import type { ExportRequest, ExportResult } from './exporter';

const post = (result: ExportResult, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(result, transfer);

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
    const { id, bytes, annotations } = event.data;
    try {
        const blocked = await saveBlockReason(bytes);
        if (blocked) return post({ id, ok: false, reason: blocked });
        const output = await exportPdf(bytes.slice(), annotations);
        const verdict = await checkPreservation(bytes, output, annotations);
        if (!verdict.ok) return post({ id, ok: false, reason: `저장하면 원본 내용이 바뀌어 저장하지 않았습니다. ${verdict.reason}` });
        post({ id, ok: true, bytes: output }, [output.buffer]);
    } catch (error) {
        post({ id, ok: false, reason: `PDF를 만들지 못했습니다. ${error instanceof Error ? error.message : String(error)}` });
    }
};
