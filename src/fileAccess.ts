// File System Access helpers shared by the Hangul and PDF editors. scripts/build-engines.mjs copies this
// file into the Word engine with the Hangul editor, so it must not import anything outside src/.
export type PickerWindow = Window & {
    showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};

export async function fingerprint(file: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Replaces the file's contents only if it still matches `expectedHash` (what this editor opened or last
 * saved). The file changes only when the writable stream closes; a failed write is aborted.
 */
export async function writeIfUnchanged(handle: FileSystemFileHandle, bytes: Uint8Array<ArrayBuffer>, expectedHash: string) {
    if (await fingerprint(await handle.getFile()) !== expectedHash) {
        throw new Error('파일이 외부에서 변경되었습니다. 다른 이름으로 저장하세요.');
    }
    const writable = await handle.createWritable();
    try {
        await writable.write(bytes);
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
    }
}
