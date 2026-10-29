<script lang="ts">
    import { Thumbnails } from 'svelte-pdf-mini';
    import { selectPages, type PageItem } from './pages';
    let { pages, disabled, selected = $bindable([]), anchor = $bindable(null), onmove, ondelete, onblank, oninsert }: {
        pages: PageItem[]; disabled: boolean; selected?: string[]; anchor?: string | null;
        onmove: (ids: string[], boundary: number) => void;
        ondelete: (ids: string[]) => void;
        onblank: (boundary: number) => void;
        oninsert: (boundary: number) => void;
    } = $props();
    let insertion = $state<number | null>(null);
    let dragging = $state(false);
    let dropAt = $state<number | null>(null);
    const active = $derived(selected.filter(id => pages.some(p => p.id === id)));
    const first = $derived(pages.findIndex(p => active.includes(p.id)));
    const last = $derived(pages.map(p => active.includes(p.id)).lastIndexOf(true));
    function select(event: MouseEvent, id: string) {
        selected = selectPages(pages, active, anchor, id, { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
        if (!event.shiftKey) anchor = id;
    }
    function start(event: DragEvent, id: string) {
        if (disabled) { event.preventDefault(); return; }
        if (!active.includes(id)) selected = [id];
        dragging = true;
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }
    function drop(event: DragEvent, boundary: number) {
        event.preventDefault();
        if (dragging && !disabled) onmove(active, boundary);
        dragging = false; dropAt = null;
    }
</script>
<div class="actions" role="group" aria-label="페이지 편집">
    <span aria-live="polite">{active.length}쪽 선택</span>
    <button type="button" aria-label="선택한 페이지 앞으로" disabled={disabled || first <= 0} onclick={() => onmove(active, first - 1)}>앞으로</button>
    <button type="button" aria-label="선택한 페이지 뒤로" disabled={disabled || last < 0 || last === pages.length - 1} onclick={() => onmove(active, last + 2)}>뒤로</button>
    <button type="button" aria-label="선택한 페이지 삭제" disabled={disabled || !active.length} onclick={() => ondelete(active)}>삭제</button>
</div>
<p class="hint">Shift: 범위 선택 · Ctrl/⌘: 개별 선택<br />끌어서 삽입 위치에 놓으면 이동합니다.</p>
{#snippet gap(boundary: number)}
    <button type="button" class:drop-target={dropAt === boundary} class="insert" disabled={disabled}
        aria-label={boundary === pages.length ? '마지막 쪽 뒤에 삽입' : `${boundary + 1}쪽 앞에 삽입`}
        aria-expanded={insertion === boundary}
        onclick={() => { insertion = insertion === boundary ? null : boundary; }}
        ondragover={event => { if (dragging && !disabled) { event.preventDefault(); dropAt = boundary; } }}
        ondrop={event => drop(event, boundary)}>＋ 삽입</button>
    {#if insertion === boundary}
        <div class="insert-options">
            <button type="button" disabled={disabled} onclick={() => { insertion = null; onblank(boundary); }}>빈 페이지 넣기</button>
            <button type="button" disabled={disabled} onclick={() => { insertion = null; oninsert(boundary); }}>PDF 페이지 넣기</button>
        </div>
    {/if}
{/snippet}
<Thumbnails.Root width={110} followCurrent={false} aria-multiselectable="true">
    {#each pages as page, index (page.id)}
        {@render gap(index)}
        <Thumbnails.Item pageNumber={index + 1}>
            {#snippet child({ props, canvasProps, label })}
                <button {...props} type="button" role="option" aria-selected={active.includes(page.id)} disabled={disabled}
                    draggable={!disabled} class:selected={active.includes(page.id)} class="thumbnail"
                    onclick={event => { (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event); select(event, page.id); }}
                    ondragstart={event => start(event, page.id)} ondragend={() => { dragging = false; dropAt = null; }}>
                    <div {...canvasProps} class="canvas"></div><span>{label}</span>
                </button>
            {/snippet}
        </Thumbnails.Item>
    {/each}
    {@render gap(pages.length)}
</Thumbnails.Root>
<style>
    .actions {display:flex;flex-wrap:wrap;gap:4px;align-items:center}
    .actions span {width:100%;font-size:12px}
    button {font:inherit;color:inherit;border:1px solid #c8d1dd;border-radius:4px;background:#fff;cursor:pointer;padding:4px 7px}
    button:disabled {opacity:.5;cursor:default}
    .hint {font-size:11px;line-height:1.6;color:#5b6980}
    .insert {display:block;width:100%;margin:8px 0;border:1px dashed #aab8cb;font-size:11px}
    .drop-target {background:#dbeafe;border:2px solid #2563eb}
    .insert-options {display:flex;flex-direction:column;gap:4px;margin:6px 0}
    .thumbnail {display:block;margin:auto;padding:5px;border:2px solid transparent;text-align:center}
    .selected {border-color:#2563eb;background:#e8f0ff}
    .canvas {width:110px;min-height:80px;background:white;pointer-events:none}
    .canvas :global(canvas) {display:block;max-width:110px;height:auto}
</style>
