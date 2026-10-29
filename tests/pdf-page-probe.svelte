<script>
    import { Annotations, Document, Viewer } from 'svelte-pdf-mini';
    let src = $state();
    let annotations = $state.raw([]);
    let store = $state();
    let imports = $state(0);
    let pageCount = $state(0);
    async function open(name) { src = new Uint8Array(await (await fetch(`/tests/fixtures/pdf/${name}`)).arrayBuffer()); }
</script>
<button onclick={() => open('a-basic.pdf')}>A</button>
<button onclick={() => open('e-image.pdf')}>E</button>
<button onclick={() => { annotations = [{ id: 'controlled', kind: 'rect', page: 1, rect: [10, 10, 40, 40], color: [1, 0, 0], origin: 'local', width: 1, opacity: 1 }]; }}>controlled</button>
<button onclick={() => store.add({ id: 'added', kind: 'rect', page: 1, rect: [50, 50, 70, 70], color: [1, 0, 0], origin: 'local', width: 1, opacity: 1 })}>add</button>
<button onclick={() => store.undo()}>undo</button>
<output data-imports={imports} data-pages={pageCount} data-ids={annotations.map(a => a.id).join(',')} data-undo={store?.canUndo ?? false}></output>
<Document.Root {src} onLoad={doc => { pageCount = doc.numPages; }}>
    <Viewer.Root>
        <Annotations.Root {annotations} bind:store importFromPdf foreign="readonly" onAnnotationsChange={list => { annotations = list; }} onImport={() => { imports++; }} />
    </Viewer.Root>
</Document.Root>
