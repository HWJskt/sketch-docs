export type FileShortcut = 'open' | 'save' | 'saveAs' | 'print';
export function isMacPlatform(platform: string) { return /mac|iphone|ipad|ipod/i.test(platform); }
export function fileShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing'>, mac: boolean): FileShortcut | null {
    if (event.isComposing || event.altKey || (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return null;
    const key = event.code || ({s:'KeyS', o:'KeyO', p:'KeyP', 'ㄴ':'KeyS', 'ㅐ':'KeyO', 'ㅔ':'KeyP'} as Record<string,string>)[event.key.toLowerCase()];
    if (key === 'KeyS') return event.shiftKey ? 'saveAs' : 'save';
    if (event.shiftKey) return null;
    return key === 'KeyO' ? 'open' : key === 'KeyP' ? 'print' : null;
}
export function shortcutLabel(action: FileShortcut, mac: boolean) {
    const key = action === 'open' ? 'O' : action === 'print' ? 'P' : 'S';
    return mac ? `⌘${action === 'saveAs' ? '⇧' : ''}${key}` : `Ctrl+${action === 'saveAs' ? 'Shift+' : ''}${key}`;
}
