export type HangulFormat = 'hwp' | 'hwpx';
export interface DocumentVersion { epoch: number; revision: number; dirty: boolean }
export interface HangulArtifact {
    bytes: Uint8Array;
    contentLoss: { schemaVersion: number; outputFormat: HangulFormat; count: number; losses: unknown[] };
    version: DocumentVersion;
}
export interface HangulSnapshot { name: string; dirty: boolean; epoch: number; hasDocument: boolean }
export interface HangulBridge {
    snapshot(): HangulSnapshot;
    subscribe(listener: (state: HangulSnapshot) => void): () => void;
    ready: Promise<void>;
    state(): DocumentVersion;
    dirty(): boolean;
    print(): Promise<void>;
    create(): Promise<DocumentVersion>;
    open(bytes: Uint8Array, name: string): Promise<DocumentVersion>;
    export(format: HangulFormat): HangulArtifact;
    acknowledge(version: DocumentVersion, name: string): boolean;
}

export function bridgeFrom(frame: HTMLIFrameElement): HangulBridge {
    const bridge = (frame.contentWindow as (Window & { edentextHost?: HangulBridge }) | null)?.edentextHost;
    if (!bridge) throw new Error('한글 편집기를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    return bridge;
}

export type PickerWindow = Window & {
    showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};

export async function fingerprint(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function writeArtifact(handle: FileSystemFileHandle, artifact: HangulArtifact, expectedHash: string) {
    if (artifact.contentLoss.schemaVersion !== 1 || artifact.contentLoss.count !== 0 || artifact.contentLoss.losses.length) {
        throw new Error('내용 손실이 보고되어 저장을 중단했습니다. 원본과 편집 내용은 유지됩니다.');
    }
    if (await fingerprint(await handle.getFile()) !== expectedHash) {
        throw new Error('파일이 외부에서 변경되었습니다. 다른 이름으로 저장하세요.');
    }
    const writable = await handle.createWritable();
    try {
        await writable.write(new Uint8Array(artifact.bytes));
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
    }
}
