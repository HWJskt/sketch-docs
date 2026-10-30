# 통합 웹 편집기

- **최신 인계: `docs/handoff-2026-10-15-xlsx-edit.md`** — 새 세션은 여기서 시작한다(Excel 편집 배포 `4230e0d`(2026-10-16) 결과·사람 확인 절차, 지킬 결정·overlay 고치는 법). `docs/handoff-2026-10-15.md`(배포 `d9f41e7`까지)와 `docs/handoff-2026-10-14.md`는 지난 기록이다.
- 루트가 우리 제품 저장소다. `source/edentext`, `source/hop`와 rhwp 서브모듈은 읽기 전용 upstream 클론이다. 제품 변경은 루트 `src/`, `overlays/`, `scripts/`, `tests/`에 둔다.
- `backups/`는 사용자 작업 보존본이다. 삭제·정리하지 않는다. `.cache/`와 `public/engines`, `public/rhwp`는 우리 빌드 생성물이며 다시 만들 수 있다.
- Node 24.21.0, Svelte 5, Vite 8. 새 의존성·upstream 업데이트는 lock과 회귀 검사로 검증한다.
- `npm run dev`: 원본 검증/엔진 빌드 후 localhost. 원본 폴더에서 제품 서버를 실행하지 않는다.
- `npm run verify`: 양쪽 타입 검사·저장 계약·실제 Chrome 회귀 검사. 배포 전 필수. OS 파일 선택기와 Word/한컴 재열기는 별도 수동 검사다.
- Excel 보기 엔진(gridcraft)은 `prepare:engines`가 Trunk로 빌드한다. 도구는 lock에 고정된 판만 허용한다: Rust 1.99.0(`RUSTUP_TOOLCHAIN`으로만, 기본 stable은 바꾸지 않는다)·trunk 0.21.14·wasm-bindgen 0.2.129·wasm-opt 133. 입력이 같으면 재빌드를 생략한다. 계획·결과는 `docs/plans/2026-10-15-xlsx-view.md`.
- `upstream:check`는 후보만 검증하고 이전 체크아웃으로 돌아온다. 실패를 무시하거나 패치 검사 조건을 느슨하게 만들어 통과시키지 않는다. `upstream:promote`는 검사 당시 소스 해시가 맞을 때만 버전 lock을 바꾼다.
- 어떤 실행도 사용자 편집 파일, upstream 수정 파일, 백업을 덮어쓰거나 삭제하지 않는다.
- 공개 저장소 `HWJskt/sketch-docs`(public). push하면 바로 공개된다. 원본 코드·`backups/`·비밀값은 올리지 않는다. push는 명시 요청 때만 한다.
- 브라우저 테스트는 playwright-core와 설치된 Chrome을 사용하고, 자신이 시작한 서버·브라우저는 finally에서 닫는다.
  - 하나만: 빌드된 `dist/`로 `node tests/regressions.mjs`(`pdf.integration.mjs`·`integration.mjs`, 다른 출력은 `TEST_DIST=`). 단위 테스트는 `node --import ./tests/ts-resolve.mjs --test tests/<파일>`(Word 엔진 tsconfig가 `.ts` import를 막는다).
  - Word는 `navigator.language`의 Hunspell 사전을 시작 뒤 받는다(이 기기 ko는 없음, CI en은 1.3MB). 네트워크를 재는 시나리오는 `locale`을 고정한다. 저장 선택기는 고른 파일을 비운다 — 검사는 선택기 전에(공통 정본 `~/Coding/.claude/docs/stacks/기타-실측함정.md` §4).
- PDF 편집기는 npm `svelte-pdf-mini`를 정확한 버전으로 고정해 공개 API만 쓴다(패치·overlay 없음). 저장 정책·보존 검사의 근거는 `docs/plans/2026-10-13-pdf-viewer.md`.
  - 페이지 편집(순서·삭제·삽입)은 `@cantoo/pdf-lib`로 재구성한다. 그 문서는 Ctrl+S를 막고, OS 저장 창으로만 저장한다(`원본이름-편집.pdf`, 창을 열기 전에 손실 확인·export·복구 사본까지 끝낸다). 결정·근거: `docs/plans/2026-10-29-pdf-page-edit.md`(2026-10-30 사용자 결정 포함).
- 구조·실행·업데이트 절차는 README.md, 목표·계획·검증 결과는 docs/에 기록한다.

