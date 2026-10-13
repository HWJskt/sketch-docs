<script lang="ts">
    import { mount, unmount, onDestroy } from 'svelte';
    import type { EditorStatus, HangulInput } from './editorState';
    import HangulFileMenu from './HangulFileMenu.svelte';
    import { assertNoContentLoss, bridgeFrom, writeArtifact, type HangulBridge, type HangulFormat } from './hangulFiles';
    import { fingerprint, type PickerWindow } from './fileAccess';
    let { initialFile, onExit, startNew = true, engineUrl = './rhwp/index.html?chrome=embed', homeUrl = './', embedded = false, onState }: {
        initialFile?: { bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null };
        onExit?: () => void;
        startNew?: boolean;
        engineUrl?: string;
        homeUrl?: string;
        embedded?: boolean;
        onState?: (state: EditorStatus) => void;
    } = $props();

    let frame: HTMLIFrameElement;
    let fileMenu: ReturnType<typeof mount> | undefined;
    let unsubscribeState: (() => void) | undefined;
    let documentEpoch: number | undefined;
    let dirty = $state(false);
    onDestroy(() => { unsubscribeState?.(); if (fileMenu) void unmount(fileMenu); });
    let bridge: HangulBridge | undefined;
    let ready = $state(false);
    let busy = $state(false);
    let hasDocument = $state(false);
    let name = $state('새 문서');
    let format = $state<HangulFormat>('hwpx');
    let message = $state('한글 편집기를 준비하고 있습니다.');
    let target = $state.raw<FileSystemFileHandle | null>(null);
    let original: FileSystemFileHandle | null = null;
    // The opened file's bytes: a save picker empties the file it returns, so if the original is chosen by
    // mistake it is written back from here.
    let originalBytes: Uint8Array | null = null;
    let targetHash = '';
    let targetFormat: HangulFormat = 'hwpx';
    const pickers = window as PickerWindow;
    const supported = !!pickers.showOpenFilePicker && !!pickers.showSaveFilePicker;

    let initialized!: () => void;
    const initialization = new Promise<void>(resolve => { initialized = resolve; });
    export function menuDocument() { return frame?.contentDocument; }
    export function getState(): EditorStatus {
        return { ready, busy, dirty: hasDocument && !!bridge?.dirty(), name };
    }
    $effect(() => { onState?.({ready, busy, dirty, name}); });
    export async function openDocument(file: HangulInput | undefined = undefined): Promise<boolean> {
        await initialization;
        if (!ready || busy || !bridge) throw new Error('한글 편집기가 아직 준비되지 않았습니다.');
        if (!canReplace()) return false;
        if (!file) { await create(true); return true; }
        busy = true;
        try {
            await replaceDocument(() => bridge!.open(file.bytes, file.name));
            hasDocument = true; name = file.name; original = file.handle; originalBytes = file.handle ? file.bytes.slice() : null; target = null;
            format = /\.hwpx$/i.test(name) ? 'hwpx' : 'hwp';
            message = '파일을 열었습니다. 원본 보존 검증 전에는 다른 이름으로 저장하세요.';
            return true;
        } finally { busy = false; }
    }
    function report(error: unknown) {
        message = error instanceof Error && error.name === 'AbortError' ? '취소했습니다.' : String(error);
    }
    async function loaded() {
        try {
            bridge = bridgeFrom(frame);
            await bridge.ready;
            unsubscribeState?.();
            documentEpoch = undefined;
            unsubscribeState = bridge.subscribe(state => {
                if (documentEpoch !== undefined && state.epoch !== documentEpoch) {
                    target = original = null; originalBytes = null; targetHash = '';
                }
                documentEpoch = state.epoch;
                name = state.name || '새 문서';
                dirty = state.dirty;
                hasDocument = state.hasDocument;
            });
            if (fileMenu) await unmount(fileMenu);
            const doc = frame.contentDocument!;
            const edit = doc.querySelector('#menu-bar > [data-menu="edit"]');
            if (!edit) throw new Error('한글 편집기의 메뉴 구성이 변경되었습니다.');
            doc.querySelector('#product-file-menu-host')?.remove();
            const host = doc.createElement('div');
            host.id = 'product-file-menu-host';
            edit.before(host);
            fileMenu = mount(HangulFileMenu, { target: host, props: {
                ownerDocument: doc,
                get ready() { return ready; }, get busy() { return busy; },
                get hasDocument() { return hasDocument; }, supported,
                onNew: create, onOpen: open, onSave: save, onPrint: print,
            } });
            ready = true;
            message = '새 문서를 만들거나 HWP/HWPX 파일을 여세요.';
            if (initialFile) {
                busy = true;
                await bridge.open(initialFile.bytes, initialFile.name);
                hasDocument = true;
                name = initialFile.name;
                original = initialFile.handle;
                originalBytes = initialFile.handle ? initialFile.bytes.slice() : null;
                format = /\.hwpx$/i.test(name) ? 'hwpx' : 'hwp';
                message = '파일을 열었습니다. 원본 보존 검증 전에는 다른 이름으로 저장하세요.';
            } else if (startNew) await create();
        } catch (error) { report(error); }
        finally { busy = false; initialized(); }
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
                target = original = null; originalBytes = null;
                hasDocument = false;
            }
            throw error;
        }
    }
    async function create(confirmed = false) {
        if (busy || !bridge || (!confirmed && !canReplace())) return;
        busy = true;
        try {
            await replaceDocument(() => bridge!.create());
            hasDocument = true;
            name = '새 문서';
            format = 'hwpx';
            target = original = null; originalBytes = null;
            message = '새 문서입니다. 저장할 형식을 선택하세요.';
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    async function open() {
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
            originalBytes = bytes.slice();
            target = null;
            message = '파일을 열었습니다. 원본 보존 검증 전에는 다른 이름으로 저장하세요.';
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    async function save(asNew: boolean, requestedFormat: HangulFormat = format) {
        if (busy || !ready || !bridge || !hasDocument || !supported) return;
        // A cancelled or failed save keeps the previous format and target.
        const chosen = requestedFormat;
        busy = true;
        try {
            // Export and check first: a save picker empties an existing file as soon as it is chosen, so nothing
            // may be refused after it opens.
            const artifact = bridge.export(chosen);
            assertNoContentLoss(artifact);
            const picked = asNew || !target || chosen !== targetFormat;
            const handle = picked ? await pickers.showSaveFilePicker!({
                suggestedName: name.replace(/\.(hwp|hwpx)$/i, '') + '.' + chosen,
                types: [{ description: chosen.toUpperCase(), accept: { 'application/octet-stream': ['.' + chosen] } }],
            }) : target!;
            if (picked && original && await original.isSameEntry(handle)) {
                // The picker emptied the original: put its bytes back before refusing.
                if (!originalBytes) throw new Error('원본 파일을 선택해 원본이 비워졌습니다. 원본을 다시 저장할 수 없습니다.');
                const stream = await handle.createWritable();
                try { await stream.write(new Uint8Array(originalBytes)); await stream.close(); }
                catch (error) { await stream.abort().catch(() => undefined); throw new Error(`원본 파일을 선택해 원본이 비워졌고, 되돌리지 못했습니다. ${error instanceof Error ? error.message : String(error)}`); }
                throw new Error('원본 보존 검증 전에는 원본과 다른 파일을 선택하세요. 선택하면서 비워진 원본은 되돌렸습니다.');
            }
            if (!handle.name.toLowerCase().endsWith('.' + chosen)) throw new Error('선택한 형식과 파일 확장자가 일치해야 합니다.');
            // A picked file holds what it holds now (emptied if it existed); the current target must still hold what was saved.
            const hash = picked ? await fingerprint(await handle.getFile()) : targetHash;
            await writeArtifact(handle, artifact, hash);
            target = handle;
            format = targetFormat = chosen;
            name = handle.name;
            targetHash = await fingerprint(new File([new Uint8Array(artifact.bytes)], name));
            const clean = bridge.acknowledge(artifact.version, name);
            message = clean ? `${name} 저장 완료` : `${name} 저장 완료 — 이후 변경은 아직 저장하지 않았습니다.`;
        } catch (error) { report(error); }
        finally { busy = false; }
    }
    async function print() {
        if (busy || !ready || !bridge || !hasDocument) return;
        busy = true;
        try { await bridge.print(); message = '인쇄 창을 닫았습니다.'; }
        catch (error) { report(error); }
        finally { busy = false; }
    }
    function leaving(event: BeforeUnloadEvent) {
        if (busy || bridge?.dirty()) { event.preventDefault(); event.returnValue = ''; }
    }
</script>

<svelte:window onbeforeunload={leaving} />
<main class="hangul-editor" class:embedded>
    <section inert={busy || !ready} aria-label="한글 편집 영역">
        <iframe bind:this={frame} src={engineUrl} title="한글 문서 편집기" onload={loaded} allow="clipboard-read; clipboard-write"></iframe>
    </section>
    <footer role="status" aria-live="polite">
        <span class="document-name" title={name}>{name}</span>
        <span>{busy ? '처리 중…' : message}</span>
        {#if !supported}<span>파일 열기·저장은 데스크톱 Chrome 또는 Edge에서 사용할 수 있습니다.</span>{/if}
    </footer>
</main>

<style>
    .hangul-editor { width: 100%; height: 100dvh; min-height: 0; display: flex; flex-direction: column; font-family: system-ui, sans-serif; color: #243047; background: #f5f6f8; }
    .hangul-editor.embedded { height: 100%; }
    .document-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    section { flex: 1; min-height: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
    footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; min-height: 24px; padding: 4px 14px; box-sizing: border-box; border-top: 1px solid #dce1e8; font-size: 11px; line-height: 1.5; color: #5b6779; }
</style>
