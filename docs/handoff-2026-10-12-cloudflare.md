# Sketch Docs 공개 배포 준비 인계

작성일: 2026-10-12. 다음 세션의 개발 에이전트가 소스 패키지 경량화와 Cloudflare 공개 배포 준비를 이어가기 위한 기록이다. 현재 구현 기준 커밋은 `9400d87`이며 문서 작성 직전 작업 트리는 깨끗했다. 실제 배포는 하지 않았다.

## 사용자 결정과 다음 작업

- 제품명은 **Sketch Docs**. 병원 직원이 주 사용자지만 **Cloudflare Access 없이 로그인 없는 공개 서비스**로 운영하는 방향을 선택했다.
- 구매 도메인은 `sketchps.app`, 문서 편집기 배포 대상으로 논의한 호스트는 `doc.sketchps.app`이다. 기존 병원 도메인은 `sketchps.com`이다.
- 우리 저장소에는 제품 코드만 두고 `source/`는 Git에서 제외한다. EdenText·HOP·rhwp 원본 클론을 수정하지 않고, 제품 변경은 루트 코드와 빌드 오버레이에 유지한다.
- **새로 합의한 소스 제공 방식:** 우리 코드만 작은 압축파일로 제공하고, 세 원본은 정확한 고정 커밋 다운로드 링크와 자동 복원·빌드 안내로 제공한다. 원본을 압축에서 제외하는 것이 소스 제공 의무 자체를 생략한다는 의미는 아니다.
- 이 변경은 아직 구현하지 않았다. 현재는 원본까지 포함하는 약 152MiB 소스 묶음을 생성한다.
- 이번 마지막 사용자 요청은 인계문서 작성·저장이다. 다음 세션은 이 문서를 읽고 사용자 요청 범위에서 작업한다. Cloudflare 인증이나 외부 업로드·라이브 배포를 완료했다고 간주하지 않는다. 실제 push·배포는 명시 요청 시 진행한다.

## 작업 위치와 원본 버전

작업 폴더: `/Users/hwjung/Coding/edentext-word-hwp`.

| 구성 | 고정 커밋 | 라이선스 |
|---|---|---|
| EdenText | `4c4c94cb46b9c0b1473b9dd323315f9c4d365251` | AGPL-3.0-only |
| HOP | `80888af2b8c8a18aea16f824d2d92309a290b1ad` | MIT |
| rhwp | `1a76570e833917d15817415a53c09ad61ab3203f` / v0.8.7 | MIT |

버전 관리의 기준은 `upstreams.lock.json`이다. EdenText URL은 `https://github.com/stffnb/edentext.git`, HOP는 `https://github.com/golbin/hop.git`, rhwp는 `https://github.com/edwardkim/rhwp.git`이다. `source/hop/third_party/rhwp`는 HOP의 서브모듈이다. `backups/`는 사용자 보존본이며 건드리지 않는다.

코드 작업 전 사용자 AGENTS 지침에 따라 CLAUDE 체인을 읽는다. 루트 `CLAUDE.md`가 저장소 규칙이며 Node 24.21.0을 사용한다. Svelte 파일을 다루면 Svelte 스킬을 적용한다.

## 현재 구조와 유지해야 할 동작

- 루트 셸에서 Word와 한글 편집기를 iframe으로 띄우고 전환 시 양쪽 문서·실행 취소 이력·저장 대상을 유지한다. 편집기 전환은 파일 변환이 아니다.
- `scripts/build-engines.mjs`가 원본을 `.cache/build/`로 복사하고 제품 오버레이를 적용해 `public/engines/word`, `public/rhwp`를 생성한다.
- Word는 DOCX/ODT, 한글은 HWP/HWPX 로컬 파일을 처리한다. 한글 원본 덮어쓰기는 보존 검증 제약 때문에 막혀 있으며 사본 저장 후 해당 사본에 저장하는 방식이다. 이를 배포 준비 중 임의로 해제하지 않는다.
- `src/EditorShell.svelte`, `EditorControls.svelte`, `editorHeader.css`: 첫 행 36px, W·한·ⓘ 3개 버튼 고정 위치와 크기, 오른쪽 10px 공간. 별도 헤더 행을 추가하지 않는다.
- `src/HangulEditor.svelte`, `hangulFiles.ts`, `overlays/rhwp/host-bridge.txt`: 엔진 이벤트 구독으로 파일명과 미저장 상태 갱신. 문서 세대가 바뀌면 이전 파일 핸들을 해제한다.
- `src/HangulFileMenu.svelte`, `hangulShortcuts.ts`: 파일 드롭다운과 OS별 열기·저장·HWPX 다른 이름 저장·인쇄 단축키. 한글 접기 버튼은 파일명 오른쪽이다.
- `overlays/edentext/product-ui.mjs`: 읽기 전용 파일명, Word 파일 메뉴 정보 항목 제거, 툴바 정리. 공통 ⓘ에서 원래 EdenText 정보 창으로 접근한다.
- 페이지 종료는 브라우저 기본 beforeunload 확인창으로 보호한다. 브라우저 탭 종료 시 사용자 정의 ‘저장/버리기/취소’ 모달을 띄울 수 있다고 약속하지 않는다. 앱 내부 문서 교체의 자체 3버튼 모달은 아직 구현하지 않았다.
- Word 오프라인 사용이 지원된다. 한글 새로고침 복구는 지원하지 않는다. 한글 기능 검색은 가능성 검토만 했고 UI는 미구현이다.

