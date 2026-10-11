<script lang="ts">
    import { fileShortcut, isMacPlatform, shortcutLabel } from './hangulShortcuts';
    import type { HangulFormat } from './hangulFiles';
    let { ownerDocument, ready, busy, hasDocument, supported, onNew, onOpen, onSave, onPrint }: {
        ownerDocument: Document; ready: boolean; busy: boolean; hasDocument: boolean; supported: boolean;
        onNew: () => void; onOpen: () => void; onSave: (asNew: boolean, format?: HangulFormat) => void; onPrint: () => void;
    } = $props();
    const mac = $derived(isMacPlatform(ownerDocument.defaultView?.navigator.platform ?? ''));
    let opened = $state(false);
    function run(action: () => void) { opened = false; action(); }
    function dismiss(node: HTMLDetailsElement, doc: Document) {
        const pointer = (event: PointerEvent) => {
            if (!event.composedPath().includes(node)) { node.open = false; opened = false; }
        };
        const shortcut = (event: KeyboardEvent) => {
            const command = fileShortcut(event, mac);
            if (!command) return;
            const modal = [...doc.querySelectorAll('dialog[open], [role="dialog"], .modal-overlay, .dialog-overlay')].some(el => el.getClientRects().length > 0);
            if (modal) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.repeat || !ready || busy) return;
            if (command === 'open' && supported) run(onOpen);
            if (command === 'save' && hasDocument && supported) run(() => onSave(false));
            if (command === 'saveAs' && hasDocument && supported) run(() => onSave(true, 'hwpx'));
            if (command === 'print' && hasDocument) run(onPrint);
        };
        doc.defaultView?.addEventListener('keydown', shortcut, true);
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && node.open) {
                node.open = false;
                opened = false;
                node.querySelector('summary')?.focus();
            }
        };
        const closeOthers = () => {
            doc.querySelectorAll<HTMLElement>('#menu-bar > .menu-item.open > .menu-title').forEach(el => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
        };
        const summary = node.querySelector('summary')!;
        const titles = Array.from(doc.querySelectorAll<HTMLElement>('#menu-bar > .menu-item:not([data-menu="file"]) > .menu-title'));
        const enterFile = () => {
            if (!doc.querySelector('#menu-bar > .menu-item.open')) return;
            closeOthers();
            node.open = true;
            opened = true;
        };
        const enterNative = (event: MouseEvent) => {
            if (!node.open) return;
            node.open = false;
            opened = false;
            const title = event.currentTarget as HTMLElement;
            if (!title.parentElement?.classList.contains('open')) {
                title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            }
        };
        doc.addEventListener('pointerdown', pointer);
        doc.addEventListener('keydown', key, true);
        summary.addEventListener('click', closeOthers);
        summary.addEventListener('mouseenter', enterFile);
        titles.forEach(title => title.addEventListener('mouseenter', enterNative));
        return { destroy() {
            doc.defaultView?.removeEventListener('keydown', shortcut, true);
            doc.removeEventListener('pointerdown', pointer);
            doc.removeEventListener('keydown', key, true);
            summary.removeEventListener('click', closeOthers);
            summary.removeEventListener('mouseenter', enterFile);
            titles.forEach(title => title.removeEventListener('mouseenter', enterNative));
        } };
    }
</script>

<details class="product-file-menu" bind:open={opened} use:dismiss={ownerDocument}>
    <summary class="menu-title">파일</summary>
    <div class="menu-dropdown product-file-dropdown">
        <button class="md-item" onclick={() => run(onNew)} disabled={!ready || busy}><span class="md-icon"></span><span class="md-label">새 문서</span></button>
        <button class="md-item" aria-label="열기…" onclick={() => run(onOpen)} disabled={!ready || busy || !supported}> <span class="md-icon"></span><span class="md-label">열기…</span><span class="md-shortcut">{shortcutLabel('open', mac)}</span></button>
        <div class="md-sep"></div>
        <button class="md-item" aria-label="저장" onclick={() => run(() => onSave(false))} disabled={!ready || !hasDocument || busy || !supported}><span class="md-icon"></span><span class="md-label">저장</span><span class="md-shortcut">{shortcutLabel('save', mac)}</span></button>
        <button class="md-item" aria-label="다른 이름으로 저장 (.hwpx)" onclick={() => run(() => onSave(true, 'hwpx'))} disabled={!ready || !hasDocument || busy || !supported}><span class="md-icon"></span><span class="md-label">다른 이름으로 저장 (.hwpx)</span><span class="md-shortcut">{shortcutLabel('saveAs', mac)}</span></button>
        <button class="md-item" onclick={() => run(() => onSave(true, 'hwp'))} disabled={!ready || !hasDocument || busy || !supported}><span class="md-icon"></span><span class="md-label">다른 이름으로 저장 (.hwp)</span></button>
        <div class="md-sep"></div>
        <button class="md-item" aria-label="인쇄…" onclick={() => run(onPrint)} disabled={!ready || !hasDocument || busy}><span class="md-icon"></span><span class="md-label">인쇄…</span><span class="md-shortcut">{shortcutLabel('print', mac)}</span></button>
    </div>
</details>
