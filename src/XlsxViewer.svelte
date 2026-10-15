<script lang="ts">
    // Excel: GridCraft runs in a frame, editing (overlays/gridcraft/sketch-bridge.patch); this component owns the
    // file (docs/plans/2026-10-15-xlsx-edit.md §3.4). A save takes the engine's snapshot, checks it, and only then
    // asks where to write (a save picker empties the file it is given); the file is written inside a lock shared
    // by every tab after checking it still holds what this editor last saw, and only after the write closed is
    // the snapshot reported as saved, so a failed or cancelled save leaves the changes unsaved. Saving over the
    // file that was opened comes with stage 2 (the round-trip check and its warning): until then Save writes into
    // a file this editor made with Save As, and a Save As onto the opened file puts its original back.
    // The bridge (xlsxBridge.ts) hears only the engine frame.
    import { onMount } from 'svelte';
    import { createXlsxBridge, MAX_XLSX_BYTES, type Blocked, type EngineRequest, type EngineState, type OpenResult } from './xlsxBridge';
    import { fingerprint, writeIfUnchanged, type PickerWindow } from './fileAccess';
    import { createRecoveryStore } from './pdf/recovery';
    import type { EditorStatus } from './editorState';
    let { onState = () => {} }: { onState?: (state: EditorStatus) => void } = $props();
    const pickers = window as PickerWindow;
    const canSave = !!pickers.showSaveFilePicker;
    /** Shared by every Office editor that saves (a file may be open in more than one tab or engine). */
    const LOCK_NAME = 'sketch-docs-office-save';
    const lock = <T,>(work: () => Promise<T>): Promise<T> => (navigator.locks ? navigator.locks.request(LOCK_NAME, work) as Promise<T> : work());
    const recovery = createRecoveryStore(undefined, 'sketch-docs-xlsx-recovery');
    let frame = $state.raw<HTMLIFrameElement>();
    let input = $state<HTMLInputElement>();
    let section = $state<HTMLElement>();
    let ready = $state(false), opening = $state(false), saving = $state(false);
    let name = $state(''), sheets = $state<string[]>([]);
    let error = $state(''), notice = $state('');
    let engine = $state<EngineState>({ dirty: false, editing: false, rev: 0 });
    /**
     * The file this editor stands for: as opened, or as last written by Save As (`ours`). `hash` is what the
     * file held then; a write checks the file still holds it.
     */
    let base = $state.raw<{ name: string; bytes: Uint8Array; hash: string; handle?: FileSystemFileHandle; ours: boolean } | null>(null);
    const bridge = createXlsxBridge({
        target: () => frame?.contentWindow, origin: location.origin,
        onReady: () => { ready = true; },
        onFailed: reason => { ready = false; error = `Excel을 시작하지 못했습니다. WebGPU 또는 WebGL2를 지원하는 브라우저가 필요합니다. (${reason})`; },
        onBlocked: action => { notice = blockedText[action] ?? blockedText.refused; },
        // Every answer the engine gives, even after a timeout, says which workbook it now shows.
        onShown: result => { name = result.name; sheets = result.sheets; },
        onState: state => { engine = state; },
        onRequest: request => { void requested(request); },
    });
    const blockedText: Record<Blocked, string> = {
        edit: '보기 전용입니다. 이 화면에서는 내용을 바꿀 수 없습니다.',
        save: '저장은 위쪽 막대의 "저장"·"다른 이름으로 저장"을 쓰세요.',
        print: '인쇄할 수 없습니다.',
        drop: '파일을 열려면 "Excel 열기"를 누르세요.',
        refused: '이 명령은 여기서 쓸 수 없습니다. 파일은 위쪽 막대에서 열고 저장하세요.',
    };
    const unsaved = () => engine.dirty || engine.editing;
    // A cell being typed in counts as unsaved: leaving now would lose it.
    export function getState(): EditorStatus { return { ready, busy: opening || saving, dirty: unsaved(), name }; }
    $effect(() => { void ready; void opening; void saving; void name; void engine; onState(getState()); });
    onMount(() => {
        const listen = (event: MessageEvent) => { bridge.handle(event); };
        addEventListener('message', listen);
        return () => removeEventListener('message', listen);
    });

    function show(result: OpenResult) {
        if (result.ok) { error = ''; notice = result.warnings.length ? `일부 내용이 다르게 표시될 수 있습니다: ${result.warnings[0]}` : ''; }
        else if (result.code !== 'superseded') error = result.code === 'password' ? '암호가 걸린 통합 문서는 열 수 없습니다.' : `파일을 열지 못했습니다. ${result.error}`;
    }
    const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
    // .xlsx only (2026-10-15 user decision); GridCraft would open any other bytes as text.
    const starts = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte);
    const isZip = (bytes: Uint8Array) => starts(bytes, [0x50, 0x4b, 0x03, 0x04]);
    // An OLE compound file: a password-protected workbook (Excel encrypts .xlsx into one) or an old .xls renamed.
    const isCompound = (bytes: Uint8Array) => starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const hashOf = (bytes: Uint8Array) => fingerprint(new Blob([new Uint8Array(bytes)]));
    async function load(fileName: string, bytes: Uint8Array, handle?: FileSystemFileHandle) {
        error = ''; notice = '';
        if (!/\.xlsx$/i.test(fileName)) { error = 'XLSX 파일만 열 수 있습니다.'; return; }
        if (bytes.byteLength > MAX_XLSX_BYTES) { error = `${MAX_XLSX_BYTES / 1024 / 1024}MB보다 큰 파일은 열 수 없습니다.`; return; }
        if (isCompound(bytes)) { error = '암호가 걸린 통합 문서이거나 이전 형식(XLS) 파일이라 열 수 없습니다.'; return; }
        if (!isZip(bytes)) { error = 'XLSX 형식이 아닙니다. 파일이 손상되었을 수 있습니다.'; return; }
        opening = true;
        try {
            const result = await bridge.open(fileName, bytes);
            show(result);
            if (result.ok) base = { name: fileName, bytes, hash: await hashOf(bytes), handle, ours: false };
        } catch (reason) {
            error = `파일을 열지 못했습니다. ${message(reason)}`;
        } finally { opening = false; }
    }
    async function loadFile(file: File, handle?: FileSystemFileHandle) {
        if (file.size > MAX_XLSX_BYTES) { error = `${MAX_XLSX_BYTES / 1024 / 1024}MB보다 큰 파일은 열 수 없습니다.`; return; }
        try { await load(file.name, new Uint8Array(await file.arrayBuffer()), handle); }
        catch (reason) { error = `파일을 열지 못했습니다. ${message(reason)}`; }
    }
    const keepChanges = () => !unsaved() || confirm('저장하지 않은 변경이 있습니다. 다른 파일을 열까요?');
    async function choose() {
        if (!keepChanges()) return;
        if (!pickers.showOpenFilePicker) { input?.click(); return; }
        let handle: FileSystemFileHandle;
        try {
            [handle] = await pickers.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel 통합 문서', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
        } catch (reason) {
            if ((reason as DOMException)?.name !== 'AbortError') error = `파일을 열지 못했습니다. ${String(reason)}`;
            return;
        }
        await loadFile(await handle.getFile(), handle);
    }
    function picked() { const file = input?.files?.[0]; if (input) input.value = ''; if (file) void loadFile(file); }

    // What the engine's menus, shortcuts and dropped files ask for (B1: File › Open › Browse opens the shell's picker).
    async function requested(request: EngineRequest) {
        if (request.action === 'open') {
            if (!request.file) return choose();
            if (keepChanges()) await load(request.file.name, request.file.bytes);
            return;
        }
        if (request.action === 'save') return save();
        if (request.action === 'saveAs') return saveAs();
        return exportAs(request.action === 'exportCsv' ? 'csv' : 'pdf');
    }

    type Kind = 'xlsx' | 'csv' | 'pdf';
    const TYPES: Record<Kind, { description: string; accept: Record<string, string[]> }> = {
        xlsx: { description: 'Excel 통합 문서', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
        csv: { description: 'CSV(쉼표로 구분)', accept: { 'text/csv': ['.csv'] } },
        pdf: { description: 'PDF 문서', accept: { 'application/pdf': ['.pdf'] } },
    };
    const stem = () => (base?.name ?? name ?? 'Book').replace(/\.[^.]+$/, '') || 'Book';
    // A save picker needs a recent click. When making the file took longer than that, one more click is asked for.
    let pickPrompt = $state.raw<{ go: () => void; cancel: () => void } | null>(null);
    async function chooseSaveFile(suggestedName: string, kind: Kind): Promise<FileSystemFileHandle | null> {
        const open = () => pickers.showSaveFilePicker!({ suggestedName, types: [TYPES[kind]] });
        try { return await open(); }
        catch (reason) {
            const which = (reason as DOMException)?.name;
            if (which === 'AbortError') return null;
            if (which !== 'SecurityError' && which !== 'NotAllowedError') throw reason;
        }
        return new Promise((resolve, reject) => {
            pickPrompt = {
                go: () => { pickPrompt = null; open().then(resolve, reason => (reason as DOMException)?.name === 'AbortError' ? resolve(null) : reject(reason)); },
                cancel: () => { pickPrompt = null; resolve(null); },
            };
        });
    }
    /** The bytes to write, checked, before any target is chosen; a workbook also names its snapshot. */
    async function produce(kind: Kind): Promise<{ bytes: Uint8Array; snapshot?: { id: number; docUid: number } } | string> {
        if (kind === 'xlsx') {
            const shot = await bridge.snapshot();
            if (!shot.ok) return shot.error;
            if (!isZip(shot.bytes)) { bridge.discard(shot.id); return '저장할 통합 문서를 만들지 못했습니다(형식이 맞지 않음).'; }
            return { bytes: shot.bytes, snapshot: { id: shot.id, docUid: shot.docUid } };
        }
        const made = await bridge.exportFile(kind);
        if (!made.ok) return made.error;
        if (kind === 'pdf' && !starts(made.bytes, [0x25, 0x50, 0x44, 0x46])) return 'PDF를 만들지 못했습니다.';
        return { bytes: made.bytes };
    }
    // Saves and exports in this tab run one at a time.
    let queue: Promise<unknown> = Promise.resolve();
    function serial(work: () => Promise<void>) { const run = queue.then(work); queue = run.catch(() => undefined); return run; }
    function write(kind: Kind, target: () => Promise<{ handle: FileSystemFileHandle; hash: string } | null>) {
        return serial(async () => {
            if (!canSave) { error = '이 브라우저는 파일 저장을 지원하지 않습니다. 데스크톱 Chrome·Edge를 사용하세요.'; return; }
            saving = true; error = ''; notice = '';
            let snapshot: { id: number; docUid: number } | undefined;
            let settled = false;
            const release = () => { if (snapshot && !settled) { settled = true; bridge.discard(snapshot.id); } };
            try {
                const made = await produce(kind);
                if (typeof made === 'string') { error = made; return; }
                snapshot = made.snapshot;
                const chosen = await target();
                if (!chosen) return;
                const opened = base;
                if (opened?.handle && !opened.ours && await opened.handle.isSameEntry(chosen.handle)) {
                    // The opened file was chosen and the picker has emptied it: its original goes back (kept in
                    // the origin's private storage first). Saving over it comes with stage 2's check and warning.
                    await lock(async () => {
                        await recovery.keep(opened.name, opened.bytes, opened.hash);
                        await writeIfUnchanged(chosen.handle, new Uint8Array(opened.bytes), chosen.hash);
                    });
                    error = '열었던 파일에는 아직 저장할 수 없어 원래 내용으로 되돌렸습니다. 다른 이름을 고르세요.';
                    return;
                }
                await lock(() => writeIfUnchanged(chosen.handle, new Uint8Array(made.bytes), chosen.hash));
                if (snapshot) {
                    settled = true;
                    bridge.saved(snapshot.id, snapshot.docUid, chosen.handle.name);
                    base = { name: chosen.handle.name, bytes: made.bytes, hash: await hashOf(made.bytes), handle: chosen.handle, ours: true };
                    name = chosen.handle.name;
                    notice = `저장했습니다: ${chosen.handle.name}`;
                } else notice = `내보냈습니다: ${chosen.handle.name}`;
            } catch (reason) {
                error = `저장하지 못했습니다. ${message(reason)}`;
            } finally {
                release();
                saving = false;
            }
        });
    }
    const pickTarget = (kind: Kind) => async () => {
        const handle = await chooseSaveFile(`${stem()}.${kind}`, kind);
        return handle ? { handle, hash: await fingerprint(await handle.getFile()) } : null;
    };
    function saveAs() { return write('xlsx', pickTarget('xlsx')); }
    function exportAs(kind: 'csv' | 'pdf') { return write(kind, pickTarget(kind)); }
    /** Into the file this editor saved last; the opened file itself waits for stage 2. */
    async function save() {
        const current = base;
        if (!current?.handle || !current.ours || !canSave) return saveAs();
        const handle = current.handle;
        // Write permission is asked while the click still counts as a user action, before the snapshot.
        const permitted = await (handle as FileSystemFileHandle & { requestPermission?: (options: { mode: string }) => Promise<string> }).requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
        if (permitted !== undefined && permitted !== 'granted') { error = '파일에 쓸 권한이 없어 저장하지 않았습니다. 다른 이름으로 저장하세요.'; return; }
        return write('xlsx', async () => ({ handle, hash: base?.hash ?? current.hash }));
    }
    function shortcut(event: KeyboardEvent) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
        // Only while the Excel editor is the one shown (the shell hides the others); inside the engine frame the
        // engine asks for it instead.
        if (!section || section.closest('[hidden]') || !section.isConnected) return;
        event.preventDefault();
        void (event.shiftKey ? saveAs() : save());
    }
