import { mount } from 'svelte';
import HomeAbout from './HomeAbout.svelte';
import './offline';
mount(HomeAbout, {target: document.getElementById('product-about')!});
