// File System Access helpers shared by the Hangul and PDF editors. scripts/build-engines.mjs copies this
// file into the Word engine with the Hangul editor, so it must not import anything outside src/.
export type PickerWindow = Window & {
    showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};
