<script lang="ts">
    import { onMount } from 'svelte';
    import { ManifestError, type Engine, type Progress } from './enginePreload';
    import { preloader } from './engines';
    let { engine, onReady }: { engine: Engine; onReady: () => void } = $props();
    const label = $derived({ word: 'Word', hwp: '한글', pdf: 'PDF', xlsx: 'Excel' }[engine]);
    let progress = $state<Progress>({ loaded: 0, total: 0 });
    let stalled = $state(false);
    let failed = $state('');
    let alive = true, attempt = 0;
    const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

    async function start() {
        // A retry abandons the previous attempt; only the latest one may report.
        const mine = ++attempt;
        failed = ''; stalled = false;
        try {
            await preloader.prepare(engine, { onProgress: value => { if (value.loaded !== progress.loaded) stalled = false; progress = value; }, onStall: () => stalled = true });
        } catch (error) {
            if (!alive || mine !== attempt) return;
            // The list of files is optional (offline or an old deployment): open the editor the normal way.
            if (error instanceof ManifestError) return onReady();
            failed = error instanceof Error ? error.message : String(error);
            return;
        }
        if (alive && mine === attempt) onReady();
    }
    async function retry() { await preloader.restart(engine); void start(); }
    onMount(() => { void start(); return () => { alive = false; }; });
</script>

<section class="engine-progress" aria-label="{label} 엔진 준비">
    <h2>{label} 엔진 다운로드 중…</h2>
    <progress max={progress.total || 1} value={progress.loaded} aria-label="{label} 엔진 다운로드"></progress>
    <p>{progress.total ? `${mb(progress.loaded)} / ${mb(progress.total)} MB` : '파일 목록을 확인하고 있습니다.'}</p>
    {#if failed}
        <p class="problem" role="alert">{failed}</p>
        <div class="actions"><button type="button" onclick={retry}>다시 시도</button><button type="button" onclick={onReady}>그대로 열기</button></div>
    {:else if stalled}
        <p class="problem">연결이 느립니다. 계속 기다리거나 다시 시도할 수 있습니다.</p>
        <div class="actions"><button type="button" onclick={retry}>다시 시도</button></div>
    {/if}
</section>

<style>
    .engine-progress {height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;box-sizing:border-box;background:#f5f6f8;color:#3b4a60;font-family:system-ui,sans-serif;text-align:center}
    h2 {margin:0;font-size:17px;font-weight:650}
    progress {width:min(360px,80vw);height:8px;accent-color:#2563eb}
    p {margin:0;font-size:13px;color:#5b6980}
    .problem {color:#9a4b00;max-width:420px;line-height:1.6}
    .actions {display:flex;gap:8px}
    button {font:inherit;font-size:13px;padding:6px 14px;border:1px solid #c8d1dd;border-radius:6px;background:#fff;color:#243047;cursor:pointer}
    button:hover {border-color:#6e93ca}
</style>
