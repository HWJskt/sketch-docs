import { mount } from 'svelte';
import EditorShell from './EditorShell.svelte';
mount(EditorShell, { target: document.getElementById('app')!, props: { initialMode: 'pdf' } });
