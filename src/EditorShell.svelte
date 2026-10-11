<script lang="ts">
    import { mount, unmount, onMount, onDestroy, tick, untrack } from 'svelte';
    import EditorControls from './EditorControls.svelte';
    import './editorHeader.css';
    import headerCss from './editorHeader.css?raw';
    import HangulEditor from './HangulEditor.svelte';
    import AboutProduct from './AboutProduct.svelte';
    import { offlineReady } from './offline';
    import type { EditorStatus, HangulInput } from './editorState';
    type Mode = 'word' | 'hwp';
    let { initialMode }: { initialMode: Mode } = $props();
    let active = $state<Mode>(untrack(() => initialMode));
    let wordLoaded = $state(untrack(() => initialMode === 'word'));
    let hangulLoaded = $state(untrack(() => initialMode === 'hwp'));
    let onlineReady = $state(false);
    let frame = $state.raw<HTMLIFrameElement>();
    let hangul = $state.raw<HangulEditor>();
    let initialFile = $state.raw<HangulInput | undefined>();
    let controlsReady = $state(false);
    const mountedControls = new Map<Mode, {doc: Document; instance: ReturnType<typeof mount>}>();
    let disposed = false;
    function placeControls() {
        if (disposed) return;
        const doc = active === 'word' ? frame?.contentDocument : hangul?.menuDocument();
        const row = doc?.querySelector(active === 'word' ? '.ribbon-tabs' : '#menu-bar');
        controlsReady = !!row;
        if (!row || !doc || mountedControls.get(active)?.doc === doc) return;
        const previous = mountedControls.get(active);
        if (previous) void unmount(previous.instance);
        const style = doc.createElement('style'); style.textContent = headerCss; doc.head.append(style);
        const wrapper = doc.createElement('div'); wrapper.className = 'sketch-menu-row';
        row.before(wrapper); wrapper.append(row);
        const mode = active;
        const instance = mount(EditorControls, {target: wrapper, props: {
            mode, getBlocked: () => blocked, getName: () => mode === 'hwp' ? hangulStatus.name : '',
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
    const blocked = $derived(wordStatus.busy || hangulStatus.busy);
    function states() {
        return [frame?.contentWindow?.sketchWord?.state() ?? wordStatus, hangul?.getState() ?? hangulStatus];
    }
    function switchMode(mode: Mode, updateUrl = true) {
        if (states().some(state => state.busy)) { notice = '파일 작업이 끝난 뒤 편집기를 전환할 수 있습니다.'; return false; }
        const focused = frame?.contentDocument?.activeElement;
        if (focused && 'blur' in focused) (focused as HTMLElement).blur();
        active = mode;
        if (mode === 'word') wordLoaded = true; else hangulLoaded = true;
        notice = '';
        if (updateUrl) history.pushState({mode}, '', new URL(mode === 'word' ? './word.html' : './hwp.html', location.href));
        document.title = `${mode === 'word' ? 'Word' : '한글'} · Sketch Docs`;
        return true;
    }
    function popstate() {
        const mode = location.pathname.endsWith('/hwp.html') ? 'hwp' : 'word';
        if (!switchMode(mode, false)) history.replaceState({mode: active}, '', new URL(active === 'word' ? './word.html' : './hwp.html', location.href));
    }
    function leaving(event: BeforeUnloadEvent) {
        if (states().some(state => state.dirty || state.busy)) { event.preventDefault(); event.returnValue = ''; }
    }
    onMount(() => {
        let alive = true;
        void offlineReady.then(() => { if (alive) onlineReady = true; });
        const host = {
            wordState(state: EditorStatus) { wordStatus = state; },
            async openHangul(file: HangulInput | undefined = undefined) {
                // This request comes from Word's own open operation; only the target session can block it.
                if (hangul?.getState().busy || (!file && states().some(state => state.busy))) throw new Error('파일 작업이 진행 중입니다.');
                if (hangulLoaded) {
                    await tick();
                    if (!await hangul!.openDocument(file)) return;
                } else { initialFile = file; hangulLoaded = true; }
                active = 'hwp';
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
    {#if !controlsReady}<EditorControls mode={active} getBlocked={() => blocked} onSwitch={switchMode} onAbout={() => about = true} />{/if}
    {#if notice}<div class="notice" role="status">{notice}</div>{/if}
    <div class="engines">
        {#if wordLoaded && onlineReady}
            <div class="engine" hidden={active !== 'word'} inert={active !== 'word'}>
                <iframe bind:this={frame} title="Word 문서 편집기" src="./engines/word/index.html" allow="clipboard-read; clipboard-write" onload={() => { wordStatus = frame?.contentWindow?.sketchWord?.state() ?? wordStatus; }}></iframe>
            </div>
        {/if}
        {#if hangulLoaded}
            <div class="engine" hidden={active !== 'hwp'} inert={active !== 'hwp'}>
                <HangulEditor bind:this={hangul} {initialFile} onState={state => hangulStatus = state} onExit={() => switchMode('word')} embedded />
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
