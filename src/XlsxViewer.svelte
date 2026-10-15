<script lang="ts">
    // Excel view-only: GridCraft runs in a frame (overlays/gridcraft/view-only.patch); this component owns
    // which file is shown and never writes one. The bridge (xlsxBridge.ts) hears only that frame.
    import { onMount } from 'svelte';
    import { createXlsxBridge, MAX_XLSX_BYTES, type Blocked, type OpenResult } from './xlsxBridge';
    import type { PickerWindow } from './fileAccess';
    import type { EditorStatus } from './editorState';
    let { onState = () => {} }: { onState?: (state: EditorStatus) => void } = $props();
    const pickers = window as PickerWindow;
    let frame = $state.raw<HTMLIFrameElement>();
    let input = $state<HTMLInputElement>();
    let ready = $state(false), opening = $state(false);
    let name = $state(''), sheets = $state<string[]>([]);
    let error = $state(''), notice = $state('');
    const bridge = createXlsxBridge({
        target: () => frame?.contentWindow, origin: location.origin,
        onReady: () => { ready = true; },
        onFailed: reason => { ready = false; error = `Excel 보기를 시작하지 못했습니다. WebGPU 또는 WebGL2를 지원하는 브라우저가 필요합니다. (${reason})`; },
        onBlocked: action => { notice = blockedText[action] ?? blockedText.edit; },
        // Every answer the engine gives, even after a timeout, says which workbook it now shows.
        onShown: result => { name = result.name; sheets = result.sheets; },
    });
    const blockedText: Record<Blocked, string> = {
        edit: '보기 전용입니다. 이 화면에서는 내용을 바꿀 수 없습니다.',
        save: '보기 전용입니다. 저장·내보내기는 지원하지 않습니다.',
        print: '보기 전용입니다. 인쇄는 지원하지 않습니다.',
        drop: '파일을 열려면 "Excel 열기"를 누르세요.',
    };
    export function getState(): EditorStatus { return { ready, busy: opening, dirty: false, name }; }
    $effect(() => { void ready; void opening; void name; onState(getState()); });
    onMount(() => {
        const listen = (event: MessageEvent) => { bridge.handle(event); };
        addEventListener('message', listen);
        return () => removeEventListener('message', listen);
    });

    function show(result: OpenResult) {
        if (result.ok) { error = ''; notice = result.warnings.length ? `일부 내용이 다르게 표시될 수 있습니다: ${result.warnings[0]}` : ''; }
        else if (result.code !== 'superseded') error = result.code === 'password' ? '암호가 걸린 통합 문서는 열 수 없습니다.' : `파일을 열지 못했습니다. ${result.error}`;
    }
    // .xlsx only for now (2026-10-15 user decision); GridCraft would open any other bytes as text.
    const starts = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte);
    const isZip = (bytes: Uint8Array) => starts(bytes, [0x50, 0x4b, 0x03, 0x04]);
    // An OLE compound file: a password-protected workbook (Excel encrypts .xlsx into one) or an old .xls renamed.
    const isCompound = (bytes: Uint8Array) => starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    async function load(file: File) {
        error = ''; notice = '';
        if (!/\.xlsx$/i.test(file.name)) { error = 'XLSX 파일만 열 수 있습니다.'; return; }
        if (file.size > MAX_XLSX_BYTES) { error = `${MAX_XLSX_BYTES / 1024 / 1024}MB보다 큰 파일은 열 수 없습니다.`; return; }
        opening = true;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (isCompound(bytes)) { error = '암호가 걸린 통합 문서이거나 이전 형식(XLS) 파일이라 열 수 없습니다.'; return; }
            if (!isZip(bytes)) { error = 'XLSX 형식이 아닙니다. 파일이 손상되었을 수 있습니다.'; return; }
            show(await bridge.open(file.name, bytes));
        } catch (reason) {
            error = `파일을 열지 못했습니다. ${reason instanceof Error ? reason.message : String(reason)}`;
        } finally { opening = false; }
    }
    async function choose() {
        if (!pickers.showOpenFilePicker) { input?.click(); return; }
        let handle: FileSystemFileHandle;
        try {
            [handle] = await pickers.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel 통합 문서', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
        } catch (reason) {
            if ((reason as DOMException)?.name !== 'AbortError') error = `파일을 열지 못했습니다. ${String(reason)}`;
            return;
        }
        await load(await handle.getFile());
    }
    function picked() { const file = input?.files?.[0]; if (input) input.value = ''; if (file) void load(file); }
</script>

<section class="xlsx-viewer" aria-label="Excel 보기" data-ready={ready} data-sheets={sheets.length}>
    <header class="toolbar">
        <button type="button" onclick={choose} disabled={!ready || opening}>Excel 열기</button>
        <span class="badge" title="편집·저장은 아직 지원하지 않습니다.">보기 전용</span>
        {#if name}<span class="name">{name}</span>{/if}
        {#if opening}<span class="status" role="status">여는 중…</span>{:else if !ready && !error}<span class="status" role="status">Excel 보기를 준비하는 중…</span>{:else if notice}<span class="status" role="status">{notice}</span>{/if}
        <input bind:this={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onchange={picked} />
    </header>
    {#if error}<p class="problem" role="alert">{error}</p>{/if}
    <iframe bind:this={frame} title="Excel 보기" src="./engines/gridcraft/index.html?host=sketch" allow="clipboard-write"></iframe>
</section>

<style>
    .xlsx-viewer {height:100%;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#263547}
    /* The shell header floats over the right end (editorHeader.css, 172px; the file name stays here, not in it). */
    .toolbar {display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-height:36px;box-sizing:border-box;padding:4px 190px 4px 12px;border-bottom:1px solid #dce1e8;background:#fff;font-size:13px}
    .toolbar button {font:inherit;padding:4px 12px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    .toolbar button:disabled {opacity:.55;cursor:default}
    .badge {padding:2px 8px;border-radius:10px;background:#eef3e8;color:#3d6b21;font-size:12px}
    .name {font-weight:600;min-width:0;max-width:min(260px,100%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .status {color:#5b6980;font-size:12px}
    .problem {margin:0;padding:6px 12px;background:#fff1ee;color:#9a3412;font-size:13px}
    iframe {flex:1;min-height:0;width:100%;border:0;display:block}
</style>
