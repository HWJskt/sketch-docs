<script lang="ts">
    import type { EditorMode } from './routes';
    let { mode, getBlocked, onSwitch, onAbout, getName = () => '', getDirty = () => false }: {
        getName?: () => string; getDirty?: () => boolean; mode: EditorMode; getBlocked: () => boolean;
        onSwitch: (mode: EditorMode) => unknown; onAbout: () => void;
    } = $props();
</script>
<header class:with-name={!!getName()} class="product-header" aria-label="Sketch Docs">
    {#if getName()}<div class="product-document-meta"><span class="product-document-name" title={getName()} aria-label="현재 파일 이름">{getName()}</span>{#if getDirty()}<span class="product-document-dirty">• 저장하지 않음</span>{/if}</div>{/if}
    <div class="product-switches">
    <nav aria-label="편집기 선택">
        <button class:chosen={mode === 'word'} aria-label="Word" aria-pressed={mode === 'word'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'word') onSwitch('word'); }} title="Word 편집기 · DOCX 및 ODT">W</button>
        <button class:chosen={mode === 'hwp'} aria-label="한글" aria-pressed={mode === 'hwp'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'hwp') onSwitch('hwp'); }} title="한글 편집기 · HWP 및 HWPX">한</button>
        <button class:chosen={mode === 'pdf'} aria-label="PDF" aria-pressed={mode === 'pdf'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'pdf') onSwitch('pdf'); }} title="PDF 보기 · 주석">PDF</button>
        <button class:chosen={mode === 'xlsx'} aria-label="Excel" aria-pressed={mode === 'xlsx'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'xlsx') onSwitch('xlsx'); }} title="Excel 보기 전용 · XLSX">X</button>
    </nav>
    <button class="info" aria-label="프로그램 정보 및 라이선스" title="프로그램 정보 및 라이선스" onclickcapture={onAbout}>ⓘ</button>
    </div>
</header>
