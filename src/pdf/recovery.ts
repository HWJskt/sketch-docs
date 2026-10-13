// Copies of PDFs as they were before this editor first overwrote them in a session, kept in the origin
// private file system (docs/plans/2026-10-13-pdf-viewer.md, "복구 사본"): the newest per file name and five in
// all. A copy counts only once it was read back with the expected hash. "저장 전 원본 복원" offers them.
import { fingerprint } from '../fileAccess';
import type { RecoveryStore } from './save';

export const RECOVERY_FOLDER = 'sketch-docs-recovery';
export const RECOVERY_LIMIT = 5;
export interface RecoveryCopy { file: string; name: string; savedAt: number }

const parse = (file: string): RecoveryCopy | null => {
    const match = /^(\d+)--(.+)$/.exec(file);
    if (!match) return null;
    try { return { file, name: decodeURIComponent(match[2]), savedAt: Number(match[1]) }; } catch { return null; }
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
            const file = `${last}--${encodeURIComponent(name)}`;
            const handle = await dir.getFileHandle(file, { create: true });
            const stream = await handle.createWritable();
            try { await stream.write(new Uint8Array(bytes)); await stream.close(); }
            catch (error) { await stream.abort().catch(() => undefined); await dir.removeEntry(file).catch(() => undefined); throw error; }
            if (await fingerprint(await handle.getFile()) !== hash) {
                await dir.removeEntry(file).catch(() => undefined);
                throw new Error('보관한 사본이 원본과 다릅니다.');
            }
            // Older copies of the same file name, then anything past the limit.
            const copies = await list();
            const extra = copies.filter(copy => copy.file !== file && copy.name === name);
            const rest = copies.filter(copy => !extra.includes(copy)).slice(RECOVERY_LIMIT);
            for (const copy of [...extra, ...rest]) await dir.removeEntry(copy.file).catch(() => undefined);
        },
        list,
        async read(file) { return (await (await folder()).getFileHandle(file)).getFile(); },
    };
    return store;
}
