<script lang="ts">
    import AboutProduct from './AboutProduct.svelte';
    let open = $state(false);
</script>
<button onclick={() => open = true}>프로그램 정보 · 라이선스 및 소스 코드</button>
<AboutProduct bind:open />
<style>button {display:block;margin:18px auto 0;border:0;background:transparent;color:#62758a;text-decoration:underline;text-underline-offset:4px;font:inherit;font-size:13px;cursor:pointer}button:focus-visible{outline:2px solid #356bb0;outline-offset:4px}</style>
