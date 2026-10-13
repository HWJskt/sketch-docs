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
    import { fingerprint, type PickerWindow } from '../fileAccess';
    import { createExporter } from './exporter';
    import { createSaver, type SaveOutcome } from './save';
    import { createRecoveryStore } from './recovery';
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
    // The annotations shown; the tracker knows which of them the file on disk already has.
    let annotations = $state.raw<Annotation[]>([]);
    const tracker = createDirtyTracker();
    let baseline = $state(0);
    const dirty = $derived.by(() => { void baseline; return tracker.isDirty(annotations); });
    // What the next save starts from and writes to: the file as opened or as last saved. Separate from
    // `opened`, which feeds the viewer, so saving does not reload the document.
    interface Base { bytes: Uint8Array; hash: string; handle: FileSystemFileHandle | null; name: string }
    let base = $state.raw<Base | null>(null);
    let epoch = $state(0), revision = 0;
    let saving = $state(false);
    let notice = $state('');
    const canSave = !!pickers.showSaveFilePicker;
    const recovery = createRecoveryStore();
    const saver = createSaver({ exporter: createExporter(), recovery });
    let section = $state<HTMLElement>();
    export function getState(): EditorStatus { return { ready: true, busy: saving, dirty, name: base?.name ?? '' }; }
    $effect(() => { void base; void dirty; void saving; onState(getState()); });

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
            const hash = await fingerprint(new Blob([bytes]));
            if (mine !== request) return;
            error = ''; notice = ''; pages = 0; current = 1; zoom = 1; zoomMode = 'page-width';
            annotations = []; tracker.reset([]); baseline++; epoch++; revision = 0;
            base = { bytes, hash, handle, name: chosen.name };
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
    // A save applies only to the document it was started for; edits made meanwhile stay unsaved.
    function finish(outcome: SaveOutcome, saved: Annotation[], name: string) {
        if (outcome.epoch !== epoch) return;
        if (!outcome.ok) { error = outcome.reason; return; }
        base = { bytes: outcome.bytes, hash: outcome.hash, handle: outcome.handle, name };
        tracker.reset(saved); baseline++;
        notice = `${name}에 저장했습니다.`;
    }
    /** Ctrl+S: back into the opened file; a file opened without a handle needs a new target. */
    async function save() {
        if (!base || saving) return;
        if (!base.handle || !canSave) return saveAs();
        const handle = base.handle, name = base.name;
        const snapshot = annotations, mine = { epoch, revision };
        error = ''; notice = ''; saving = true;
        try {
            // Read when this save's turn comes: a save queued behind another starts from what that one wrote.
            const outcome = await saver.save(() => ({ ...mine, name, original: base!.bytes, annotations: snapshot, handle, hash: base!.hash, overwrite: true }));
            finish(outcome, snapshot, name);
        } finally { saving = false; }
    }
    function shortcut(event: KeyboardEvent) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
        // Only while the PDF editor is the one shown (the shell hides the others).
        if (!section || section.closest('[hidden]') || !section.isConnected) return;
        event.preventDefault();
        void save();
    }
    async function saveAs() {
        if (!base || saving) return;
        let handle: FileSystemFileHandle;
        try {
            handle = await pickers.showSaveFilePicker!({ suggestedName: base.name, types: [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }] });
        } catch (reason) {
            if ((reason as DOMException)?.name !== 'AbortError') error = failure('저장할 위치를 고르지 못했습니다.', reason);
            return;
        }
        const target = handle, hash = await fingerprint(await target.getFile());
        const snapshot = annotations, mine = { epoch, revision };
        error = ''; notice = ''; saving = true;
        try {
            const outcome = await saver.save(() => ({ ...mine, name: target.name, original: base!.bytes, annotations: snapshot, handle: target, hash, overwrite: false }));
            finish(outcome, snapshot, target.name);
        } finally { saving = false; }
    }
    function picked(event: Event) {
        const field = event.currentTarget as HTMLInputElement;
        const file = field.files?.[0];
        // Cleared so choosing the same file again (to retry) is a change.
        field.value = '';
        if (file) void load(file, null);
    }
</script>

<!-- Capture: the annotation layer handles keys of a new annotation's note itself and stops them. -->
<svelte:window onkeydowncapture={shortcut} />
<section bind:this={section} class="pdf-editor" aria-label="PDF 편집기" data-pages={pages} data-zoom={zoom} data-zoom-mode={zoomMode} data-page={current} data-opens={epoch}>
    <header class="toolbar">
        <button type="button" onclick={choose} disabled={saving}>PDF 열기</button>
        <button type="button" onclick={save} disabled={!base || saving || !canSave} title={canSave ? 'Ctrl+S' : undefined}>저장</button>
        <button type="button" onclick={saveAs} disabled={!base || saving || !canSave} title={canSave ? undefined : '이 브라우저는 파일 저장을 지원하지 않습니다. 데스크톱 Chrome·Edge를 사용하세요.'}>다른 이름으로 저장</button>
        {#if opened}<span class="name">{base?.name ?? opened.name}</span>{/if}
        {#if saving}<span class="saving" role="status">저장하는 중…</span>{:else if notice}<span class="saved" role="status">{notice}</span>{/if}
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
                    <Annotations.Root foreign="readonly" importFromPdf {tools} {palette} onImport={result => { tracker.reset(result.annotations); baseline++; annotations = result.annotations; }} onAnnotationsChange={list => { annotations = list; revision++; }}>
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
    .saving, .saved {font-size:12px;color:#5b6980}
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
