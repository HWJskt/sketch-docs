# push 게이트·CI·주간 감시 — 단계 계획 (2026-10-15)

지시: 조율자 `req-2026-10-15-ci-push.md`(사용자 결정 5개). push·배포는 하지 않는다. 워크플로는 push해야 실제로 돌므로, 로컬에서 확인할 수 있는 것(훅 동작·스크립트 단위 시험·YAML 문법)까지 하고 "push 뒤 확인할 것"을 남긴다.

## 사실

- `deploy.mjs`는 이미 `artifacts/verified.json`(커밋·productHash·dist 해시 일치, 깨끗한 트리)을 요구한다.
- CI가 잡은 실제 사례는 로캘 1건(`4aec08c`: GitHub 영어 Chrome에서 Word가 en 맞춤법 사전 1.3MB를 받아 엔진 목록 시나리오 실패).
- 이제 `npm run verify`는 gridcraft를 Rust 1.99.0·trunk·wasm-bindgen·wasm-opt로 빌드한다 — GitHub 기본 러너에는 없다.

## 단계

| 단계 | 할 일 | 완료 조건 | 검증 |
|---|---|---|---|
| P1. push 게이트 | `.githooks/pre-push` + `scripts/push-gate.mjs`, `npm run hooks:install`(`core.hooksPath=.githooks`). 밀려는 각 커밋: `artifacts/verified.json`이 그 커밋·깨끗한 트리·productHash와 맞으면 통과. 아니면 그 커밋의 임시 worktree(`git worktree add --detach`)에서 `npm run verify` + en-US 로캘로 브라우저 회귀 한 번 → 통과 뒤 worktree 제거. 삭제 push는 검사 없음 | 판정 함수 단위 시험(일치·커밋 다름·더러운 트리·productHash 다름·삭제·여러 ref). 훅이 실패 시 push를 막는 것을 로컬 bare 리모트로 확인. `--no-verify`로 건너뛸 수 있음을 문서에 적음 | `node --test tests/push-gate.test.mjs`, 로컬 bare 리포로 `git push` 시험 |
| P2. 로캘 | 브라우저 러너 4개가 `TEST_LOCALE`(예: en-US)을 Chrome `--lang`과 기본 context locale로 쓴다. 로캘을 고정한 시나리오는 그대로 | `TEST_LOCALE=en-US`로 브라우저 회귀 통과 | `TEST_DIST=dist TEST_LOCALE=en-US node tests/regressions.mjs` 등 |
| P3. GitHub `verify` 가볍게 | Rust·브라우저 없이: `npm ci` → `npm run check` → `npm run test:contracts` | 원본 클론(`source/`) 없이 통과하는지 로컬 깨끗한 worktree에서 확인 | worktree에서 같은 명령 |
| P4. `upstream-watch` → `dependency-watch` | 사용자 결정 C(2026-10-15): `latest`와 그 보고 job을 지운다. 최신 원본 검사는 로컬 `upstream:check`로만. `npm`: 매주 그대로. 워크플로 이름을 `dependency-watch`로 | YAML 문법 검사 | YAML 파서 |
| P5. `cargo audit` | 매주: gridcraft·craft-libs 고정 커밋의 Cargo.lock만 받아 RustSec DB와 대조. 빌드·upstream 코드 실행 없음. cargo-audit 미리 만든 바이너리(판·sha256 고정). 걸리면 이슈. 쓰기 권한은 보고 job에만 | 로컬에서 같은 판 바이너리로 현재 Cargo.lock 대조 결과 기록 | 로컬 실행, YAML 문법 검사 |
| P6. 문서 | README·CLAUDE.md "배포"에 게이트·`--no-verify`·CI 범위, "push 뒤 확인할 것" 목록 | — | — |

## 결과 (2026-10-15)

| 단계 | 커밋 | 확인 |
|---|---|---|
| 24 MiB 경고 | `0f1bc28` | 파일이 24 MiB를 넘으면 verify가 이름과 남은 여유를 경고(실패 아님). 지금 Excel WASM 23.11 MiB → 경고 없음 |
| P1·P2 | `048a813`, 로캘 수정 `4dffa77` | `tests/push-gate.test.mjs` 5/5(로컬 bare 리모트에서 실제 `git push`: 보고 일치 → 통과, 보고 없음 → 임시 worktree에서 verify + en-US 브라우저 시험, verify 실패 → push 거절·worktree 정리, 삭제 push → 검사 없음). 이 시험이 macOS `tmpdir()` 링크 때문에 verify가 아무것도 하지 않고 성공하던 결함을 먼저 잡았다. `TEST_LOCALE=en-US`로 브라우저 러너 4개 통과 — `navigator.language` 단언이 처음에 `--lang`만으로는 en-US가 안 되는 것을 잡아 context `locale`로 고쳤다 |
| P3 | `8dda24c` | 원본 클론·`.cache`·생성 `public` 없는 깨끗한 worktree에서 `npm run check` 0 오류, `npm run test:contracts` 162/162 |
| P4 | `8dda24c` | 사용자 결정 C: `latest`·보고 job 삭제, 워크플로 `dependency-watch`로 이름 변경. YAML 해석·`run:` 단계 shellcheck 통과 |
| P5 | `8dda24c` | cargo-audit 0.22.2(linux-musl sha256 `7fb9497f…c428`, GitHub 기록과 내려받은 파일 일치). 받는 단계를 로컬에서 그대로 실행 → Cargo.lock 2개가 고정 커밋 파일과 같음. 같은 판(macOS) 대조 결과 취약점 0·경고 0 |
| 전체 | — | `npm run verify` 통과(단위 162, 브라우저 PASS 52·FAIL 0) |

