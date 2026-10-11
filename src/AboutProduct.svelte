<script lang="ts">
    import { onMount } from 'svelte';
    let { open = $bindable(false) }: { open?: boolean } = $props();
    interface Release { sourceBytes: number; version: string; generatedAt: string; sourceUrl: string; licenseUrl: string; noticesUrl: string; upstreams: { edentext: {commit:string}; hop:{commit:string}; rhwp:{version:string;commit:string} } }
    let dialog = $state<HTMLDialogElement>();
    let release = $state<Release>();
    let error = $state('');
    async function load() {
        error = '';
        try {
            const response = await fetch('./legal/release.json', {cache:'no-store'});
            if (!response.ok) throw new Error('프로그램 정보를 불러오지 못했습니다.');
            release = await response.json();
        } catch { error = '프로그램 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.'; }
    }
    onMount(() => { void load(); });
    $effect(() => {
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    });
</script>
<dialog bind:this={dialog} aria-labelledby="product-about-title" onclose={() => open = false} onclick={event => { if(event.target === dialog) open = false; }}>
    <div class="card">
        <button class="close" aria-label="프로그램 정보 닫기" onclick={() => open = false}>×</button>
        <div class="logo" aria-hidden="true">S<span>▤</span></div>
        <h1 id="product-about-title">Sketch <span>Docs</span></h1>
        <p class="tagline">Word와 한글을 한곳에서</p>
        <p class="description">브라우저에서 사용하는 문서 편집기</p>
        {#if release}
            <p class="version">버전 {release.version}</p>
            <p class="license">AGPL-3.0-only · 오픈 소스</p>
            <a class="source" href={release.sourceUrl} download>↓ 이 버전의 소스 다운로드 ({Math.ceil(release.sourceBytes / 1024 / 1024)} MB)</a>
            <div class="links"><a href={release.licenseUrl} target="_blank" rel="noopener">프로그램 라이선스</a><a href={release.noticesUrl} target="_blank" rel="noopener">오픈소스 및 타사 라이선스</a></div>
            <details>
                <summary>구성요소와 수정 정보</summary>
                <p>EdenText · AGPL-3.0-only · {release.upstreams.edentext.commit.slice(0,8)}</p>
                <p>HOP · MIT · {release.upstreams.hop.commit.slice(0,8)}</p>
                <p>rhwp · MIT · {release.upstreams.rhwp.version}</p>
                <p>Sketch Docs는 원본에 한국어 설정, 편집기 연결과 메뉴 변경을 적용한 배포판입니다.</p>
                <p>빌드 날짜: {release.generatedAt.slice(0,10)}</p>
            </details>
            <p class="terms">라이선스 조건에 따라 사용·수정·재배포할 수 있습니다.<br />관련 법률이 허용하는 범위에서 보증 없이 제공됩니다.<br />각 구성요소의 저작권과 라이선스는 원저작자에게 있습니다.</p>
        {:else if error}
            <p role="alert">{error}</p><button onclick={load}>다시 시도</button>
        {:else}<p role="status">프로그램 정보를 불러오는 중…</p>{/if}
    </div>
</dialog>
<style>
    dialog {padding:0;border:1px solid #d5dae1;border-radius:16px;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 40px);color:#344154;background:white;box-shadow:0 18px 70px #14223840;font-family:system-ui,sans-serif}
    dialog::backdrop {background:#18263860}.card {position:relative;padding:30px 28px 24px;text-align:center}.close {position:absolute;right:10px;top:8px;font-size:28px;line-height:28px;border:0;background:transparent;color:#5c6778;cursor:pointer;width:32px;height:32px;border-radius:5px}
    .logo {width:52px;height:54px;margin:0 auto 12px;border:2px solid #567494;border-radius:8px 15px 8px 8px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#46698f}.logo span{font-size:17px;color:#2a7c70;margin-left:2px}
    h1 {font-size:36px;margin:0;color:#476d93;letter-spacing:-1px}h1 span {color:#2b7a6d}.tagline {font-size:17px;margin:10px 0}.description,.version,.license {font-size:14px;color:#697383}.version{margin-bottom:4px}.license{margin-top:4px}
    .source {display:block;margin:22px auto 16px;padding:11px 14px;border:1px solid #bacbda;border-radius:7px;text-decoration:none;color:#284d73;background:#f2f7fc;font-weight:600;font-size:15px}.source:hover{background:#e5eef7}
    .links {display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:center;font-size:13px}.links a{color:#566576;text-underline-offset:3px}
    details {text-align:left;margin-top:22px;font-size:12px;color:#647082;border-top:1px solid #e3e7ed;padding-top:14px}summary{cursor:pointer}details p{line-height:1.6}.terms{font-size:11px;line-height:1.7;color:#778292;margin:18px 0 0}
    :focus-visible{outline:2px solid #356bb0;outline-offset:3px}
</style>
