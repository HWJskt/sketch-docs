// Standalone PDF editor entry (plan step 4); the shell takes it over in step 5.
import { mount } from 'svelte';
import PdfEditor from './pdf/PdfEditor.svelte';
mount(PdfEditor, { target: document.getElementById('app')! });
