<script lang="ts">
    // Excel: GridCraft runs in a frame, editing (overlays/gridcraft/sketch-bridge.patch); this component owns the
    // file (docs/plans/2026-10-15-xlsx-edit.md §3.4). A save takes the engine's snapshot, checks it, and only then
    // asks where to write (a save picker empties the file it is given); the file is written inside a lock shared
    // by every tab after checking it still holds what this editor last saw, and only after the write closed is
    // the snapshot reported as saved, so a failed or cancelled save leaves the changes unsaved. Saving over the
    // file that was opened (Save, or Save As onto it) first shows what that loses (decision Q2 ②: the opened file
    // against the engine's snapshot of it right after opening, checked off the main thread — xlsx/losses.ts), then
    // keeps the original in the origin's private storage, then writes; the kept originals can be put back.
    // While there are unsaved changes, a copy of the workbook is kept in the origin's private storage after a
    // pause (xlsx/drafts.ts, plan §3.6); opening the same file again offers a copy no live tab holds, and tabs
    // showing the same file are told of each other.
    // The bridge (xlsxBridge.ts) hears only the engine frame.
    import { onMount } from 'svelte';
    import { createXlsxBridge, MAX_XLSX_BYTES, type Blocked, type EngineRequest, type EngineState, type OpenResult } from './xlsxBridge';
    import { fingerprint, writeIfUnchanged, type PickerWindow } from './fileAccess';
    import { createRecoveryStore } from './pdf/recovery';
    import { createDraftStore, draftKey, holdLock, DRAFT_IDLE_MS, type Draft, type Release } from './xlsx/drafts';
    import { createChecker, type CheckResult } from './xlsx/checker';
    import { EDIT_NOTE, STRUCTURE_WARNING } from './xlsx/losses';
    import { warningText } from './xlsx/engineWarnings';
    import type { RecoveryCopy } from './pdf/recovery';
    import type { EditorStatus } from './editorState';
    let { onState = () => {} }: { onState?: (state: EditorStatus) => void } = $props();
    const pickers = window as PickerWindow;
    const canSave = !!pickers.showSaveFilePicker;
    /** Shared by every Office editor that saves (a file may be open in more than one tab or engine). */
    const LOCK_NAME = 'sketch-docs-office-save';
    const lock = <T,>(work: () => Promise<T>): Promise<T> => (navigator.locks ? navigator.locks.request(LOCK_NAME, work) as Promise<T> : work());
    const recovery = createRecoveryStore(undefined, 'sketch-docs-xlsx-recovery');
    const checker = createChecker();
    // Copies need the lock that keeps another tab's copy from being offered or removed.
    const drafts = navigator.locks && typeof navigator.storage?.getDirectory === 'function' ? createDraftStore() : null;
    const tab = crypto.randomUUID().slice(0, 8);
    // `?draft-idle=<ms>` shortens the pause for the browser checks (1 to 30 seconds).
    const idleMs = (() => { const ms = Number(new URLSearchParams(location.search).get('draft-idle')); return ms >= 1000 && ms < DRAFT_IDLE_MS ? ms : DRAFT_IDLE_MS; })();
    let frame = $state.raw<HTMLIFrameElement>();
    let input = $state<HTMLInputElement>();
    let section = $state<HTMLElement>();
    let ready = $state(false), opening = $state(false), saving = $state(false);
    let name = $state(''), sheets = $state<string[]>([]);
    let error = $state(''), notice = $state('');
    let engine = $state<EngineState>({ dirty: false, editing: false, rev: 0 });
    let version = '', docUid = 0;
    /** The shown workbook came from a recovery copy: unsaved until it is saved. */
    let restored = $state(false);
    /** This tab's copy (its lock held) and the revision it holds. */
    let own: { key: string; release: Release; rev: number; docUid: number } | null = null;
    /** A copy of this file no live tab holds, its lock held by this tab while it is offered. */
    let offer = $state.raw<{ draft: Draft; release: Release } | null>(null);
    /** Other tabs showing the same file. */
    let others = $state.raw<string[]>([]);
    /**
     * The file this editor stands for: as opened, or as last written by Save As (`ours`). `hash` is what the
     * file held then; a write checks the file still holds it.
     */
    let base = $state.raw<{ name: string; bytes: Uint8Array; hash: string; handle?: FileSystemFileHandle; ours: boolean; docUid: number } | null>(null);
    /**
     * The file last opened, as it was: what a save over it would lose (`check`) and its bytes to keep before
     * it is first overwritten. Save As elsewhere does not change it, so choosing it later still warns and
     * keeps it (review 2026-10-16 #1). Without a handle (a dropped file) it is recognised by name.
     */
    let source: { name: string; bytes: Uint8Array; hash: string; handle?: FileSystemFileHandle; check: Promise<CheckResult>; overwritten: boolean } | null = null;
    const bridge = createXlsxBridge({
        target: () => frame?.contentWindow, origin: location.origin,
        onReady: engineVersion => { ready = true; version = engineVersion; },
        onFailed: reason => { ready = false; error = `Excel을 시작하지 못했습니다. WebGPU 또는 WebGL2를 지원하는 브라우저가 필요합니다. (${reason})`; },
        onBlocked: action => { notice = blockedText[action] ?? blockedText.refused; },
        // Every answer the engine gives, even after a timeout, says which workbook it now shows.
        onShown: result => { name = result.name; sheets = result.sheets; docUid = result.docUid; },
        onState: state => { engine = state; settleDraft(); },
        onRequest: request => { void requested(request); },
    });
    const blockedText: Record<Blocked, string> = {
        edit: '이 내용은 여기서 바꿀 수 없습니다.',
        save: '저장은 위쪽 막대의 "저장"·"다른 이름으로 저장"을 쓰세요.',
        print: '인쇄할 수 없습니다.',
        drop: '파일을 열려면 "Excel 열기"를 누르세요.',
        refused: '이 명령은 여기서 쓸 수 없습니다. 파일은 위쪽 막대에서 열고 저장하세요.',
    };
    const unsaved = () => engine.dirty || engine.editing || restored;
    // A cell being typed in counts as unsaved: leaving now would lose it.
    export function getState(): EditorStatus { return { ready, busy: opening || saving, dirty: unsaved(), name }; }
    $effect(() => { void ready; void opening; void saving; void name; void engine; onState(getState()); });
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sketch-docs-xlsx') : null;
    onMount(() => {
        const listen = (event: MessageEvent) => { bridge.handle(event); };
        addEventListener('message', listen);
        // Leaving the tab may be closing it: keep the latest changes now rather than after the pause.
        const hidden = () => { if (document.visibilityState === 'hidden') void keepDraft(); };
        document.addEventListener('visibilitychange', hidden);
        const gone = () => channel?.postMessage({ type: 'gone', tab });
        addEventListener('pagehide', gone);
        if (channel) channel.onmessage = ({ data }) => heard(data);
        return () => {
            removeEventListener('message', listen);
            document.removeEventListener('visibilitychange', hidden);
            removeEventListener('pagehide', gone);
            gone();
            channel?.close();
            clearTimeout(idle);
            checker.dispose();
            offer?.release();
            own?.release();
        };
    });

    // Same file in other tabs (decision Q8: told, not stopped; a save checks the file's content anyway). A file
    // is its name and the content it was opened with; a handle cannot be sent.
    const identity = () => (base ? `${base.hash}:${base.name}` : '');
    function heard(data: { type?: string; tab?: string; file?: string }) {
        if (!data?.tab || data.tab === tab) return;
        const same = data.type !== 'gone' && !!data.file && data.file === identity();
        others = [...others.filter(other => other !== data.tab), ...(same ? [data.tab] : [])];
        if (same && data.type === 'open') channel?.postMessage({ type: 'here', tab, file: identity() });
    }
    function announce() { others = []; channel?.postMessage({ type: 'open', tab, file: identity() }); }

    // Recovery copies. Copies and saves take turns (`serial`); a copy is taken only while nothing is being
    // typed, since a snapshot puts what is being typed into the workbook.
    let idle: ReturnType<typeof setTimeout> | undefined;
    let snapshotMs = 0;
    function settleDraft() {
        clearTimeout(idle);
        if (!unsaved()) { void dropDraft(); return; }
        // A slow snapshot (a large workbook) holds the engine still: copies come less often.
        if (base && drafts) idle = setTimeout(() => void keepDraft(), Math.max(idleMs, snapshotMs * 20));
    }
    function keepDraft() {
        if (!drafts || !base || opening || !unsaved() || engine.editing || (own && own.rev === engine.rev && own.docUid === docUid)) return;
        return serial(async () => {
            const opened = base;
            if (!opened || opening || !unsaved() || engine.editing) return;
            const started = performance.now();
            const shot = await bridge.snapshot();
            if (!shot.ok) return;
            snapshotMs = performance.now() - started;
            // Only a save's `saved` changes the engine's saved state; this snapshot is let go at once.
            bridge.discard(shot.id);
            // Another workbook may have replaced it while the snapshot was made (review #5).
            if (base !== opened || opening || shot.docUid !== opened.docUid || !unsaved()) return;
            const key = draftKey(opened.name, opened.hash, tab);
            if (own?.key !== key) {
                await removeOwn();
                own = { key, release: (await holdLock(key))!, rev: -1, docUid: -1 };
            }
            await drafts.write(key, { name: opened.name, source: opened.hash, tab, engine: version, docUid: shot.docUid, epoch: bridge.epoch, rev: shot.rev, snapshotMs: Math.round(snapshotMs) }, shot.bytes);
            own.rev = shot.rev; own.docUid = shot.docUid;
        }).catch(reason => { notice = `복구 사본을 만들지 못했습니다. ${message(reason)}`; });
    }
    async function removeOwn() {
        const mine = own;
        own = null;
        if (!mine) return;
        try { await drafts?.remove(mine.key); } finally { mine.release(); }
    }
    /** No unsaved changes left, or another file shown: this tab's copy goes. */
    function dropDraft() { return serial(removeOwn).catch(() => undefined); }
    /** Looks for a copy of the file just opened that a closed tab left. */
    async function offerDraft() {
        const opened = base;
        offer?.release();
        offer = null;
        if (!drafts || !opened) return;
        const found = await drafts.claim(opened.name, opened.hash, own?.key).catch(() => null);
        if (base !== opened || offer) { found?.release(); return; }
        offer = found;
    }
    async function restoreDraft() {
        const chosen = offer, opened = base;
        if (!chosen || !opened || !drafts) return;
        if (saving) { notice = '저장이 끝난 뒤 복구할 수 있습니다.'; return; }
        if (unsaved() && !confirm('지금 편집한 내용 대신 복구 사본을 열까요?')) return;
        offer = null;
        opening = true;
        try {
            const bytes = await drafts.read(chosen.draft);
            restored = true;
            const result = await bridge.open(opened.name, bytes);
            show(result);
            if (!result.ok) { restored = false; offer = chosen; return; }
            if (base === opened) base = { ...opened, docUid: result.docUid };
            // The copy becomes this tab's own, replacing any it had.
            await serial(async () => { await removeOwn(); own = { key: chosen.draft.key, release: chosen.release, rev: -1, docUid: -1 }; });
            notice = '복구 사본을 열었습니다. 원본 파일은 바뀌지 않았습니다. 저장해야 파일에 남습니다.';
            settleDraft();
        } catch (reason) {
            restored = false;
            offer = chosen;
            error = `복구 사본을 열지 못했습니다. ${message(reason)}`;
        } finally { opening = false; }
    }
    async function discardDraft() {
        const chosen = offer;
        if (!chosen || !drafts) return;
        if (!confirm('복구 사본을 지울까요? 지우면 되돌릴 수 없습니다.')) return;
        offer = null;
        try { await drafts.remove(chosen.draft.key); }
        catch (reason) { error = `복구 사본을 지우지 못했습니다. ${message(reason)}`; }
        finally { chosen.release(); }
        void offerDraft();
    }
    const savedAt = (time: number) => new Date(time).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    function show(result: OpenResult) {
        if (result.ok) { error = ''; notice = result.warnings.length ? `일부 내용이 다르게 표시될 수 있습니다: ${warningText(result.warnings[0])}` : ''; }
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
        // A save in progress stands for the file shown; opening another now would make it write the wrong
        // one (review #2).
        if (saving) { error = '저장하는 중에는 다른 파일을 열 수 없습니다. 저장이 끝난 뒤 다시 여세요.'; return; }
        error = ''; notice = '';
        if (!/\.xlsx$/i.test(fileName)) { error = 'XLSX 파일만 열 수 있습니다.'; return; }
        if (bytes.byteLength > MAX_XLSX_BYTES) { error = `${MAX_XLSX_BYTES / 1024 / 1024}MB보다 큰 파일은 열 수 없습니다.`; return; }
        if (isCompound(bytes)) { error = '암호가 걸린 통합 문서이거나 이전 형식(XLS) 파일이라 열 수 없습니다.'; return; }
        if (!isZip(bytes)) { error = 'XLSX 형식이 아닙니다. 파일이 손상되었을 수 있습니다.'; return; }
        opening = true;
        try {
            const result = await bridge.open(fileName, bytes);
            show(result);
            if (result.ok) {
                const hash = await hashOf(bytes);
                source = { name: fileName, bytes, hash, handle, check: judge(bytes, result.warnings), overwritten: false };
                base = { name: fileName, bytes, hash, handle, ours: false, docUid: result.docUid };
                // The changes shown before are gone (asked first when unsaved), and with them this tab's copy.
                restored = false;
                void dropDraft();
                announce();
                await offerDraft();
            }
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
    function serial<T>(work: () => Promise<T>): Promise<T> { const run = queue.then(work); queue = run.catch(() => undefined); return run; }

    /**
     * What saving over the opened file would lose: the engine's snapshot taken right after opening, compared
     * with the file in a worker. Edits made before the snapshot was taken would show as differences too (more
     * warning, not less).
     */
    function judge(original: Uint8Array, warnings: string[]): Promise<CheckResult> {
        return serial(() => bridge.snapshot()).then(shot => {
            if (!shot.ok) return { id: 0, ok: false, reason: shot.error };
            bridge.discard(shot.id);
            return checker.losses(original, shot.bytes, warnings);
        });
    }
    /** The warning's lines for writing `bytes` over the opened file; empty when nothing would be lost. */
    async function losses(opened: NonNullable<typeof source>, bytes: Uint8Array): Promise<string[]> {
        const judged = await opened.check;
        if (!judged.ok) return [`열 때 검사를 끝내지 못해 무엇이 빠지는지 알 수 없습니다(${judged.reason}).`];
        const now = await checker.structure(bytes);
        if (!now.ok) return [...judged.lines, `시트 구조를 검사하지 못했습니다(${now.reason}).`];
        return now.structure === judged.structure ? judged.lines : [...judged.lines, STRUCTURE_WARNING];
    }
    let ask = $state.raw<{ lines: string[]; answer: (yes: boolean) => void } | null>(null);
    const confirmOverwrite = (lines: string[]) => new Promise<boolean>(resolve => { ask = { lines, answer: yes => { ask = null; resolve(yes); } }; });

    /** Whether `handle` is the file last opened (by handle, or by name when it was opened without one). */
    async function isSource(handle: FileSystemFileHandle) {
        const opened = source;
        if (!opened) return false;
        return opened.handle ? opened.handle.isSameEntry(handle) : handle.name === opened.name;
    }
    function write(kind: Kind, target: () => Promise<{ handle: FileSystemFileHandle; hash: string; picked: boolean } | null>) {
        return serial(async () => {
            if (!canSave) { error = '이 브라우저는 파일 저장을 지원하지 않습니다. 데스크톱 Chrome·Edge를 사용하세요.'; return; }
            if (opening) { error = '파일을 여는 중입니다. 열린 뒤 다시 저장하세요.'; return; }
            saving = true; error = ''; notice = '';
            const shown = base;
            let snapshot: { id: number; docUid: number } | undefined;
            let settled = false;
            const release = () => { if (snapshot && !settled) { settled = true; bridge.discard(snapshot.id); } };
            try {
                const made = await produce(kind);
                if (typeof made === 'string') { error = made; return; }
                snapshot = made.snapshot;
                const chosen = await target();
                if (!chosen) return;
                const original = source;
                if (original && !original.overwritten && await isSource(chosen.handle)) {
                    // The file last opened, not yet overwritten. A save picker has already emptied it, so its
                    // original is kept first, before any check or question (review #3); putting it back on
                    // cancel or refusal does not depend on that copy.
                    const putBack = async () => { if (chosen.picked) await lock(() => writeIfUnchanged(chosen.handle, new Uint8Array(original.bytes), chosen.hash)); };
                    try { await recovery.keep(original.name, original.bytes, original.hash); }
                    catch (reason) {
                        await putBack();
                        error = `원본을 보관하지 못해 저장하지 않았습니다${chosen.picked ? '(고른 파일은 원래 내용으로 되돌렸습니다)' : ''}. ${message(reason)}`;
                        return;
                    }
                    if (kind !== 'xlsx') {
                        await putBack();
                        error = '열었던 통합 문서에는 CSV·PDF를 쓸 수 없어 원래 내용으로 되돌렸습니다. 다른 이름을 고르세요.';
                        return;
                    }
                    const lines = await losses(original, made.bytes);
                    if (lines.length && !await confirmOverwrite(lines)) {
                        await putBack();
                        if (chosen.picked) error = '저장하지 않았습니다. 고른 파일은 원래 내용으로 되돌렸습니다.';
                        else notice = '저장하지 않았습니다.';
                        return;
                    }
                    await lock(async () => {
                        if (await fingerprint(await chosen.handle.getFile()) !== chosen.hash) throw new Error('파일이 외부에서 변경되었습니다. 다른 이름으로 저장하세요.');
                        await writeIfUnchanged(chosen.handle, new Uint8Array(made.bytes), chosen.hash);
                    });
                    source = { ...original, overwritten: true };
                } else await lock(() => writeIfUnchanged(chosen.handle, new Uint8Array(made.bytes), chosen.hash));
                if (snapshot) {
                    settled = true;
                    bridge.saved(snapshot.id, snapshot.docUid, chosen.handle.name);
                    // Only if the shell still shows the workbook this save started from (a guard: opening is
                    // refused while saving).
                    if (base === shown) {
                        base = { name: chosen.handle.name, bytes: made.bytes, hash: await hashOf(made.bytes), handle: chosen.handle, ours: true, docUid: snapshot.docUid };
                        name = chosen.handle.name;
                        restored = false;
                        announce();
                        queueMicrotask(settleDraft);
                    }
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
        return handle ? { handle, hash: await fingerprint(await handle.getFile()), picked: true } : null;
    };
    function saveAs() { return write('xlsx', pickTarget('xlsx')); }
    function exportAs(kind: 'csv' | 'pdf') { return write(kind, pickTarget(kind)); }
    /** Into the file shown: the opened one (after the warning) or the one this editor saved last. */
    async function save() {
        const current = base;
        if (!current?.handle || !canSave) return saveAs();
        const handle = current.handle;
        // Write permission is asked while the click still counts as a user action, before the snapshot.
        const permitted = await (handle as FileSystemFileHandle & { requestPermission?: (options: { mode: string }) => Promise<string> }).requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
        if (permitted !== undefined && permitted !== 'granted') { error = '파일에 쓸 권한이 없어 저장하지 않았습니다. 다른 이름으로 저장하세요.'; return; }
        return write('xlsx', async () => ({ handle, hash: base?.hash ?? current.hash, picked: false }));
    }

    // "보관한 원본": an original kept before it was overwritten is written to a file the user chooses.
    let copies = $state.raw<RecoveryCopy[] | null>(null);
    async function showCopies() {
        if (copies) { copies = null; return; }
        try { copies = await recovery.list(); }
        catch (reason) { error = `보관한 원본을 읽지 못했습니다. ${message(reason)}`; }
    }
    function restoreCopy(copy: RecoveryCopy) {
        return serial(async () => {
            error = ''; notice = ''; saving = true;
            try {
                // Read first: the picker empties the file it returns.
                const bytes = new Uint8Array(await (await recovery.read(copy.file)).arrayBuffer());
                const handle = await chooseSaveFile(copy.name.replace(/\.xlsx$/i, '') + ' (저장 전 원본).xlsx', 'xlsx');
                if (!handle) return;
                await lock(async () => {
                    const stream = await handle.createWritable();
                    try { await stream.write(bytes); await stream.close(); }
                    catch (reason) { await stream.abort().catch(() => undefined); throw reason; }
                });
                copies = null;
                notice = `${copy.name}의 저장 전 원본을 ${handle.name}(으)로 저장했습니다.`;
                // Put back over the file shown: show what it holds now, unless unsaved changes are to stay.
                if (base?.handle && await base.handle.isSameEntry(handle)) {
                    if (unsaved() && !confirm('열린 파일을 저장 전 원본으로 되돌렸습니다. 지금 화면의 저장하지 않은 변경을 버리고 다시 열까요?')) return;
                    saving = false;
                    await loadFile(await handle.getFile(), handle);
                    notice = `${handle.name}을(를) 저장 전 원본으로 되돌리고 다시 열었습니다.`;
                }
            } catch (reason) {
                error = `원본을 복원하지 못했습니다. ${message(reason)}`;
            } finally { saving = false; }
        });
    }
    const when = (time: number) => new Date(time).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
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
        <button type="button" onclick={showCopies} disabled={saving || !canSave} aria-expanded={!!copies}>보관한 원본</button>
        {#if name}<span class="name">{name}</span>{/if}
        {#if unsaved()}<span class="status">저장하지 않은 변경</span>{/if}
        {#if others.length}<span class="status others">이 파일이 다른 탭에서도 열려 있습니다.</span>{/if}
        {#if pickPrompt}<span class="pick" role="status">파일을 만드는 데 시간이 걸렸습니다. <button type="button" onclick={pickPrompt.go}>저장할 위치 고르기</button> <button type="button" onclick={pickPrompt.cancel}>취소</button></span>{/if}
        {#if opening}<span class="status" role="status">여는 중…</span>{:else if saving}<span class="status" role="status">저장하는 중…</span>{:else if !ready && !error}<span class="status" role="status">Excel을 준비하는 중…</span>{:else if notice}<span class="status" role="status">{notice}</span>{/if}
        <input bind:this={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onchange={picked} />
    </header>
    {#if copies}
        <div class="copies" role="region" aria-label="보관한 원본">
            {#if copies.length}
                <p>이 브라우저가 덮어쓰기 전에 보관한 원본입니다. 고르면 저장할 파일을 고릅니다(원래 파일을 고르면 그 자리로 되돌립니다).</p>
                <ul>{#each copies as copy (copy.file)}<li><button type="button" onclick={() => restoreCopy(copy)}>{copy.name} · {when(copy.savedAt)}</button></li>{/each}</ul>
            {:else}
                <p>보관한 원본이 없습니다. 열린 파일에 처음 저장할 때 원본을 보관합니다.</p>
            {/if}
        </div>
    {/if}
    {#if ask}
        <div class="ask" role="dialog" aria-modal="true" aria-labelledby="xlsx-ask-title">
            <div class="ask-box">
                <h2 id="xlsx-ask-title">원본 파일에 저장</h2>
                <p>{base?.name}에 저장하면 이 편집기가 파일을 다시 쓰면서 아래 내용이 빠지거나 바뀝니다. 저장하기 전에 원본을 이 브라우저에 보관하며, "보관한 원본"에서 되돌릴 수 있습니다.</p>
                <ul>{#each ask.lines as line, i (i)}<li>{line}</li>{/each}</ul>
                <p class="note">{EDIT_NOTE}</p>
                <div class="ask-actions">
                    <button type="button" onclick={() => ask?.answer(false)}>취소</button>
                    <button type="button" class="primary" onclick={() => ask?.answer(true)}>그래도 저장</button>
                </div>
            </div>
        </div>
    {/if}
    {#if error}<p class="problem" role="alert">{error}</p>{/if}
    {#if offer}
        <p class="offer" role="status">
            이 파일에서 저장하지 않은 편집 내용의 복구 사본이 있습니다({savedAt(offer.draft.savedAt)}). 편집기가 저장 형식으로 만든 사본이라 일부 서식이 빠질 수 있습니다.
            <button type="button" onclick={restoreDraft} disabled={!ready || opening || saving}>복구</button>
            <button type="button" onclick={discardDraft} disabled={opening}>버리기</button>
        </p>
    {/if}
    <iframe bind:this={frame} title="Excel 편집기" src="./engines/gridcraft/index.html?host=sketch&mode=edit" allow="clipboard-write"></iframe>
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
    .copies {padding:6px 12px;border-bottom:1px solid #dce1e8;font-size:13px}
    .copies p {margin:0 0 4px}
    .copies ul {margin:0;padding-left:18px}
    .copies button {font:inherit;padding:2px 6px;border:0;background:none;color:#1d4ed8;cursor:pointer;text-decoration:underline}
    .ask {position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.35)}
    .ask-box {max-width:520px;width:100%;max-height:calc(100% - 32px);overflow:auto;box-sizing:border-box;padding:16px 18px;border-radius:10px;background:#fff;color:#263547;font-size:14px;box-shadow:0 10px 30px rgba(15,23,42,.25)}
    .ask-box h2 {margin:0 0 8px;font-size:16px}
    .ask-box ul {margin:8px 0;padding-left:20px}
    .ask-box .note {color:#5b6980;font-size:13px}
    .ask-actions {display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
    .ask-actions button {font:inherit;padding:5px 12px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    .ask-actions .primary {background:#1d4ed8;border-color:#1d4ed8;color:#fff}
    .offer {margin:0;padding:6px 12px;background:#eef6ff;color:#1e3a5f;font-size:13px}
    .offer button {font:inherit;margin-left:6px;padding:2px 10px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    iframe {flex:1;min-height:0;width:100%;border:0;display:block}
</style>
