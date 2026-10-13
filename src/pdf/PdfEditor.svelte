<script lang="ts">
    import { Document, Find, PageNav, Viewer, Zoom } from 'svelte-pdf-mini';
    import type { ZoomMode } from 'svelte-pdf-mini';
    import 'svelte-pdf-mini/styles.css';
    import { setupPdf } from './setup';
    import { messages } from './messages';
    setupPdf();

    interface Opened { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null }
    const pickers = window as Window & { showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]> };
    let opened = $state.raw<Opened | null>(null);
    let pages = $state(0);
    let zoom = $state(1);
    let current = $state(1);
    let zoomMode = $state<ZoomMode>('page-width');
    let error = $state('');
    let input = $state<HTMLInputElement>();
    // pdf.js takes ownership of the buffer it is given; the original bytes stay ours for saving.
    const src = $derived(opened ? opened.bytes.slice() : null);

    async function load(file: File, handle: FileSystemFileHandle | null) {
        error = ''; pages = 0;
        opened = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, handle };
    }
    async function choose() {
        // Without the File System Access API the file has no handle; saving then needs a new target.
        if (!pickers.showOpenFilePicker) { input?.click(); return; }
        try {
            const [handle] = await pickers.showOpenFilePicker({ multiple: false, types: [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }] });
            await load(await handle.getFile(), handle);
        } catch (reason) {
            if ((reason as DOMException)?.name !== 'AbortError') error = `PDF를 열지 못했습니다. ${reason instanceof Error ? reason.message : String(reason)}`;
        }
    }
    function picked(event: Event) {
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        if (file) void load(file, null);
    }
</script>

<section class="pdf-editor" aria-label="PDF 편집기" data-pages={pages} data-zoom={zoom} data-zoom-mode={zoomMode} data-page={current}>
    <header class="toolbar">
        <button type="button" onclick={choose}>PDF 열기</button>
        {#if opened}<span class="name">{opened.name}</span>{/if}
        <input bind:this={input} type="file" accept="application/pdf,.pdf" hidden onchange={picked} />
    </header>
    {#if error}<p class="problem" role="alert">{error}</p>{/if}
    {#if src}
        {#key src}
            <Document.Root {src} onLoad={doc => { pages = doc.numPages; }} onError={reason => { error = `PDF를 열지 못했습니다. ${reason.message}`; }}>
                <Viewer.Root class="viewer" {messages} {zoomMode} onZoomModeChange={mode => { zoomMode = mode; }} onZoomChange={value => { zoom = value; }} onPageChange={value => { current = value; }}>
                    <Find.Root>
                    <div class="view-tools" role="toolbar" aria-label="보기">
                        <Zoom.Out>−</Zoom.Out>
                        <span class="zoom">{Math.round(zoom * 100)}%</span>
                        <Zoom.In>+</Zoom.In>
                        <Zoom.Mode mode="page-width">쪽 너비</Zoom.Mode>
                        <Zoom.Mode mode="page-fit">쪽 전체</Zoom.Mode>
                        <span class="gap"></span>
                        <PageNav.Prev>‹</PageNav.Prev>
                        <PageNav.Input class="page-input" />
                        <span class="count">/ {pages}</span>
                        <PageNav.Next>›</PageNav.Next>
                        <span class="find">
                            <Find.Input class="find-input" placeholder="찾기" />
                            <Find.Count class="find-count" />
                            <Find.Prev>↑</Find.Prev>
                            <Find.Next>↓</Find.Next>
                        </span>
                    </div>
                    <Viewer.Viewport class="viewport">
                        <Viewer.Pages>
                            {#snippet children({ pageNumber })}
                                <Viewer.Page {pageNumber}><Viewer.Canvas /><Viewer.TextLayer /><Find.Layer /></Viewer.Page>
                            {/snippet}
                        </Viewer.Pages>
                    </Viewer.Viewport>
                    </Find.Root>
                </Viewer.Root>
            </Document.Root>
        {/key}
    {:else}
        <p class="empty">PDF 파일을 여세요.</p>
    {/if}
</section>

<style>
    .pdf-editor {height:100%;display:flex;flex-direction:column;background:#eef0f3;font-family:system-ui,sans-serif;color:#3b4a60}
    .toolbar {display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #dce1e8;background:#fff}
    .toolbar button {font:inherit;font-size:13px;padding:5px 12px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    .name {font-size:13px;color:#5b6980}
    .problem {margin:8px 12px;color:#9a4b00;font-size:13px}
    .empty {margin:auto;font-size:14px}
    .pdf-editor :global(.viewer) {flex:1;min-height:0;display:flex;flex-direction:column}
    .pdf-editor :global(.viewport) {flex:1;min-height:0}
    .view-tools {display:flex;align-items:center;gap:6px;padding:4px 12px;border-bottom:1px solid #dce1e8;background:#f8f9fb;font-size:13px}
    .view-tools :global(button) {font:inherit;padding:3px 10px;border:1px solid #c8d1dd;border-radius:5px;background:#fff;color:#243047;cursor:pointer}
    .view-tools :global(button[data-active]) {border-color:#2563eb;color:#1d4ed8}
    .zoom {min-width:44px;text-align:center;color:#5b6980}
    .gap {flex:1}
    .view-tools :global(.page-input) {width:3em;text-align:center;font:inherit;padding:2px 4px;border:1px solid #c8d1dd;border-radius:5px}
    .count {color:#5b6980}
    .find {display:flex;align-items:center;gap:4px;margin-left:12px}
    .view-tools :global(.find-input) {width:11em;font:inherit;padding:2px 6px;border:1px solid #c8d1dd;border-radius:5px}
    .view-tools :global(.find-count) {min-width:4em;color:#5b6980;text-align:center}
</style>
