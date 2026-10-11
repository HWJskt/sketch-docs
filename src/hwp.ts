import { mount } from 'svelte';
import HangulEditor from './HangulEditor.svelte';
import './offline';
mount(HangulEditor, {target: document.getElementById('app')!, props: {startNew:true}});
