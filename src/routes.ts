export type EditorMode = 'word' | 'hwp';
// Hosts may serve /hwp.html as /hwp (Cloudflare Pages strips .html).
export function modeFromPath(pathname: string): EditorMode {
    return /\/hwp(?:\.html)?$/.test(pathname) ? 'hwp' : 'word';
}