</script>

<svelte:window onkeydown={shortcut} />
<section bind:this={section} class="xlsx-viewer" aria-label="Excel" data-ready={ready} data-sheets={sheets.length} data-saving={saving}>
    <header class="toolbar">
        <button type="button" onclick={choose} disabled={!ready || opening || saving}>Excel 열기</button>
        <button type="button" onclick={save} disabled={!ready || !base || saving || !canSave} title={canSave ? undefined : '이 브라우저는 파일 저장을 지원하지 않습니다. 데스크톱 Chrome·Edge를 사용하세요.'}>저장</button>
        <button type="button" onclick={saveAs} disabled={!ready || !base || saving || !canSave}>다른 이름으로 저장</button>
        <button type="button" onclick={() => exportAs('csv')} disabled={!ready || !base || saving || !canSave}>CSV로 내보내기</button>
        <button type="button" onclick={() => exportAs('pdf')} disabled={!ready || !base || saving || !canSave}>PDF로 내보내기</button>
        {#if name}<span class="name">{name}</span>{/if}
        {#if unsaved()}<span class="status">저장하지 않은 변경</span>{/if}
        {#if pickPrompt}<span class="pick" role="status">파일을 만드는 데 시간이 걸렸습니다. <button type="button" onclick={pickPrompt.go}>저장할 위치 고르기</button> <button type="button" onclick={pickPrompt.cancel}>취소</button></span>{/if}
        {#if opening}<span class="status" role="status">여는 중…</span>{:else if saving}<span class="status" role="status">저장하는 중…</span>{:else if !ready && !error}<span class="status" role="status">Excel을 준비하는 중…</span>{:else if notice}<span class="status" role="status">{notice}</span>{/if}
        <input bind:this={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onchange={picked} />
    </header>
    {#if error}<p class="problem" role="alert">{error}</p>{/if}
    <iframe bind:this={frame} title="Excel 보기" src="./engines/gridcraft/index.html?host=sketch&mode=edit" allow="clipboard-write"></iframe>
</section>

<style>
    .xlsx-viewer {height:100%;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#263547}
    /* The shell header floats over the right end (editorHeader.css, 172px; the file name stays here, not in it). */
    .toolbar {display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-height:36px;box-sizing:border-box;padding:4px 190px 4px 12px;border-bottom:1px solid #dce1e8;background:#fff;font-size:13px}
    .toolbar button {font:inherit;padding:4px 10px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    .toolbar button:disabled {opacity:.55;cursor:default}
    .name {font-weight:600;min-width:0;max-width:min(260px,100%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .status {color:#5b6980;font-size:12px}
    .pick {font-size:12px}
    .problem {margin:0;padding:6px 12px;background:#fff1ee;color:#9a3412;font-size:13px}
    iframe {flex:1;min-height:0;width:100%;border:0;display:block}
</style>
