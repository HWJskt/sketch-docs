import { fingerprint } from '../fileAccess';

export interface NewFileTarget { directory: FileSystemDirectoryHandle; name: string }

export function newPdfName(value: string): string {
    const name = value.trim();
    if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name)) throw new Error('폴더 경로가 아닌 새 파일 이름을 입력하세요.');
    return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Caller holds the shared save lock throughout. The browser has no atomic create-exclusive API. */
export async function writeNewFile({ directory, name }: NewFileTarget, bytes: Uint8Array<ArrayBuffer>, isCurrent = () => true): Promise<FileSystemFileHandle> {
    name = newPdfName(name);
    const requireCurrent = () => { if (!isCurrent()) throw new Error('열린 문서가 바뀌어 저장을 중단했습니다.'); };
    requireCurrent();
    try {
        await directory.getFileHandle(name);
        throw new Error('이미 같은 이름의 파일이 있습니다. 새 이름으로 저장하세요.');
    } catch (error) {
        if ((error as DOMException)?.name !== 'NotFoundError') throw error;
    }
    requireCurrent();
    const handle = await directory.getFileHandle(name, { create: true });
    const initial = await handle.getFile();
    const emptyHash = await fingerprint(new Blob([]));
    if (initial.size !== 0) throw new Error('파일을 만드는 동안 같은 이름의 파일이 생겼습니다. 새 이름으로 저장하세요.');
    const unchanged = async () => {
        requireCurrent();
        const current = await directory.getFileHandle(name);
        const file = await handle.getFile();
        if (!await handle.isSameEntry(current) || file.lastModified !== initial.lastModified || await fingerprint(file) !== emptyHash) {
            throw new Error('파일이 외부에서 변경되었습니다. 새 이름으로 저장하세요.');
        }
        requireCurrent();
    };
    await unchanged();
    // Exclusive streams prevent another browser writer. They cannot lock out external OS programs.
    const options = { mode: 'exclusive' as const, keepExistingData: false };
    const writable = await handle.createWritable(options);
    try {
        await unchanged();
        await writable.write(bytes);
        await unchanged();
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => undefined);
        // Never delete this name on failure: another program may now own its contents.
        throw error;
    }
    return handle;
}