## 소스 패키지 경량화 구현 계획

1. `scripts/package-source.mjs`를 먼저 읽는다. 현재 제품 파일 allowlist와 각 원본 Git object pack을 묶고 `SOURCE-README.txt`, 라이선스, `public/legal/release.json`을 생성한다. 계정 설정·비밀값·사용자 파일을 포함하지 않는 allowlist 방식을 유지한다.
2. 배포용 작은 패키지에서 `upstream-packs/*.pack`을 제외한다. 제품 `src`, `overlays`, `scripts`, 빌드 설정, `package-lock.json`, `upstreams.lock.json`, 라이선스, 정확한 복원 안내는 유지한다. 빌드된 결과만 제공하거나 패치 적용 절차를 누락하지 않는다.
3. 원본별 URL·정확한 커밋·라이선스를 manifest/안내에 기록하고, 사용자에게 해당 커밋 소스 다운로드 링크를 제공한다. 저장소 홈 또는 가변 main 링크만 제공하지 않는다. GitHub 소스 압축은 서브모듈 내용이 빠지므로 rhwp를 명시적으로 복원해야 한다.
4. 기존 `scripts/upstreams.mjs`의 sync 절차를 확인해 복원에 재사용한다. HOP vendor WASM과 대응 rhwp 소스 관계 및 기존 lock 검증을 유지한다. 새 환경에서 clone→고정 커밋→패치→빌드가 되는지 검증한다.
5. `src/AboutProduct.svelte`, 소스 안내와 `release.json` 메타데이터를 변경한다. ‘우리 코드 다운로드’와 ‘필요한 원본 소스/빌드 안내’를 명확히 구분한다. 작은 압축만 완전한 독립 소스인 것처럼 표시하지 않는다.
6. 현재 source 패키지 검사와 `scripts/verify.mjs`, `tests/integration.mjs`의 다운로드/재현 검증을 새 계약에 맞춘다. 시험을 삭제하거나 검증 조건을 완화해서 통과시키지 않는다.
7. 원본이 계속 다운로드 가능한지 검사하고 별도 백업을 보존한다. 원본 삭제·비공개화 등으로 링크가 끊기면 백업을 공개 제공할 수 있어야 한다. 현재 로컬 `.cache/source-packs` 존재만으로 공개 제공 의무가 충족되는 것은 아니다.
8. 압축 후 실제 용량을 측정하고 **dist 전체 파일**의 25MiB 초과 여부를 검사한다. 우리 소스만 줄였다고 다른 큰 폰트/자산까지 제한을 통과한다고 가정하지 않는다.

## 라이선스 검토와 남은 작업

로그인은 AGPL·MIT의 요구 사항이 아니다. 무로그인 공개 서비스에서는 익명 사용자도 소스와 고지에 접근할 수 있어야 한다. 우리 저장소 자체를 GitHub public으로 만드는 것은 필수 수단이 아니며 정확한 대응 소스 다운로드와 안내를 제공하는 방식이 가능하다.

AGPL §6(d)는 다른 서버의 대응 소스 제공을 허용하지만, 명확한 안내와 지속적인 이용 가능성에 대한 책임은 배포자에게 남는다. 별도 서버 이용 허용이 곧 ‘원본 링크만 두면 모든 의무를 충족한다’는 뜻은 아니다. 브라우저 JS/WASM 사본 배포와 수정본의 네트워크 이용을 함께 고려한다. MIT 저작권·허가·면책과 타사 고지를 계속 제공한다. 사용자 문서는 편집기로 작성했다는 이유만으로 공개 대상이 되지 않는다.

