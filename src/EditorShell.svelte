<script lang="ts">
    import { onMount, tick, untrack } from 'svelte';
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
    <header class="product-header" aria-label="Sketch Docs">
        <nav aria-label="편집기 선택">
            <button class:chosen={active === 'word'} aria-pressed={active === 'word'} disabled={blocked} onclick={() => { if(active !== 'word') switchMode('word'); }} title="Word 편집기 · DOCX 및 ODT"><span class="document-icon word" aria-hidden="true">W</span>Word</button>
            <button class:chosen={active === 'hwp'} aria-pressed={active === 'hwp'} disabled={blocked} onclick={() => { if(active !== 'hwp') switchMode('hwp'); }} title="한글 편집기 · HWP 및 HWPX"><span class="document-icon hangul" aria-hidden="true">한</span>한글</button>
        </nav>
        <span class="brand">Sketch Docs</span>
        <button class="info" aria-label="프로그램 정보 및 라이선스" title="프로그램 정보 및 라이선스" onclick={() => about = true}>ⓘ</button>
    </header>
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
<AboutProduct bind:open={about} />

<style>
    .editor-shell {height:100dvh;display:flex;flex-direction:column;background:#fff;color:#263547;font-family:system-ui,sans-serif;overflow:hidden}
    .product-header {height:40px;flex:0 0 40px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:0 10px;border-bottom:1px solid #d9dfe7;background:#f8fafc}
    nav {display:flex;gap:4px;height:32px}
    button {font:inherit;cursor:pointer;border:1px solid transparent;background:transparent;color:inherit;border-radius:5px}
    nav button {display:flex;align-items:center;gap:7px;padding:3px 12px;font-size:13px}
    nav button.chosen {background:#e8eff8;border-color:#9cb4d2;font-weight:700;box-shadow:inset 0 -2px #466d9b}
    button:hover:enabled {background:#e8eef5} button:disabled {opacity:.55;cursor:wait}
    .document-icon {width:18px;height:22px;display:grid;place-items:center;border-radius:2px 5px 2px 2px;color:#fff;font-size:12px;font-weight:700}
    .word {background:#436d9e}.hangul {background:#28756b}
    .brand {margin-left:auto;font-size:12px;color:#657185}.info {font-size:23px;width:30px;height:30px;line-height:24px}
    button:focus-visible {outline:2px solid #356bb0;outline-offset:1px}
    .engines,.engine {flex:1;min-height:0;height:100%}.engines {position:relative}.engine[hidden] {display:none}
    iframe {display:block;width:100%;height:100%;border:0}
    .notice {font-size:12px;padding:6px 12px;background:#fff5da}
    @media(max-width:420px){.brand {display:none}.info {margin-left:auto}nav button{padding-inline:9px}}
</style>
