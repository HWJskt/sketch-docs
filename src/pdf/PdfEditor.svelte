<script lang="ts">
    import { Annotations, Document, Find, Outline, PageNav, Thumbnails, Viewer, Zoom } from 'svelte-pdf-mini';
    import type { Annotation, ZoomMode } from 'svelte-pdf-mini';
    import { createDirtyTracker } from './annotationState';
    import 'svelte-pdf-mini/styles.css';
    import { setupPdf } from './setup';
    import { messages, palette } from './messages';
    // The six annotation kinds of the plan, plus selecting existing ones.
    const tools = ['select', 'highlight', 'underline', 'strikeout', 'note', 'ink', 'rect'] as const;
    import type { EditorStatus } from '../editorState';
    import type { PickerWindow } from '../fileAccess';
    setupPdf();
    let { onState = () => {} }: { onState?: (state: EditorStatus) => void } = $props();

    interface Opened { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null }
    const pickers = window as PickerWindow;
    let opened = $state.raw<Opened | null>(null);
    let pages = $state(0);
    let zoom = $state(1);
    let current = $state(1);
    let panel = $state<'outline' | 'thumbnails' | null>(null);
    let zoomMode = $state<ZoomMode>('page-width');
    let error = $state('');
    let input = $state<HTMLInputElement>();
    // pdf.js takes ownership of the buffer it is given; the original bytes stay ours for saving.
    const src = $derived(opened ? opened.bytes.slice() : null);
    // The annotations shown; the tracker knows which of them the opened file already has.
    let annotations = $state.raw<Annotation[]>([]);
    const tracker = createDirtyTracker();
    const dirty = $derived.by(() => { void opened; return tracker.isDirty(annotations); });
    // Saving comes later (plan step 10); until then a PDF is never busy.
    export function getState(): EditorStatus { return { ready: true, busy: false, dirty, name: opened?.name ?? '' }; }
    $effect(() => { void opened; void dirty; onState(getState()); });

    const failure = (what: string, reason: unknown) => `${what} ${reason instanceof Error ? reason.message : String(reason)}`;
    let request = 0;
    // Only the latest open may replace the document, and only after its bytes were read: a slow or failed
    // read leaves the current document, its page and its zoom as they are.
    async function load(file: File | Promise<File>, handle: FileSystemFileHandle | null) {
        const mine = ++request;
        try {
            const chosen = await file;
            const bytes = new Uint8Array(await chosen.arrayBuffer());
            if (mine !== request) return;
            error = ''; pages = 0; current = 1; zoom = 1; zoomMode = 'page-width';
            annotations = []; tracker.reset([]);
            opened = { bytes, name: chosen.name, handle };
        } catch (reason) {
            if (mine === request) error = failure('PDF를 열지 못했습니다.', reason);
        }
    }
    async function choose() {
        // Without the File System Access API the file has no handle; saving then needs a new target.
        if (!pickers.showOpenFilePicker) { input?.click(); return; }
        let handle: FileSystemFileHandle;
        try {
            [handle] = await pickers.showOpenFilePicker({ multiple: false, types: [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }] });
        } catch (reason) {
            if ((reason as DOMException)?.name !== 'AbortError') error = failure('PDF를 열지 못했습니다.', reason);
            return;
        }
        await load(handle.getFile(), handle);
    }
    function picked(event: Event) {
        const field = event.currentTarget as HTMLInputElement;
        const file = field.files?.[0];
        // Cleared so choosing the same file again (to retry) is a change.
        field.value = '';
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
                {#snippet children({ document, status })}
                <Document.Password class="password">
                    {#snippet children({ reason })}
                        <label>
                            {reason === 'incorrect' ? '암호가 틀렸습니다. 다시 입력하세요.' : '암호로 보호된 PDF입니다. 암호를 입력하세요.'}
                            <input type="password" autocomplete="current-password" />
                        </label>
                        <button type="submit">열기</button>
                    {/snippet}
                </Document.Password>
                <Viewer.Root class="viewer" {messages} {zoomMode} onZoomModeChange={mode => { zoomMode = mode; }} onZoomChange={value => { zoom = value; }} onPageChange={value => { current = value; }}>
                    <Find.Root>
                    <Annotations.Root foreign="readonly" importFromPdf {tools} {palette} onImport={result => { tracker.reset(result.annotations); annotations = result.annotations; }} onAnnotationsChange={list => { annotations = list; }}>
                    <div class="view-tools" role="toolbar" aria-label="보기">
                        <button type="button" aria-pressed={panel === 'outline'} onclick={() => { panel = panel === 'outline' ? null : 'outline'; }}>목차</button>
                        <button type="button" aria-pressed={panel === 'thumbnails'} onclick={() => { panel = panel === 'thumbnails' ? null : 'thumbnails'; }}>썸네일</button>
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
                        <Annotations.Undo>↶</Annotations.Undo>
                        <Annotations.Redo>↷</Annotations.Redo>
                        <button type="button" disabled={status !== 'ready'} onclick={() => { document.print().catch(reason => { error = failure('인쇄하지 못했습니다.', reason); }); }}>인쇄</button>
                        <span class="find">
                            <Find.Input class="find-input" placeholder="찾기" />
                            <Find.Count class="find-count" />
                            <Find.Prev>↑</Find.Prev>
                            <Find.Next>↓</Find.Next>
                        </span>
                    </div>
                    <div class="annotate-tools" role="toolbar" aria-label="주석">
                        {#each tools as tool (tool)}<Annotations.Tool {tool} />{/each}
                        <span class="gap-small"></span>
                        {#each palette as color (color.key)}<Annotations.Color color={color.key} class="swatch" />{/each}
                    </div>
                    <div class="body">
                    {#if panel === 'outline'}
                        <aside class="panel" aria-label="목차">
                            <Outline.Root><Outline.Tree>{#snippet empty()}<p class="none">목차가 없습니다.</p>{/snippet}</Outline.Tree></Outline.Root>
                        </aside>
                    {:else if panel === 'thumbnails'}
                        <aside class="panel" aria-label="썸네일">
                            <Thumbnails.Root width={110}>
                                {#each { length: pages }, index (index)}<Thumbnails.Item pageNumber={index + 1} />{/each}
                            </Thumbnails.Root>
                        </aside>
                    {/if}
                    <Viewer.Viewport class="viewport">
                        <Viewer.Pages>
                            {#snippet children({ pageNumber })}
                                <Viewer.Page {pageNumber}><Viewer.Canvas /><Viewer.TextLayer /><Find.Layer /><Annotations.Layer /></Viewer.Page>
                            {/snippet}
                        </Viewer.Pages>
                    </Viewer.Viewport>
                    </div>
                    <Annotations.SelectionMenu />
                    <Annotations.Popover />
                    </Annotations.Root>
                    </Find.Root>
                </Viewer.Root>
                {/snippet}
            </Document.Root>
        {/key}
    {:else}
        <p class="empty">PDF 파일을 여세요.</p>
    {/if}
</section>

<style>
    .pdf-editor {height:100%;display:flex;flex-direction:column;background:#eef0f3;font-family:system-ui,sans-serif;color:#3b4a60}
    .toolbar {display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #dce1e8;background:#fff}
    .toolbar button {font:inherit;font-size:13px;padding:5px 12px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    .name {font-size:13px;color:#5b6980}
    .problem {margin:8px 12px;color:#9a4b00;font-size:13px}
    .empty {margin:auto;font-size:14px}
    .pdf-editor :global(.viewer) {flex:1;min-height:0;display:flex;flex-direction:column}
    .pdf-editor :global(.viewport) {flex:1;min-width:0;height:100%}
    .body {flex:1;min-height:0;display:flex}
    .panel {width:180px;flex:none;overflow:auto;border-right:1px solid #dce1e8;background:#f8f9fb;padding:8px;box-sizing:border-box;font-size:13px}
    .panel :global([data-pdf-thumbnail]), .panel :global(button) {display:block;margin:0 auto 8px;border:1px solid transparent;background:none;cursor:pointer;font:inherit;color:#243047;text-align:left}
    .view-tools button[aria-pressed='true'] {border-color:#2563eb;color:#1d4ed8}
    .none {color:#5b6980}
    .pdf-editor :global(.password) {margin:40px auto;display:flex;gap:8px;align-items:end;font-size:14px}
    .pdf-editor :global(.password label) {display:flex;flex-direction:column;gap:6px}
    .pdf-editor :global(.password input), .pdf-editor :global(.password button) {font:inherit;padding:5px 10px;border:1px solid #c8d1dd;border-radius:6px;background:#fff}
    .view-tools {display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 12px;border-bottom:1px solid #dce1e8;background:#f8f9fb;font-size:13px}
    .view-tools :global(button) {font:inherit;padding:3px 10px;border:1px solid #c8d1dd;border-radius:5px;background:#fff;color:#243047;cursor:pointer}
    .view-tools :global(button[data-active]) {border-color:#2563eb;color:#1d4ed8}
    .zoom {min-width:44px;text-align:center;color:#5b6980}
    .gap {flex:1}
    .annotate-tools {display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid #dce1e8;background:#fff;font-size:12px}
    .annotate-tools :global([data-pdf-annotation-tool]) {font:inherit;padding:3px 8px;border:1px solid #c8d1dd;border-radius:5px;background:#fff;color:#243047;cursor:pointer}
    .annotate-tools :global([data-pdf-annotation-tool][data-active]) {border-color:#2563eb;color:#1d4ed8;background:#eef4ff}
    .annotate-tools :global(.swatch) {width:20px;height:20px;padding:0;border:2px solid #fff;border-radius:50%;background:var(--swatch);box-shadow:0 0 0 1px #c8d1dd;cursor:pointer}
    .annotate-tools :global(.swatch[data-active]) {box-shadow:0 0 0 2px #2563eb}
    .gap-small {width:8px}
    .view-tools :global(.page-input) {width:3em;text-align:center;font:inherit;padding:2px 4px;border:1px solid #c8d1dd;border-radius:5px}
    .count {color:#5b6980}
    .find {display:flex;align-items:center;gap:4px;margin-left:12px}
    .view-tools :global(.find-input) {width:11em;font:inherit;padding:2px 6px;border:1px solid #c8d1dd;border-radius:5px}
    .view-tools :global(.find-count) {min-width:4em;color:#5b6980;text-align:center}
</style>