## 배포 (배포)

- 정책: **명시 요청 때만 배포한다.** push만으로는 배포되지 않는다(Git 연동 자동 배포 없음). 2026-10-12 사용자 결정.
- 대상: Cloudflare Pages 프로젝트 `sketch-docs` → `docs.sketchps.app`.
- 절차: `npm run verify` → 커밋을 `origin/main`에 push(pre-push 게이트가 각 ref의 끝 커밋에 대해 verify 보고를 확인하거나 임시 worktree에서 다시 검사, `npm run hooks:install` 필요. verify가 브라우저 시험을 영어 Chrome으로 한 번 더 돈다) → `gh run list --limit 3`으로 CI verify(가벼운 검사) 확인 → `npm run mirrors:check`(필요하면 `mirrors:pin`) → `npm run deploy`.
  - `deploy`는 다음을 모두 확인한 뒤에만 wrangler로 `dist/`를 올린다: 검증 보고와 커밋·코드·`dist` 해시 일치, 깨끗한 작업 트리, push된 커밋, 보존 fork의 고정 커밋 태그.
  - `deploy`는 `artifacts/verified.json`의 커밋이 HEAD와 같아야 한다. verify 뒤에 문서만 고친 커밋이 생겨도 다시 돌려야 한다(push 게이트의 worktree 재검사는 로컬 verified.json을 갱신하지 않는다, 2026-10-29). verify는 마지막 커밋에서 돌린다.
  - 문서만 바꾼 커밋(`*.md`·`docs/`, `src`·`scripts`·`overlays`·`tests`·`public` 밖)은 push 게이트가 직전 검증 커밋의 보고로 통과시키고 CI verify도 돌지 않는다(`isDocPath`, 2026-10-30). Cloudflare는 원래 push로 빌드하지 않는다.
- wrangler는 4.149.0(2026-10-14 업그레이드: 4.142의 undici·sharp·miniflare npm audit 권고 해결, `npm audit` 0건). 업그레이드 뒤 `wrangler whoami`·`wrangler pages project list`로 확인했다.
- 배포 뒤 `npm run test:live`(기본 `https://docs.sketchps.app`, `LIVE_ORIGIN`으로 바꿈)로 실제 URL에서 브라우저 회귀 시험을 돌린다. 진입·로딩·주소만 본다(18건). 편집·저장 흐름은 다루지 않는다 — 새 기능은 사람이 직접 확인한다.
- 프로젝트는 기존 Pages 방식이다. wrangler 4.142의 `pages project create`는 Workers로 넘기려다 실패해서 `--force`로 한 번 만들었다(2026-10-12). 이후 명령에는 `--force`를 쓰지 않는다. 첫 배포는 `Failed to publish your Function. Unknown internal error`로 실패했고, 같은 명령을 한 번 다시 실행해 성공했다.
- `docs.sketchps.app` DNS는 대시보드에서 관리한다(CNAME → `sketch-docs.pages.dev`, **DNS only**). wrangler OAuth 토큰에는 DNS 쓰기 권한이 없다.
  - 프록시를 켜면 KT 회선에서 무료 플랜 IP가 해외 colo로 가서 WASM 로딩이 수십 배 느려진다(2026-10-13 실측). 다시 켜지 않는다.
- 소스 제공: 배포판 정보 창이 빌드 커밋의 GitHub 링크를 건다. 그래서 push되지 않은 커밋은 배포하지 않는다.
- GitHub Actions: push마다 `verify`(Rust·브라우저 없이 `npm run check`·`npm run test:contracts`만 — 엔진 빌드·브라우저 회귀는 로컬 push 게이트가 맡는다), 매주 `dependency-watch`(`svelte-pdf-mini` 새 판·`npm audit --omit=dev`, gridcraft·craft-libs Cargo.lock `cargo audit` — 걸리면 이슈, 고정판은 바꾸지 않는다). 최신 원본 검사는 로컬 `npm run upstream:check`로만 한다(2026-10-15 결정). 배포 권한은 주지 않는다. `git push --no-verify`는 게이트를 건너뛴다 — 쓰지 않는다. 훅은 `npm run hooks:install`(= `git config core.hooksPath .githooks`, 이 클론에 2026-10-15 설치), 되돌리기 `git config --unset core.hooksPath`.
