import { createPreloader } from './enginePreload';
// One preloader per page: the start page fills the HTTP cache, the editor page waits on it.
export const preloader = createPreloader({ base: new URL('./', document.baseURI).href });
