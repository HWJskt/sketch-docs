import { createPreloader, type Engine } from './enginePreload';
// One preloader per page: the start page fills the HTTP cache, the editor page waits on it.
export const preloader = createPreloader({ base: new URL('./', document.baseURI).href });

const LAST = 'sketch-docs-last-engine';
// Excel (21MB) is fetched only when chosen (2026-10-15 user decision), so it is not preloaded.
const ENGINES: Engine[] = ['word', 'hwp', 'pdf'];
export function rememberEngine(engine: Engine) {
    try { localStorage.setItem(LAST, engine); } catch { /* storage is a convenience */ }
}
/** The editor used last in this browser first, then the default order. */
export function engineOrder(): Engine[] {
    let last: string | null = null;
    try { last = localStorage.getItem(LAST); } catch { /* storage is a convenience */ }
    return ENGINES.includes(last as Engine) ? [last as Engine, ...ENGINES.filter(engine => engine !== last)] : ENGINES;
}
/** Background downloads cost data the user did not ask for; skip them on Save-Data and 2G connections. */
export function mayPreload(connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection) {
    return !connection?.saveData && !/(?:^|-)2g$/.test(connection?.effectiveType ?? '');
}
