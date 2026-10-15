// The differences between each <name>.xlsx and the <name>.roundtrip.xlsx that measure.mjs saved, again,
// without a browser (after a change to src/xlsx/compare.ts).
// node --import ./tests/ts-resolve.mjs scripts/xlsx-roundtrip/report.mjs <dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareWorkbooks } from '../../src/xlsx/compare.ts';

const dir = process.argv[2];
const short = value => (value === undefined ? '(없음)' : value.length > 300 ? value.slice(0, 300) + '…' : value);
for (const file of readdirSync(dir).filter(f => f.endsWith('.roundtrip.xlsx')).sort()) {
    const original = file.replace('.roundtrip.xlsx', '.xlsx');
    const differences = compareWorkbooks(new Uint8Array(readFileSync(join(dir, original))), new Uint8Array(readFileSync(join(dir, file))));
    console.log(`## ${original}: ${differences.length}`);
    for (const d of differences) console.log(`- ${d.area} | ${d.key}\n    전: ${short(d.before)}\n    후: ${short(d.after)}`);
}
