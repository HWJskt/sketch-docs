import { mount, unmount } from 'svelte';
import HomeAbout from './HomeAbout.svelte';
import './offline';
import { engineOrder, mayPreload, preloader } from './engines';
import { isHomePath, modeFromPath } from './routes';

const about = mount(HomeAbout, {target: document.getElementById('product-about')!});
// Fill the HTTP cache while the user reads the start page.
if (import.meta.env.PROD && mayPreload()) {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 500));
    idle(() => { void preloader.background(engineOrder()).catch(() => {}); });
}

// Choosing a format opens the editor in this document instead of loading a new page, so the
// downloads already under way continue (a page load would cancel them and start over).
let attempt = 0, loading = false, mounted = false;
function openEditor(href: string, push: boolean) {
    const mode = modeFromPath(new URL(href).pathname);
    if (push) history.pushState({mode}, '', href);
    const mine = ++attempt;
    loading = true;
    void import('./EditorShell.svelte').then(({ default: EditorShell }) => {
        if (mine !== attempt) return;
        loading = false; mounted = true;
        void unmount(about);
        const app = document.getElementById('app')!;
        app.replaceChildren();
        mount(EditorShell, { target: app, props: { initialMode: mode } });
    }, () => { if (mine === attempt) location.assign(href); });
}
document.querySelector('.start-options')!.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a.start-card');
    const mouse = event as MouseEvent;
    if (!link || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    event.preventDefault();
    if (!loading) openEditor(link.href, true);
});
// Until the editor is mounted (EditorShell then owns history): Back cancels a choice still loading,
// and Forward after returning to the start page reopens the editor.
addEventListener('popstate', () => {
    if (mounted) return;
    if (isHomePath(location.pathname)) { attempt++; loading = false; }
    else openEditor(location.href, false);
});
