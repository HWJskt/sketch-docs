<script lang="ts">
    import { Annotations, Document, Find, Outline, PageNav, Viewer, Zoom } from 'svelte-pdf-mini';
    import type { Annotation, AnnotationOp, AnnotationStore, ZoomMode } from 'svelte-pdf-mini';
    import { createPageHistory, type PageSnapshot } from './pageHistory';
    import { assemblePages, blankPage, deletePages, movePages, prepareSource, remapAnnotations, type PageItem, type PageSource } from './pages';
    import PagePanel from './PagePanel.svelte';
    import 'svelte-pdf-mini/styles.css';
    import { setupPdf } from './setup';
    import { messages, palette } from './messages';
    // The six annotation kinds of the plan, plus selecting existing ones.
    const tools = ['select', 'highlight', 'underline', 'strikeout', 'note', 'ink', 'rect'] as const;
    import type { EditorStatus } from '../editorState';
    import { fingerprint, type PickerWindow } from '../fileAccess';
    import { createExporter } from './exporter';
    import { createSaver, webLock, type SaveOutcome, type SaveTarget, type PickedTarget } from './save';
    import { createRecoveryStore, type RecoveryCopy } from './recovery';
    setupPdf();
    let { onState = () => {} }: { onState?: (state: EditorStatus) => void } = $props();

    interface Opened { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null }
    const pickers = window as PickerWindow;
    let opened = $state.raw<Opened | null>(null);
    let pages = $state(0);
    let zoom = $state(1);
    let current = $state(1);
    let panel = $state<'outline' | 'thumbnails' | null>(null);
    let paging = $state(false);
    let pageSaved = $state(false);
    let selectedPages = $state<string[]>([]);
    let selectionAnchor = $state<string | null>(null);
    let sources: PageSource[] = [];
    let pendingRender: PageSnapshot | null = null;
    let insertInput = $state<HTMLInputElement>();
    let insertBoundary = 0;
    let zoomMode = $state<ZoomMode>('page-width');
    let error = $state('');
    let input = $state<HTMLInputElement>();
    // pdf.js takes ownership of the buffer it is given; the original bytes stay ours for saving.
    const src = $derived(opened ? opened.bytes.slice() : null);
    // The annotations shown; the tracker knows which of them the file on disk already has.
    let annotations = $state.raw<Annotation[]>([]);
    let history = $state.raw<ReturnType<typeof createPageHistory> | null>(null);
    let annotationStore = $state<AnnotationStore>();
    let baseline = $state(0);
    let replaying = false;
    const dirty = $derived.by(() => { void baseline; return history?.dirty ?? false; });
    const canUndo = $derived.by(() => { void baseline; return history?.canUndo ?? false; });
    const canRedo = $derived.by(() => { void baseline; return history?.canRedo ?? false; });
    const pageItems = $derived.by(() => { void baseline; return history?.current.pages ?? []; });
    const pageEdited = $derived.by(() => { void baseline; return history?.current.edited ?? false; });
    function importedAnnotations(list: Annotation[]) {
        if (pendingRender && history) {
            const snapshot = pendingRender; pendingRender = null;
            const merged = [...list.filter(a => a.origin === 'foreign'), ...snapshot.annotations.filter(a => a.origin !== 'foreign')];
            replaying = true; annotationStore?.load(merged); replaying = false;
            annotations = merged;
            history.push({ ...snapshot, annotations: merged });
            baseline++; imported = true; paging = false;
            return;
        }
        annotations = list;
        history = createPageHistory({ bytes: opened!.bytes, pages: Array.from({ length: pages }, (_, index) => ({ id: `original-${index}`, source: 'original', index })), annotations: list, edited: false, losses: [] });
        baseline++; imported = true;
    }
    function changedAnnotations(list: Annotation[], ops: AnnotationOp[]) {
        annotations = list;
        if (!imported || replaying || paging || !history) return;
        const op = ops.length === 1 ? ops[0] : undefined;
        const group = op && op.type !== 'remove' ? ('after' in op ? op.after?.id : undefined) : undefined;
        history.push({ ...history.current, annotations: list }, group);
        baseline++; revision++;
    }
    function travel(redo = false) {
        if (!history || !imported || paging) return;
        const snapshot = redo ? history.redo() : history.undo();
        if (snapshot.bytes !== opened?.bytes) {
            pendingRender = snapshot; imported = false; paging = true;
            current = Math.min(current, snapshot.pages.length);
            opened = { ...opened!, bytes: snapshot.bytes };
        }
        replaying = true;
        annotationStore?.load(snapshot.annotations);
        annotations = snapshot.annotations;
        replaying = false;
        baseline++; revision++;
    }
    // What the next save starts from and writes to: the file as opened or as last saved. Separate from
    // `opened`, which feeds the viewer, so saving does not reload the document.
    interface Base { bytes: Uint8Array; hash: string; handle: FileSystemFileHandle | null; name: string }
    let base = $state.raw<Base | null>(null);
    let epoch = $state(0), revision = 0;
    let saving = $state(false);
    // Saving waits until the annotations already in the file were read: an export replaces the ones this
    // editor wrote before, so saving earlier would drop them.
    let imported = $state(false);
    let notice = $state('');
    const canSave = !!pickers.showSaveFilePicker;
    const canSaveAs = canSave;
    const recovery = createRecoveryStore();
    const saver = createSaver({ exporter: createExporter(), recovery });
    let section = $state<HTMLElement>();
    export function getState(): EditorStatus { return { ready: true, busy: saving || paging, dirty, name: base?.name ?? '' }; }
    $effect(() => { void base; void dirty; void saving; void paging; onState(getState()); });

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
            pickPrompt?.cancel();
            error = ''; notice = ''; pageSaved = false; sources = []; selectedPages = []; selectionAnchor = null; pendingRender = null; paging = false; pages = 0; current = 1; zoom = 1; zoomMode = 'page-width';
            annotations = []; history = null; baseline++; epoch++; revision = 0; imported = false;
            base = { bytes, hash, handle, name: chosen.name };
            opened = { bytes, name: chosen.name, handle };
        } catch (reason) {
            if (mine === request) error = failure('PDF를 열지 못했습니다.', reason);
        }
    }
    async function choose() {
        if (dirty && !confirm('저장하지 않은 변경이 있습니다. 다른 PDF를 열까요?')) return;
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
    function finish(outcome: SaveOutcome, saved: PageSnapshot) {
        if (outcome.epoch !== epoch) return;
        if (!outcome.ok) { if (!outcome.cancelled) error = outcome.reason; return; }
        const name = outcome.handle.name;
        base = { bytes: outcome.bytes, hash: outcome.hash, handle: outcome.handle, name };
        history?.markSaved(saved); if (saved.edited) pageSaved = true; baseline++;
        notice = `${name}에 저장했습니다.`;
    }

    // A save picker needs a recent click. When the export took longer than that, one more click is asked for.
    const pdfTypes = [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } }];
    let pickPrompt = $state.raw<{ go: () => void; cancel: () => void } | null>(null);
    async function chooseSaveFile(suggestedName: string, startIn?: FileSystemFileHandle | null, pageEpoch?: number): Promise<FileSystemFileHandle | null> {
        const open = () => pickers.showSaveFilePicker!({ suggestedName, types: pdfTypes, ...(startIn ? { startIn } : {}) });
        try { return await open(); }
        catch (reason) {
            const kind = (reason as DOMException)?.name;
            if (kind === 'AbortError') return null;
            if (kind !== 'SecurityError' && kind !== 'NotAllowedError') throw reason;
        }
        // A rejected picker has not selected/emptied a file. Do not resurrect an old page save prompt.
        if (pageEpoch !== undefined && pageEpoch !== epoch) return null;
        return new Promise((resolve, reject) => {
            pickPrompt = {
                go: () => { pickPrompt = null; open().then(resolve, reason => (reason as DOMException)?.name === 'AbortError' ? resolve(null) : reject(reason)); },
                cancel: () => { pickPrompt = null; resolve(null); },
            };
        });
    }

    /**
     * One save: the annotations are those of the click; the bytes it starts from are read when its turn comes
     * (a save queued behind another starts from what that one wrote). A changed document cancels selection
     * before the picker opens; an already chosen target must still be written.
     */
    async function run(pick: (start: Base) => Promise<SaveTarget | PickedTarget | null>) {
        const snapshot = annotations, saved = { ...history!.current, annotations: snapshot }, mine = { epoch, revision }, start = base!;
        const reconstructed = saved.edited || pageSaved;
        error = ''; notice = ''; saving = true;
        try {
            const current = () => (epoch === mine.epoch && base ? base : start);
            const outcome = await saver.save(() => ({
                ...mine, name: current().name, original: reconstructed ? saved.bytes : current().bytes, annotations: snapshot,
                pickerOriginal: reconstructed ? current().bytes : undefined,
                confirm: async () => !reconstructed || !saved.losses.length || confirm(`페이지를 재구성하면 다음 정보가 빠지거나 작동하지 않을 수 있습니다.\n\n${saved.losses.map(item => `• ${item}`).join('\n')}\n\n새 PDF로 저장할까요?`),
                target: async () => {
                    if (epoch !== mine.epoch) return null;
                    // Both save pickers can empty the chosen file: finish writing even if another
                    // document opens while the OS dialog is pending. finish() guards the UI epoch.
                    return pick(current());
                },
            }));
            if (reconstructed && outcome.epoch !== epoch && !outcome.ok && !outcome.cancelled) {
                // The old picker may have emptied a file. Its write/recovery failure must remain visible,
                // while finish() continues to protect the newly opened document's base and history.
                error = `${start.name}에서 시작한 저장: ${outcome.reason}`;
            }
            finish(outcome, saved);
        } finally { saving = false; }
    }
    /** Ctrl+S: back into the opened file; a file opened without a handle needs a new target. */
    async function save() {
        if (!base || saving || paging || !imported) return;
        if (pageEdited || pageSaved) { error = '페이지를 편집한 문서는 다른 이름으로 저장에서 저장 위치를 선택하세요.'; return; }
        if (!base.handle || !canSave) return saveAs();
        const handle = base.handle;
        // Write permission is asked while the click still counts as a user action, before the long export.
        const permitted = await (handle as FileSystemFileHandle & { requestPermission?: (options: { mode: string }) => Promise<string> }).requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
        if (permitted !== undefined && permitted !== 'granted') { error = '파일에 쓸 권한이 없어 저장하지 않았습니다. 다른 이름으로 저장하세요.'; return; }
        // The file must still hold what this editor opened or last saved.
        await run(async current => ({ handle, overwrite: true, hash: current.hash }));
    }
    function shortcut(event: KeyboardEvent) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        if (!section || section.closest('[hidden]') || !section.isConnected) return;
        const key = event.key.toLowerCase();
        if (key === 's') { event.preventDefault(); void save(); }
        if (key === 'z' || key === 'y') {
            const target = event.target as HTMLElement;
            // Native text-field undo belongs to that field. Annotation note text is part of our history.
            if (target.matches('input, textarea, [contenteditable=true]') && !target.closest('[data-pdf-annotation-popover]')) return;
            event.preventDefault(); event.stopImmediatePropagation(); travel(event.shiftKey || key === 'y');
        }
    }
    /** The target is chosen only after the export passed its checks: the picker empties an existing file. */
    async function saveAs() {
        if (!base || saving || paging || !imported || !canSaveAs) return;
        if (pageEdited || pageSaved) {
            const source = opened!, pageEpoch = epoch;
            const suggestedName = source.name.replace(/\.pdf$/i, '') + '-편집.pdf';
            await run(async () => {
                const handle = await chooseSaveFile(suggestedName, source.handle, pageEpoch);
                return handle ? { handle, picked: true } : null;
            });
            return;
        }
        await run(async current => {
            const handle = await chooseSaveFile(current.name);
            if (!handle) return null;
            // Choosing the opened file itself is an overwrite: its original (no longer on disk, the picker
            // emptied it) is kept for recovery. The hash is of what the chosen file holds now.
            const same = !!current.handle && await current.handle.isSameEntry(handle);
            return { handle: same ? current.handle! : handle, overwrite: same, hash: await fingerprint(await handle.getFile()) };
        });
    }
    // "저장 전 원본 복원": a recovery copy is written to a file the user chooses.
    let copies = $state.raw<RecoveryCopy[] | null>(null);
    async function showCopies() {
        if (copies) { copies = null; return; }
        try { copies = await recovery.list(); }
        catch (reason) { error = failure('보관한 원본을 읽지 못했습니다.', reason); }
    }
    async function restore(copy: RecoveryCopy) {
        if (saving || paging) return;
        error = ''; notice = ''; saving = true;
        try {
            // Read first: the picker empties the file it returns.
            const bytes = new Uint8Array(await (await recovery.read(copy.file)).arrayBuffer());
            const handle = await chooseSaveFile(copy.name.replace(/\.pdf$/i, '') + ' (저장 전 원본).pdf');
            if (!handle) return;
            await webLock(async () => {
                const stream = await handle.createWritable();
                try { await stream.write(bytes); await stream.close(); }
                catch (reason) { await stream.abort().catch(() => undefined); throw reason; }
            });
            copies = null;
            notice = `${copy.name}의 저장 전 원본을 ${handle.name}(으)로 저장했습니다.`;
            // Restored over the opened file: show what the file now holds.
            if (base?.handle && await base.handle.isSameEntry(handle)) { saving = false; await load(handle.getFile(), handle); notice = `${handle.name}을(를) 저장 전 원본으로 되돌리고 다시 열었습니다.`; }
        } catch (reason) {
            error = failure('원본을 복원하지 못했습니다.', reason);
        } finally { saving = false; }
    }
    interface PageTask { epoch: number; request: number; history: typeof history }
    const isCurrentTask = (task: PageTask) => task.epoch === epoch && task.request === request && task.history === history;
    async function ensureSource(task: PageTask) {
        if (!sources.some(source => source.id === 'original')) {
            const prepared = await prepareSource('original', opened!.bytes, false);
            if (!isCurrentTask(task)) return false;
            sources = [prepared, ...sources];
        }
        return isCurrentTask(task);
    }
    async function changePages(next: PageItem[], task: PageTask) {
        if (!isCurrentTask(task) || !history || !opened) return;
        const before = history.current;
        if (next.map(p => p.id).join() === before.pages.map(p => p.id).join()) return;
        const bytes = await assemblePages(sources, next);
        if (!isCurrentTask(task)) return;
        const used = new Set(['original', ...next.map(p => p.source)]);
        const losses = [...new Set(sources.filter(s => used.has(s.id)).flatMap(s => s.losses))];
        const snapshot = { pages: next, bytes, annotations: remapAnnotations(annotations, before.pages, next), edited: true, losses };
        history.push(snapshot); pendingRender = snapshot;
        annotations = snapshot.annotations; imported = false; baseline++; revision++;
        current = Math.min(current, next.length);
        opened = { ...opened, bytes };
    }
    async function pageAction(work: (task: PageTask) => Promise<void>) {
        if (paging || saving || !imported) return;
        const task = { epoch, request, history };
        paging = true; error = ''; notice = '';
        try { if (await ensureSource(task)) await work(task); }
        catch (reason) { if (isCurrentTask(task) && (reason as DOMException)?.name !== 'AbortError') error = failure('페이지를 편집하지 못했습니다.', reason); }
        finally { if (task.epoch === epoch && imported) paging = false; }
    }
    function moveSelection(ids: string[], boundary: number) { void pageAction(task => changePages(movePages(pageItems, ids, boundary), task)); }
    function deleteSelection(ids: string[]) { void pageAction(task => changePages(deletePages(pageItems, ids), task)); }
    function insertBlank(boundary: number) {
        void pageAction(async task => {
            const item = await blankPage(sources, pageItems[Math.max(0, boundary - 1)], crypto.randomUUID());
            if (!isCurrentTask(task)) return;
            await changePages([...pageItems.slice(0, boundary), item, ...pageItems.slice(boundary)], task);
        });
    }
    async function insertFile(file: File, boundary: number, task: PageTask) {
        if (!isCurrentTask(task)) return;
        const source = await prepareSource(crypto.randomUUID(), new Uint8Array(await file.arrayBuffer()), true);
        if (!isCurrentTask(task)) return;
        const added = Array.from({ length: source.count }, (_, index) => ({ id: `${source.id}-${index}`, source: source.id, index }));
        sources = [...sources, source];
        await changePages([...pageItems.slice(0, boundary), ...added, ...pageItems.slice(boundary)], task);
    }
    function insertPdf(boundary: number) {
        if (!pickers.showOpenFilePicker) { insertBoundary = boundary; insertInput?.click(); return; }
        // Attach the rejection handler immediately, including when source preparation takes time.
        const choice = pickers.showOpenFilePicker({ multiple: false, types: pdfTypes }).then(handles => ({ handles, reason: null }), reason => ({ handles: null, reason }));
        void pageAction(async task => { const result = await choice; if (!result.handles) throw result.reason; await insertFile(await result.handles[0].getFile(), boundary, task); });
    }
    function pickedInsert(event: Event) {
        const field = event.currentTarget as HTMLInputElement, file = field.files?.[0]; field.value = '';
        if (file) void pageAction(task => insertFile(file, insertBoundary, task));
    }
    const when = (time: number) => new Date(time).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
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
<section bind:this={section} class="pdf-editor" aria-label="PDF 편집기" data-pages={pages} data-zoom={zoom} data-zoom-mode={zoomMode} data-page={current} data-opens={epoch} data-order={pageItems.map(p => p.id).join()} aria-busy={paging}>
    <header class="toolbar">
        <button type="button" onclick={choose} disabled={saving || paging}>PDF 열기</button>
        <button type="button" onclick={save} disabled={!base || saving || paging || !canSave || !imported} title={canSave ? 'Ctrl+S' : undefined}>저장</button>
        <button type="button" onclick={saveAs} disabled={!base || saving || paging || !canSaveAs || !imported} title={canSaveAs ? undefined : '이 브라우저는 파일 저장을 지원하지 않습니다. 데스크톱 Chrome·Edge를 사용하세요.'}>다른 이름으로 저장</button>
        <button type="button" onclick={showCopies} disabled={!canSave || saving || paging} aria-expanded={copies !== null}>저장 전 원본 복원</button>
        {#if pickPrompt}<span class="pick" role="status">파일을 만드는 데 시간이 걸렸습니다. <button type="button" onclick={pickPrompt.go}>저장할 위치 고르기</button> <button type="button" onclick={pickPrompt.cancel}>취소</button></span>{/if}
        {#if opened}<span class="name">{base?.name ?? opened.name}</span>{/if}
        {#if saving}<span class="saving" role="status">저장하는 중…</span>{:else if notice}<span class="saved" role="status">{notice}</span>{/if}
        <input bind:this={insertInput} aria-label="삽입할 PDF 파일" type="file" accept="application/pdf,.pdf" hidden onchange={pickedInsert} />
        <input bind:this={input} aria-label="열 PDF 파일" type="file" accept="application/pdf,.pdf" hidden onchange={picked} />
    </header>
    {#if copies}
        <div class="copies" role="region" aria-label="보관한 원본">
            {#if copies.length}
                <p>이 브라우저가 덮어쓰기 전에 보관한 원본입니다. 고르면 새 파일로 저장합니다.</p>
                <ul>{#each copies as copy (copy.file)}<li><button type="button" disabled={saving || paging} onclick={() => restore(copy)}>{copy.name} · {when(copy.savedAt)}</button></li>{/each}</ul>
            {:else}
                <p>보관한 원본이 없습니다. 열린 파일에 처음 저장할 때 원본을 보관합니다.</p>
            {/if}
        </div>
    {/if}
    {#if paging}<p class="working" role="status">페이지를 준비하는 중…</p>{/if}
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
                <Viewer.Root class="viewer" {messages} {zoomMode} {zoom} page={current} onZoomModeChange={mode => { zoomMode = mode; }} onZoomChange={value => { zoom = value; }} onPageChange={value => { current = value; }}>
                    <Find.Root>
                    <Annotations.Root {annotations} bind:store={annotationStore} foreign="readonly" readonly={paging || !imported} importFromPdf {tools} {palette} keymap={{ undo: [], redo: [] }} onImport={result => importedAnnotations(result.annotations)} onAnnotationsChange={changedAnnotations}>
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
                        <button type="button" aria-label="실행 취소" disabled={!canUndo || !imported || paging} onclick={() => travel()}>↶</button>
                        <button type="button" aria-label="다시 실행" disabled={!canRedo || !imported || paging} onclick={() => travel(true)}>↷</button>
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
                            <PagePanel pages={pageItems} bind:selected={selectedPages} bind:anchor={selectionAnchor} disabled={paging || saving || !imported} onmove={moveSelection} ondelete={deleteSelection} onblank={insertBlank} oninsert={insertPdf} />
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
    .copies {margin:0;padding:8px 12px;border-bottom:1px solid #dce1e8;background:#fffdf5;font-size:13px}
    .copies p {margin:0 0 6px}
    .copies ul {margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
    .copies button {font:inherit;padding:3px 10px;border:1px solid #c8d1dd;border-radius:5px;background:#fff;cursor:pointer}
    .problem {margin:8px 12px;color:#9a4b00;font-size:13px}
    .empty {margin:auto;font-size:14px}
    .pdf-editor :global(.viewer) {flex:1;min-height:0;display:flex;flex-direction:column}
    .pdf-editor :global(.viewport) {flex:1;min-width:0;height:100%}
    .body {flex:1;min-height:0;display:flex}
    .panel {width:180px;flex:none;overflow:auto;border-right:1px solid #dce1e8;background:#f8f9fb;padding:8px;box-sizing:border-box;font-size:13px}
    .panel :global([data-pdf-outline] button) {display:block;margin:0 auto 8px;border:1px solid transparent;background:none;cursor:pointer;font:inherit;color:#243047;text-align:left}
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
