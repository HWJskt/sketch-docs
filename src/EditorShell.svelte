<script lang="ts">
    import { mount, unmount, onMount, onDestroy, tick, untrack } from 'svelte';
    import EditorControls from './EditorControls.svelte';
    import './editorHeader.css';
    import headerCss from './editorHeader.css?raw';
    import HangulEditor from './HangulEditor.svelte';
    import EngineProgress from './EngineProgress.svelte';
    import AboutProduct from './AboutProduct.svelte';
    import { offlineReady } from './offline';
    import { rememberEngine } from './engines';
    import { isHomePath, modeFromPath, type EditorMode } from './routes';
    import type { EditorStatus, HangulInput } from './editorState';
    type Mode = EditorMode;
    let { initialMode }: { initialMode: Mode } = $props();
    let active = $state<Mode>(untrack(() => initialMode));
    let wordLoaded = $state(untrack(() => initialMode === 'word'));
    let hangulLoaded = $state(untrack(() => initialMode === 'hwp'));
    let pdfLoaded = $state(untrack(() => initialMode === 'pdf'));
    // An editor mounts only after its engine files are downloaded (EngineProgress shows the wait).
    let wordFetched = $state(false), hangulFetched = $state(false), pdfFetched = $state(false);
    let onlineReady = $state(false);
    let frame = $state.raw<HTMLIFrameElement>();
    let hangul = $state.raw<HangulEditor>();
    // The PDF editor and its libraries load only when PDF is chosen (a separate chunk).
    let pdf = $state.raw<{ getState(): EditorStatus }>();
    const pdfModule = () => import('./pdf/PdfEditor.svelte');
    let initialFile = $state.raw<HangulInput | undefined>();
    let controlsReady = $state(false);
    const mountedControls = new Map<Mode, {doc: Document; instance: ReturnType<typeof mount>}>();
    let disposed = false;
    function placeControls() {
        if (disposed) return;
        // The PDF editor is not in a frame: the shell's own header stays above it.
        if (active === 'pdf') { controlsReady = false; return; }
        const doc = active === 'word' ? frame?.contentDocument : hangul?.menuDocument();
        const row = doc?.querySelector(active === 'word' ? '.ribbon-tabs' : '#menu-bar');
        // Word's modern toolbar has no menu row: the shell header floats over its right end, so keep that
        // width (.product-header in editorHeader.css) clear of toolbar buttons.
        if (active === 'word' && !row && doc?.querySelector('.toolbar-region') && !doc.getElementById('sketch-header-space')) {
            const space = doc.createElement('style'); space.id = 'sketch-header-space';
            space.textContent = '.toolbar-region{padding-right:150px;box-sizing:border-box}';
            doc.head.append(space);
        }
        controlsReady = !!row;
        if (!row || !doc || mountedControls.get(active)?.doc === doc) return;
        const previous = mountedControls.get(active);
        if (previous) void unmount(previous.instance);
        const style = doc.createElement('style'); style.textContent = headerCss; doc.head.append(style);
        const wrapper = doc.createElement('div'); wrapper.className = 'sketch-menu-row';
        row.before(wrapper); wrapper.append(row);
        const mode = active;
        const instance = mount(EditorControls, {target: wrapper, props: {
            mode, getBlocked: () => blocked, getName: () => mode === 'hwp' ? hangulStatus.name : '', getDirty: () => mode === 'hwp' && hangulStatus.dirty,
            onSwitch: switchMode, onAbout: () => about = true,
        }});
        mountedControls.set(mode, {doc, instance});
    }
    // mount owns an independent lifetime; do not parent it to this rerunning effect.
    $effect(() => { void active; void wordStatus; void hangulStatus; void frame; void hangul; queueMicrotask(placeControls); });
    onDestroy(() => { disposed = true; for (const {instance} of mountedControls.values()) void unmount(instance); });
    let about = $state(false);
    let notice = $state('');
    let wordStatus = $state<EditorStatus>({ready:false,busy:false,dirty:false,name:''});
    let hangulStatus = $state<EditorStatus>({ready:false,busy:false,dirty:false,name:''});
    let pdfStatus = $state<EditorStatus>({ready:false,busy:false,dirty:false,name:''});
    const blocked = $derived(wordStatus.busy || hangulStatus.busy || pdfStatus.busy);
    function states() {
        return [frame?.contentWindow?.sketchWord?.state() ?? wordStatus, hangul?.getState() ?? hangulStatus, pdf?.getState() ?? pdfStatus];
    }
    const pages: Record<Mode, string> = { word: './word.html', hwp: './hwp.html', pdf: './pdf.html' };
    const titles: Record<Mode, string> = { word: 'Word', hwp: '한글', pdf: 'PDF' };
    function switchMode(mode: Mode, updateUrl = true) {
        if (states().some(state => state.busy)) { notice = '파일 작업이 끝난 뒤 편집기를 전환할 수 있습니다.'; return false; }
        const focused = frame?.contentDocument?.activeElement;
        if (focused && 'blur' in focused) (focused as HTMLElement).blur();
        active = mode;
        rememberEngine(mode);
        if (mode === 'word') wordLoaded = true; else if (mode === 'hwp') hangulLoaded = true; else pdfLoaded = true;
        notice = '';
        if (updateUrl) history.pushState({mode}, '', new URL(pages[mode], location.href));
        document.title = `${titles[mode]} · Sketch Docs`;
        return true;
    }
    function popstate() {
        // Back from an editor opened on the start page. The address has already changed, so ask here and
        // step forward again on cancel; then reload the start page without the browser asking a second time.
        if (isHomePath(location.pathname)) {
            if (states().some(state => state.dirty || state.busy) && !confirm('저장하지 않은 문서가 있습니다. 첫 화면으로 돌아갈까요?')) { history.forward(); return; }
            leaveConfirmed = true;
            location.reload();
            return;
        }
        const mode = modeFromPath(location.pathname);
        if (!switchMode(mode, false)) history.replaceState({mode: active}, '', new URL(pages[active], location.href));
    }
    let leaveConfirmed = false;
    function leaving(event: BeforeUnloadEvent) {
        if (leaveConfirmed) return;
        if (states().some(state => state.dirty || state.busy)) { event.preventDefault(); event.returnValue = ''; }
    }
    onMount(() => {
        let alive = true;
        rememberEngine(active);
        void offlineReady.then(() => { if (alive) onlineReady = true; });
        const host = {
            wordState(state: EditorStatus) { wordStatus = state; },
            async openHangul(file: HangulInput | undefined = undefined) {
                // This request comes from Word's own open operation; only the target session can block it.
                if (hangul?.getState().busy || (!file && states().some(state => state.busy))) throw new Error('파일 작업이 진행 중입니다.');
                if (hangulLoaded && hangulFetched) {
                    await tick();
                    if (!await hangul!.openDocument(file)) return;
                } else { initialFile = file; hangulLoaded = true; }
                active = 'hwp';
                rememberEngine('hwp');
                history.pushState({mode:'hwp'}, '', new URL('./hwp.html', location.href));
                document.title = '한글 · Sketch Docs';
            },
        };
        window.sketchShell = host;
        return () => { alive = false; if (window.sketchShell === host) delete window.sketchShell; };
    });
