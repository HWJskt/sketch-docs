import { mount, unmount } from 'svelte';
import HomeAbout from './HomeAbout.svelte';
import './offline';
import { engineOrder, mayPreload, preloader } from './engines';
import { modeFromPath } from './routes';

const about = mount(HomeAbout, {target: document.getElementById('product-about')!});
// Fill the HTTP cache while the user reads the start page.
if (import.meta.env.PROD && mayPreload()) {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 500));
    idle(() => { void preloader.background(engineOrder()).catch(() => {}); });
}

// Choosing a format opens the editor in this document instead of loading a new page, so the
// downloads already under way continue (a page load would cancel them and start over).
let opening = false;
document.querySelector('.start-options')!.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a.start-card');
    const mouse = event as MouseEvent;
    if (!link || opening || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    event.preventDefault();
    opening = true;
    const mode = modeFromPath(new URL(link.href).pathname);
    history.pushState({mode}, '', link.href);
    void import('./EditorShell.svelte').then(({ default: EditorShell }) => {
        void unmount(about);
        const app = document.getElementById('app')!;
        app.replaceChildren();
        mount(EditorShell, { target: app, props: { initialMode: mode } });
    }, () => { location.assign(link.href); });
});