현재 첫 화면과 공통 ⓘ에 AGPL, EdenText 저작권, 원본 링크, 소스 다운로드, 수정/보증 안내가 있다. `dist/legal/`에는 각 라이선스와 rhwp 타사 고지 등이 생성된다. 작은 소스 패키지로 바꾸더라도 이를 제거하지 않는다.

`docs/validation/2026-10-11-licenses.md`의 남은 작업 일부는 이후 완료되어 오래된 내용이다. 소스 다운로드와 고지 묶음은 구현됐지만 **행복고딕 권리자 재배포 조건 확인, 기타 폰트와 전이 의존성의 고지 완전성 점검은 완료됐다고 선언하지 않았다.** 실제 배포 자산을 대조해 조건을 확보하거나 확인된 자산으로 대체해야 한다. EdenText AI 외부 전송 기능도 있으므로 모든 기능이 로컬 처리만 한다고 홍보하지 않는다.

근거:

- [GNU 소스와 바이너리를 다른 서버에 제공하는 경우](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites)
- 로컬 `LICENSE` §6(d), §13 및 각 원본 LICENSE
- [Cloudflare Pages 제한](https://developers.cloudflare.com/pages/platform/limits/): 단일 파일 최대 25MiB
- [브라우저 beforeunload 제약](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

## Cloudflare 준비 상태

Cloudflare 계정·API 인증·DNS 관리 상태는 확인하지 않았다. 루트에 `wrangler.toml`/`wrangler.jsonc`, `public/_headers`, `public/_redirects`는 이번 점검 시 없었다. Pages 프로젝트 생성과 공개 업로드를 수행하지 않았다.

후속 배포 준비에서는 HTTPS 로컬 파일 API, WASM MIME/경로, iframe 로딩, 서비스워커 캐시와 업데이트, 소스 다운로드, 직접 경로 새로고침을 실제 배포 URL에서 확인한다. 필요한 보안 헤더는 엔진 동작과 함께 검증하고, 무조건 강한 정책을 넣어 WASM·인쇄·폰트 로딩을 깨뜨리지 않는다. 로컬 빌드 산출물을 직접 업로드할지 Cloudflare 빌드에서 원본을 복원할지도 정해야 한다.

## 검증 기록과 실행 명령

최근 커밋:

- `9400d87`: 헤더 정렬, 한글 파일명/dirty 구독, 단축키, 메뉴 정리.
- `e396d50`: 상단 정리, 파일명 표시, 한글 인쇄.
- `8adf415`: 기존 메뉴 행 오른쪽에 공통 전환 버튼 배치.

`9400d87` 코드로 `npm run verify` 종료 0. 루트와 생성된 Word Svelte 검사 오류·경고 0, 계약 검사와 실제 Chrome 배포 빌드 회귀 통과. 버튼 좌표 일치, 파일명/dirty 갱신, 키보드 파일 작업, 접기/펴기, 실제 이탈 확인창 취소 후 세션 유지 등을 검사했다. `source/`의 세 원본 작업 트리도 깨끗했다. 로그 `/tmp/header-release-verify.log`는 임시 자료라 다음 세션에서 없을 수 있다.

```sh
cd /Users/hwjung/Coding/edentext-word-hwp
volta run --node 24.21.0 npm run dev -- --port 5173 --strictPort
gtimeout 300 volta run --node 24.21.0 npm run verify
```

verify 실행 중 제품 파일을 수정하면 소스 일관성 검사에서 실패한다. 수정을 끝낸 뒤 다시 실행한다. 검사 하네스는 localhost:4176과 Chrome을 생성하고 finally에서 종료한다. 사용자 localhost:5173 서버는 임의 종료하지 않는다. 이번 인계 작성에서는 서버를 시작하지 않았다.

OS 파일 선택기·실제 프린터·Windows 실제 키보드·Safari는 별도 수동 검사 영역이다. UI 검사 통과를 라이선스 전체 감사 또는 실제 Cloudflare 배포 검증으로 표현하지 않는다.

## 다음 세션 시작 지시문

“`docs/handoff-2026-10-12-cloudflare.md`를 읽고 Sketch Docs의 무로그인 Cloudflare 배포 준비를 이어가라. 먼저 우리 소스 압축에서 원본 Git pack을 제외하고, 정확한 고정 원본 다운로드와 재현 가능한 빌드 안내로 전환하라. 저작권 고지와 소스 접근을 유지하고 용량·복원·회귀 검사를 수행하라. 원본 클론과 사용자 백업은 수정하지 말라. 실제 배포 전 남은 폰트 라이선스와 Cloudflare 설정을 확인하라.”