훅 설치(2026-10-15, 조율자 허락): 이 클론의 `.git/config`에 `core.hooksPath = .githooks`(`git config --show-origin --get core.hooksPath` → `file:.git/config .githooks`). 되돌리기: `git config --unset core.hooksPath`. 같은 리포의 다른 세션(Codex 포함) push에도 걸린다.

### push 뒤 확인할 것

1. GitHub Actions `verify`가 새 구성(`npm ci` → `npm run check` → `npm run test:contracts`)으로 성공하는지: `gh run list --workflow verify --limit 3`. 특히 `tests/push-gate.test.mjs`가 러너의 git·`/tmp`에서 통과하는지.
2. 첫 push가 게이트를 거쳤는지: push 출력의 `push gate:` 줄(보고 일치로 통과했는지, 임시 worktree에서 다시 검사했는지).
3. `dependency-watch`를 손으로 한 번 돌린다: `gh workflow run dependency-watch` → `cargo-audit` job에서 Cargo.lock 받기·sha256 확인·`cargo audit` 2회가 성공하는지, `npm` job이 그대로인지, 이슈가 잘못 열리지 않는지.
4. 옛 `upstream-watch` 워크플로가 Actions 목록에서 사라지고 예약 실행이 더는 생기지 않는지.
5. 보존 fork(`HWJskt/gridcraft`·`craft-libs`)는 아직 없다 — `cargo-audit`의 mirror 대체 경로는 원본이 사라졌을 때만 쓰인다. 배포 직전 결정 A대로 만든다.

### 게이트 느린 경로 실측 (2026-10-15, 로컬 bare 리포로 push — GitHub에는 아무것도 가지 않음)

- 첫 실행: 좋은 커밋을 거절했다. worktree가 `node_modules`를 이 클론으로 링크해 Vite가 모듈 경로를 이 클론 기준으로 풀었고, PDF 엔진 목록 검사(`scripts/pdf-manifest.mjs`)가 "PdfEditor가 pdf.js를 import하지 않음"으로 실패했다. 대역 시험으로는 잡히지 않던 것이다. `2ccdc1c`에서 worktree가 `npm ci --prefer-offline`을 하게 고쳤다.
- 다시 실행(`a791d70`): 431초. worktree에서 `npm run verify` → RELEASE GATE PASSED, 이어서 en-US 브라우저 러너 4개 통과 → `push gate: a791d7028024 passed`, bare 리포에 커밋 도달. 끝난 뒤 worktree 1개(주 클론), 임시 폴더 0, 남은 Chrome·cargo 0.

### 리뷰 판정 (2026-10-15, 별도 컨텍스트 Claude 리뷰어, 범위 `0f1bc28..d4c69e3`)

| # | 발견 | 판정 | 처리 |
|---|---|---|---|
| M1 | 게이트는 각 ref의 끝 커밋만 검사 — 중간 커밋은 검증 없이 push(리뷰어가 임시 리포에서 재현) | 받음(문서) | 중간 커밋마다 전체 verify는 비용이 커서 동작 유지. 배포는 끝 커밋으로 만든다. README·주석을 "각 ref의 끝 커밋"으로 — `90c27ab` |
| M2 | 일반 절차(verify 뒤 push)에서는 en-US 회차가 돌지 않음 | 받음(문서) | 사용자 지시 문구("맞으면 바로 통과, 아니면 … + en-US")대로 동작. 거짓이던 `verify.yml` 주석과 문서를 고침 — `90c27ab`. 검사 범위 축소는 남은 결정으로 보고 |
| M3 | 느린 경로가 주 클론 `.cache/build`를 공유 → 경합 시 다른 내용을 검증할 수 있음 | 받음 | worktree가 자기 build 작업 폴더를 쓰고 Cargo 출력만 공유 — `ab9648d`, 시험이 `.cache`가 링크가 아님을 확인 |
| L1 | Ctrl-C 중단 시 worktree가 남음(재현) | 받음 | 비동기 실행 + SIGINT/SIGTERM/SIGHUP 정리, 시작 시 옛 게이트 worktree 정리 — `ab9648d`. 실제 SIGINT 시험 추가, 변이(신호 처리 제거)로 그 시험이 실패함을 확인 |
| L2 | 주석 태그는 항상 느린 경로 | 받음 | 커밋으로 풀어(peel) 판정 — `ab9648d`, 시험 추가 |
| L3 | craft-libs 자체 lock의 비컴파일 crate 28개가 오탐을 낼 수 있음, 경고 등급은 이슈 없음 | 부분 | 대상은 사용자 결정대로 두 lock 유지, 문서·워크플로 주석에 적음 — `90c27ab` |
| L4 | xlsx 러너는 en-US로 돌지 않음 | 받음 | `TEST_LOCALE` 사용·단언 — `ab9648d` |
| L5 | 상대 `core.hooksPath` — 048a813 이전 커밋을 체크아웃하면 훅 없음 | 받음(문서) | README에 적음 — `90c27ab` |
| L6 | productHash가 루트 `LICENSE`를 덮지 않음 | 반박(범위 밖) | 이번 diff 이전부터 있던 것, 게이트 우회 아님(빠른 경로는 커밋 sha 일치와 깨끗한 트리 요구). 기록만 |
