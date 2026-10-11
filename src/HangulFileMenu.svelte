<script lang="ts">
    import type { HangulFormat } from './hangulFiles';
    let { ownerDocument, ready, busy, hasDocument, supported, onNew, onOpen, onSave, onExit }: {
        ownerDocument: Document; ready: boolean; busy: boolean; hasDocument: boolean; supported: boolean;
        onNew: () => void; onOpen: () => void; onSave: (asNew: boolean, format?: HangulFormat) => void; onExit: () => void;
    } = $props();
    let opened = $state(false);
    function run(action: () => void) { opened = false; action(); }
    function dismiss(node: HTMLDetailsElement, doc: Document) {
        const pointer = (event: PointerEvent) => {
            if (!event.composedPath().includes(node)) { node.open = false; opened = false; }
        };
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
        doc.addEventListener('pointerdown', pointer);
        doc.addEventListener('keydown', key, true);
        node.querySelector('summary')!.addEventListener('click', closeOthers);
        return { destroy() {
            doc.removeEventListener('pointerdown', pointer);
            doc.removeEventListener('keydown', key, true);
            node.querySelector('summary')!.removeEventListener('click', closeOthers);
        } };
    }
</script>

<details class="product-file-menu" bind:open={opened} use:dismiss={ownerDocument}>
    <summary class="menu-title">파일</summary>
    <div class="menu-dropdown product-file-dropdown">
        <button class="md-item" onclick={() => run(onNew)} disabled={!ready || busy}>새 문서</button>
        <button class="md-item" onclick={() => run(onOpen)} disabled={!ready || busy || !supported}>열기…</button>
        <div class="md-sep"></div>
        <button class="md-item" onclick={() => run(() => onSave(false))} disabled={!ready || !hasDocument || busy || !supported}>저장</button>
        <button class="md-item" onclick={() => run(() => onSave(true, 'hwpx'))} disabled={!ready || !hasDocument || busy || !supported}>다른 이름으로 저장 (.hwpx)</button>
        <button class="md-item" onclick={() => run(() => onSave(true, 'hwp'))} disabled={!ready || !hasDocument || busy || !supported}>다른 이름으로 저장 (.hwp)</button>
        <div class="md-sep"></div>
        <button class="md-item" onclick={() => run(onExit)} disabled={busy}>문서 형식 선택</button>
    </div>
</details>
