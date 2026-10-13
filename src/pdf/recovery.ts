// Copies of PDFs as they were before this editor first overwrote them in a session, kept in the origin
// private file system (docs/plans/2026-10-13-pdf-viewer.md, "복구 사본"): the newest per file and five in all.
// A file is its name and original content (its hash): two folders' report.pdf are different files, and a
// handle is not stable across sessions. A copy counts only once it was read back with the expected hash.
import { fingerprint } from '../fileAccess';
import type { RecoveryStore } from './save';

export const RECOVERY_FOLDER = 'sketch-docs-recovery';
export const RECOVERY_LIMIT = 5;
export interface RecoveryCopy { file: string; name: string; savedAt: number; hash: string }

const parse = (file: string): RecoveryCopy | null => {
    const match = /^(\d+)--([0-9a-f]{16})--(.+)$/.exec(file);
    if (!match) return null;
    try { return { file, name: decodeURIComponent(match[3]), savedAt: Number(match[1]), hash: match[2] }; } catch { return null; }
};

export function createRecoveryStore(root: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory()) {
    const folder = async () => (await root()).getDirectoryHandle(RECOVERY_FOLDER, { create: true });
    // Strictly increasing, so two copies kept in the same millisecond get different names.
    let last = 0;
    async function list(): Promise<RecoveryCopy[]> {
        const copies: RecoveryCopy[] = [];
        for await (const [file, entry] of (await folder()) as unknown as AsyncIterable<[string, FileSystemHandle]>) {
            const copy = entry.kind === 'file' ? parse(file) : null;
            if (copy) copies.push(copy);
        }
        return copies.sort((a, b) => b.savedAt - a.savedAt);
    }
    const store: RecoveryStore & { list: typeof list; read(file: string): Promise<File> } = {
        async keep(name, bytes, hash) {
            const dir = await folder();
            last = Math.max(Date.now(), last + 1);
            const key = hash.slice(0, 16);
            const file = `${last}--${key}--${encodeURIComponent(name)}`;
            // Every failure removes the half-written file, so the list only ever shows verified copies.
            try {
                const handle = await dir.getFileHandle(file, { create: true });
                const stream = await handle.createWritable();
                try { await stream.write(new Uint8Array(bytes)); await stream.close(); }
                catch (error) { await stream.abort().catch(() => undefined); throw error; }
                if (await fingerprint(await handle.getFile()) !== hash) throw new Error('보관한 사본이 원본과 다릅니다.');
            } catch (error) {
                await dir.removeEntry(file).catch(() => undefined);
                throw error;
            }
            // Older copies of the same file, then anything past the limit.
            const copies = await list();
            const extra = copies.filter(copy => copy.file !== file && copy.name === name && copy.hash === key);
            const rest = copies.filter(copy => !extra.includes(copy)).slice(RECOVERY_LIMIT);
            for (const copy of [...extra, ...rest]) await dir.removeEntry(copy.file).catch(() => undefined);
        },
        list,
        async read(file) { return (await (await folder()).getFileHandle(file)).getFile(); },
    };
    return store;
}
