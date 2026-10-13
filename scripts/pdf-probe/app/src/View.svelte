<script>
    import { Document, Viewer } from 'svelte-pdf-mini';
    import 'svelte-pdf-mini/styles.css';
    let { src, password } = $props();
    const onLoad = doc => { window.__probe = { loaded: true, numPages: doc.numPages }; };
    const onError = error => { window.__probe = { loaded: false, error: String(error?.message ?? error) }; };
</script>

<Document.Root {src} {password} {onLoad} {onError}>
    <Viewer.Root style="height:100vh">
        <Viewer.Viewport style="height:100%">
            <Viewer.Pages>
                {#snippet children({ pageNumber })}
                    <Viewer.Page {pageNumber}><Viewer.Canvas /><Viewer.TextLayer /></Viewer.Page>
                {/snippet}
            </Viewer.Pages>
        </Viewer.Viewport>
    </Viewer.Root>
</Document.Root>
