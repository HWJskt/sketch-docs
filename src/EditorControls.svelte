<script lang="ts">
    let { mode, getBlocked, onSwitch, onAbout }: {
        mode: 'word' | 'hwp'; getBlocked: () => boolean;
        onSwitch: (mode: 'word' | 'hwp') => unknown; onAbout: () => void;
    } = $props();
</script>
<header class="product-header" aria-label="Sketch Docs">
    <nav aria-label="편집기 선택">
        <button class:chosen={mode === 'word'} aria-label="Word" aria-pressed={mode === 'word'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'word') onSwitch('word'); }} title="Word 편집기 · DOCX 및 ODT">W</button>
        <button class:chosen={mode === 'hwp'} aria-label="한글" aria-pressed={mode === 'hwp'} disabled={getBlocked()} onclickcapture={() => { if(mode !== 'hwp') onSwitch('hwp'); }} title="한글 편집기 · HWP 및 HWPX">한</button>
    </nav>
    <button class="info" aria-label="프로그램 정보 및 라이선스" title="프로그램 정보 및 라이선스" onclickcapture={onAbout}>ⓘ</button>
</header>
