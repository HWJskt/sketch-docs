export type EditorMode = 'word' | 'hwp';
// Hosts may serve /hwp.html as /hwp (Cloudflare Pages strips .html).
export function modeFromPath(pathname: string): EditorMode {
    return /\/hwp(?:\.html)?$/.test(pathname) ? 'hwp' : 'word';
}
// The start page: '/', '/index.html' or '/index'. An editor opened from it returns here on Back.
export function isHomePath(pathname: string): boolean {
    return pathname.endsWith('/') || /\/index(?:\.html)?$/.test(pathname);
}
