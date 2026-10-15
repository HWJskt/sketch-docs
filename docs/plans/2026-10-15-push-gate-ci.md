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
