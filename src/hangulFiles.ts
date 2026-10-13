import { writeIfUnchanged } from './fileAccess';

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

export async function writeArtifact(handle: FileSystemFileHandle, artifact: HangulArtifact, expectedHash: string) {
    if (artifact.contentLoss.schemaVersion !== 1 || artifact.contentLoss.count !== 0 || artifact.contentLoss.losses.length) {
        throw new Error('내용 손실이 보고되어 저장을 중단했습니다. 원본과 편집 내용은 유지됩니다.');
    }
    await writeIfUnchanged(handle, new Uint8Array(artifact.bytes), expectedHash);
}
