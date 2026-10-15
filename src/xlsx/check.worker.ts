// Runs off the main thread (a workbook may be 100 MB): reads the opened file and the engine's first snapshot
// of it, and names what a save would lose (losses.ts); or reads one snapshot's structure. Answers
// { id, ok: true, lines, structure } or { id, ok: false, reason }.
import { compareInventories, readWorkbook } from './compare';
import { describeLosses, structureOf } from './losses';
import type { CheckRequest, CheckResult } from './checker';

const post = (result: CheckResult) => (self as unknown as Worker).postMessage(result);

self.onmessage = (event: MessageEvent<CheckRequest>) => {
    const { id } = event.data;
    try {
        if (event.data.op === 'losses') {
            const after = readWorkbook(event.data.roundtrip);
            post({ id, ok: true, lines: describeLosses(compareInventories(readWorkbook(event.data.original), after), event.data.warnings), structure: structureOf(after) });
        } else post({ id, ok: true, lines: [], structure: structureOf(readWorkbook(event.data.bytes)) });
    } catch (error) {
        post({ id, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
};