</script>

<svelte:window onbeforeunload={leaving} onpopstate={popstate} />
<div class="editor-shell">
    {#if !controlsReady}<EditorControls mode={active} getBlocked={() => blocked} getName={() => active === 'pdf' ? pdfStatus.name : ''} getDirty={() => active === 'pdf' && pdfStatus.dirty} onSwitch={switchMode} onAbout={() => about = true} />{/if}
    {#if notice}<div class="notice" role="status">{notice}</div>{/if}
    <div class="engines">
        {#if wordLoaded}
            <div class="engine" hidden={active !== 'word'} inert={active !== 'word'}>
                {#if wordFetched && onlineReady}
                    <iframe bind:this={frame} title="Word 문서 편집기" src="./engines/word/index.html" allow="clipboard-read; clipboard-write" onload={() => { wordStatus = frame?.contentWindow?.sketchWord?.state() ?? wordStatus; }}></iframe>
                {:else}
                    <EngineProgress engine="word" onReady={() => wordFetched = true} />
                {/if}
            </div>
        {/if}
        {#if hangulLoaded}
            <div class="engine" hidden={active !== 'hwp'} inert={active !== 'hwp'}>
                {#if hangulFetched}
                    <HangulEditor bind:this={hangul} {initialFile} onState={state => hangulStatus = state} onExit={() => switchMode('word')} embedded />
                {:else}
                    <EngineProgress engine="hwp" onReady={() => hangulFetched = true} />
                {/if}
            </div>
        {/if}
        {#if pdfLoaded}
            <div class="engine" hidden={active !== 'pdf'} inert={active !== 'pdf'}>
                {#if pdfFetched}
                    {#await pdfModule() then { default: PdfEditor }}
                        <PdfEditor bind:this={pdf} onState={state => pdfStatus = state} />
                    {:catch reason}
                        <p class="notice" role="alert">PDF 편집기를 불러오지 못했습니다. {reason instanceof Error ? reason.message : String(reason)}</p>
                    {/await}
                {:else}
                    <EngineProgress engine="pdf" onReady={() => pdfFetched = true} />
                {/if}
            </div>
        {/if}
    </div>
</div>
<AboutProduct bind:open={about} onEdenText={active === 'word' && wordStatus.ready ? () => frame?.contentWindow?.sketchWord?.about() : undefined} />

<style>
    .editor-shell {height:100dvh;display:flex;flex-direction:column;background:#fff;color:#263547;font-family:system-ui,sans-serif;overflow:hidden;position:relative}
    .engines,.engine {flex:1;min-height:0;height:100%}.engines {position:relative}.engine[hidden] {display:none}
    iframe {display:block;width:100%;height:100%;border:0}
    .notice {font-size:12px;padding:6px 12px;background:#fff5da}

</style>
