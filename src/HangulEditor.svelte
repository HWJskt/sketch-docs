<script lang="ts">
    import { bridgeFrom, fingerprint, writeArtifact, type HangulBridge, type HangulFormat, type PickerWindow } from './hangulFiles';
    let { initialFile, onExit, startNew = true, engineUrl = './rhwp/index.html?chrome=embed', homeUrl = './' }: {
        initialFile?: { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null };
        onExit?: () => void;
        startNew?: boolean;
        engineUrl?: string;
        homeUrl?: string;
    } = $props();

    let frame: HTMLIFrameElement;
    let menu: HTMLDetailsElement;
    let menuOpen = $state(false);
    let bridge: HangulBridge | undefined;
    let ready = $state(false);
    let busy = $state(false);
    let hasDocument = $state(false);
    let name = $state('새 문서');
    let format = $state<HangulFormat>('hwpx');
    let message = $state('한글 편집기를 준비하고 있습니다.');
    let target = $state.raw<FileSystemFileHandle | null>(null);
    let original: FileSystemFileHandle | null = null;
    let targetHash = '';
    let targetFormat: HangulFormat = 'hwpx';
    const pickers = window as PickerWindow;
    const supported = !!pickers.showOpenFilePicker && !!pickers.showSaveFilePicker;

    function report(error: unknown) {
        message = error instanceof Error && error.name === 'AbortError' ? '취소했습니다.' : String(error);
    }
    async function loaded() {
        try {
            bridge = bridgeFrom(frame);
            await bridge.ready;
            ready = true;
            message = '새 문서를 만들거나 HWP/HWPX 파일을 여세요.';
            if (initialFile) {
                busy = true;
                await bridge.open(initialFile.bytes, initialFile.name);
                hasDocument = true;
                name = initialFile.name;
                original = initialFile.handle;
                format = /\.hwpx$/i.test(name) ? 'hwpx' : 'hwp';
                message = '파일을 열었습니다. 원본 보존 검증 전에는 다른 이름으로 저장하세요.';
            } else if (startNew) await create();
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    function canReplace() {
        return !hasDocument || !bridge?.dirty() || confirm('저장하지 않은 변경을 버리고 문서를 바꾸시겠습니까?');
    }
    async function replaceDocument(operation: () => Promise<unknown>) {
        const previousEpoch = hasDocument ? bridge?.state().epoch : undefined;
        try { await operation(); }
        catch (error) {
            let epoch: number | undefined;
            try { epoch = bridge?.state().epoch; } catch { /* No document after failed initialization. */ }
            if (epoch !== previousEpoch) {
                target = original = null;
                hasDocument = false;
            }
            throw error;
        }
    }
    async function create() {
        menuOpen = false;
        if (busy || !bridge || !canReplace()) return;
        busy = true;
        try {
            await replaceDocument(() => bridge!.create());
            hasDocument = true;
            name = '새 문서';
            format = 'hwpx';
            target = original = null;
            message = '새 문서입니다. 저장할 형식을 선택하세요.';
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    async function open() {
        menuOpen = false;
        if (busy || !ready || !bridge || !supported || !canReplace()) return;
        busy = true;
        try {
            const [handle] = await pickers.showOpenFilePicker!({ multiple: false, types: [{ description: '한글 문서', accept: { 'application/octet-stream': ['.hwp', '.hwpx'] } }] });
            const file = await handle.getFile();
            if (!/\.(hwp|hwpx)$/i.test(file.name)) throw new Error('HWP/HWPX 파일을 선택하세요.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            await replaceDocument(() => bridge!.open(bytes, file.name));
            hasDocument = true;
            name = file.name;
            format = /\.hwpx$/i.test(name) ? 'hwpx' : 'hwp';
            original = handle;
            target = null;
            message = '파일을 열었습니다. 원본 보존 검증 전에는 다른 이름으로 저장하세요.';
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    async function save(asNew: boolean) {
        menuOpen = false;
        if (busy || !ready || !bridge || !hasDocument || !supported) return;
        busy = true;
        try {
            const handle = asNew || !target || format !== targetFormat ? await pickers.showSaveFilePicker!({
                suggestedName: name.replace(/\.(hwp|hwpx)$/i, '') + '.' + format,
                types: [{ description: format.toUpperCase(), accept: { 'application/octet-stream': ['.' + format] } }],
            }) : target;
            if (original && await original.isSameEntry(handle)) throw new Error('원본 보존 검증 전에는 원본과 다른 파일을 선택하세요.');
            if (!handle.name.toLowerCase().endsWith('.' + format)) throw new Error('선택한 형식과 파일 확장자가 일치해야 합니다.');
            const hash = target && await target.isSameEntry(handle) ? targetHash : await fingerprint(await handle.getFile());
            const artifact = bridge.export(format);
            await writeArtifact(handle, artifact, hash);
            target = handle;
            targetFormat = format;
            name = handle.name;
            targetHash = await fingerprint(new File([new Uint8Array(artifact.bytes)], name));
            const clean = bridge.acknowledge(artifact.version, name);
            message = clean ? `${name} 저장 완료` : `${name} 저장 완료 — 이후 변경은 아직 저장하지 않았습니다.`;
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    function exit() {
        menuOpen = false;
        if (busy || !canReplace()) return;
        if (onExit) onExit();
        else window.location.assign(homeUrl);
    }
    function closeMenu(event: PointerEvent) {
        if (menuOpen && event.target instanceof Node && !menu?.contains(event.target)) menuOpen = false;
    }
    function menuKey(event: KeyboardEvent) {
        if (event.key === 'Escape' && menuOpen) {
            menuOpen = false;
            menu?.querySelector('summary')?.focus();
        }
    }
    function leaving(event: BeforeUnloadEvent) {
        if (busy || bridge?.dirty()) { event.preventDefault(); event.returnValue = ''; }
    }
</script>

<svelte:window onbeforeunload={leaving} onpointerdown={closeMenu} onkeydown={menuKey} onblur={() => { menuOpen = false; }} />
<main class="hangul-editor">
    <header>
        <details bind:this={menu} bind:open={menuOpen}>
            <summary>파일 <span aria-hidden="true">▾</span></summary>
            <div class="file-menu">
                <button onclick={create} disabled={!ready || busy}>새 문서</button>
                <button onclick={open} disabled={!ready || busy || !supported}>열기…</button>
                <hr />
                <button onclick={() => save(false)} disabled={!ready || !hasDocument || busy || !supported}>저장</button>
                <button onclick={() => save(true)} disabled={!ready || !hasDocument || busy || !supported}>다른 이름으로 저장…</button>
                <label>저장 형식
                    <select bind:value={format} disabled={busy}>
                        <option value="hwpx">HWPX</option>
                        <option value="hwp">HWP</option>
                    </select>
                </label>
                <hr />
                <button onclick={exit} disabled={busy}>문서 형식 선택</button>
            </div>
        </details>
        <span class="document-name" title={name}>{name}</span>
    </header>
    <section inert={busy || !ready} aria-label="한글 편집 영역">
        <iframe bind:this={frame} src={engineUrl} title="한글 문서 편집기" onload={loaded} allow="clipboard-read; clipboard-write"></iframe>
    </section>
    <footer role="status" aria-live="polite">
        <span>{busy ? '처리 중…' : message}</span>
        {#if !supported}<span>파일 열기·저장은 데스크톱 Chrome 또는 Edge에서 사용할 수 있습니다.</span>{/if}
    </footer>
</main>

<style>
    .hangul-editor { width: 100%; height: 100dvh; min-height: 0; display: flex; flex-direction: column; font-family: system-ui, sans-serif; color: #243047; background: #f5f6f8; }
    header { height: 38px; flex: 0 0 38px; display: flex; align-items: center; gap: 16px; padding: 0 14px; border-bottom: 1px solid #dce1e8; background: white; }
    details { position: relative; flex-shrink: 0; }
    summary { padding: 7px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary span { margin-left: 7px; color: #788397; }
    summary:hover, details[open] summary { background: #edf2f8; }
    .document-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .file-menu { position: absolute; top: calc(100% + 5px); left: 0; z-index: 20; width: 235px; max-width: calc(100vw - 40px); padding: 6px; border: 1px solid #d4dce7; border-radius: 6px; background: white; box-shadow: 0 6px 20px #17233a20; }
    button { display: block; width: 100%; border: 0; background: transparent; text-align: left; padding: 8px 10px; border-radius: 3px; font: inherit; font-size: 13px; color: inherit; cursor: pointer; }
    button:hover:enabled { background: #edf2f8; }
    button:disabled { color: #929baa; cursor: default; }
    button:focus-visible, summary:focus-visible, select:focus-visible { outline: 2px solid #356cc2; outline-offset: -2px; }
    label { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; font-size: 13px; }
    select { padding: 4px 7px; border: 1px solid #d4dce7; border-radius: 3px; background: white; color: inherit; font: inherit; }
    hr { border: 0; border-top: 1px solid #e5e9ef; margin: 5px 3px; }
    section { flex: 1; min-height: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
    footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; min-height: 24px; padding: 4px 14px; box-sizing: border-box; border-top: 1px solid #dce1e8; font-size: 11px; line-height: 1.5; color: #5b6779; }
</style>
