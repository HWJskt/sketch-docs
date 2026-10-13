import { mount } from 'svelte';
import HomeAbout from './HomeAbout.svelte';
import './offline';
mount(HomeAbout, {target: document.getElementById('product-about')!});
import { engineOrder, mayPreload, preloader } from './engines';
// Fill the HTTP cache while the user reads the start page; choosing a card navigates away and stops it.
if (import.meta.env.PROD && mayPreload()) {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 500));
    idle(() => { void preloader.background(engineOrder()).catch(() => {}); });
}
