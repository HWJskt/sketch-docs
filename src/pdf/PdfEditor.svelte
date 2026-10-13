<script lang="ts">
    import { setupPdf } from './setup';
    setupPdf();
</script>

<section class="pdf-editor" aria-label="PDF 편집기">
    <p class="empty">PDF 파일을 여세요.</p>
</section>

<style>
    .pdf-editor {height:100%;display:flex;flex-direction:column;background:#eef0f3;font-family:system-ui,sans-serif;color:#3b4a60}
    .empty {margin:auto;font-size:14px}
</style>
