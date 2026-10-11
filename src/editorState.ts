export interface EditorStatus { ready: boolean; busy: boolean; dirty: boolean; name: string }
export interface HangulInput { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null }
export interface WordHost { state(): EditorStatus; about(): void }
export interface ShellHost {
    wordState(state: EditorStatus): void;
    openHangul(file?: HangulInput): Promise<void>;
}
declare global {
    interface Window { sketchShell?: ShellHost; sketchWord?: WordHost }
}
