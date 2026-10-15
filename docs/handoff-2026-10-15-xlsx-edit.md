# Sketch Docs 인계 — Excel 편집 (2026-10-15 저녁)

작성: 작업 에이전트 `xlsx`(조율자 `~/Coding/SUPERVISOR/svr-edentext-word-hwp`). 앞선 인계 `docs/handoff-2026-10-15.md`(배포까지)의 다음 기록이다.
이 세션이 길어져서 쓴다. 다음 세션은 이 문서와 계획 [`docs/plans/2026-10-15-xlsx-edit.md`](plans/2026-10-15-xlsx-edit.md)(§3 설계, §4·4.1 진행, §4.2 고칠 것, §5 결정, §8 리뷰 판정)에서 시작한다.

## 지금 상태

| 항목 | 값 |
|---|---|
| 배포판 | **`4230e0d`(Excel 편집)** — 2026-10-16 배포, `https://docs.sketchps.app`(배포 미리보기 `https://3094b805.sketch-docs.pages.dev`). 실사이트 `legal/release.json` = `4230e0d…`·`dirty=false` |
| 로컬 `main` | `4230e0d`까지 push(`509736e..4230e0d`, 27커밋), 그 뒤 이 배포 기록 커밋 |
| 마지막 `npm run verify` | 통과 — `4230e0d`(단위 192, 브라우저 PASS 105·FAIL 0, 두 언어 `XLSX VIEW CHECKS PASSED`, `RELEASE GATE PASSED`) |
| Excel 엔진 WASM | 24,277,249 B(23.15 MiB). 24 MiB 경고선까지 약 0.85 MiB |
| 엔진 overlay | `overlays/gridcraft/sketch-bridge.patch`(옛 `view-only.patch`). 고칠 때는 패치를 적용한 사본에서 고쳐 `git diff`로 다시 만든다 — 아래 "작업 방법" |

## 이번 세션에 한 일 (커밋)

| 일 | 커밋 |
|---|---|
| verify에 en-US 회차(리뷰 M2), push·fork(`HWJskt/gridcraft`·`craft-libs`)·배포 `d9f41e7` | `d9f41e7`, `509736e` |
| 실사이트 시험 실패 증거 저장(`artifacts/live-failure/`), `xlsx.integration`에도 | `99bfac3`, `b0cadde` |
| Word 맞춤법 사전 오프라인 시험 | `362cf6d` |
| WordCraft 교체 계획 **초안(중단, 리뷰 전)** + 조사 부록 3개 | `d81123b` — 이어서 할 일은 그 문서 끝 |
| Excel 편집 계획·리뷰(20건 모두 받음)·결정 반영 | `974b225` `073fde3` `c3daa77` |
| 0a 스냅샷 · 0b 왕복 손실 실측(비교기 `src/xlsx/compare.ts`, fixture 13, 실제 파일 3개 — 종류·개수만 기록) | `00d2fd9` `07185c1` `c3daa77` `f612bb1` |
| 1a 편집 모드·브리지 2·처리표(Rust 시험 2 + 변이 2) | `2458ec6` |
| 1b 다른 이름으로 저장·CSV/PDF·B1·되돌리기(변이 2) | `6ad477b` |
| 3 복구 사본·같은 파일 탭 알림(단위 변이 4·브라우저 변이 2) | `2a24e54`, `f69ae70` |
| 2a·2b 원본 저장 — 손실 경고(실측 이름)·OPFS 원본 보관·되돌리기·엔진 경고 한국어(변이 3) | `f40e78e` |
| 4 자동 저장 토글 숨김·"보기 전용" 문구·README·i18n 감사(영어 0) | `2fffcb7` |
| B2 글꼴 목록·Pretendard 등록(변이 1), 깨진 upstream 시험 2개 | `0a3d2a2`, `6407f68` |
| F1 원인 조사(upstream 엔진) → 빠른 입력 유실 고침(그리드 우회, 변이 1) | `99ace40`, `426274d` |
| 배포 전 리뷰(별도 컨텍스트 Claude 1개, 8건: 받음 6·사실 확인 1·반박 1) → 고침 | `255407c`, 판정표 계획 §9 |

## push·배포 결과 (2026-10-16, 사용자 지시 "리뷰 후 바로 배포")

| 단계 | 결과 |
|---|---|
| push 전 스캔(`origin/main..4230e0d`, 27커밋·59파일) | 추가 줄의 로컬 절대경로 0건. 비밀값 패턴에 걸린 줄은 문서의 "password" 설명, 합성 fixture 보호 암호 `"1234"`, 시험용 가짜 `secret-token`뿐. 실제 샘플 파일 3개 이름은 diff·fixture xlsx 13개 내부 모두 0건, fixture에 작성자·경로 메타데이터 없음. `backups/`·`source/` 0건. 조율자 독립 스캔도 0건 |
| `npm run verify`(`4230e0d`) | exit 0. 단위 192/192, 브라우저 PASS 105·FAIL 0, 두 언어 `XLSX VIEW CHECKS PASSED`, `RELEASE GATE PASSED`. 로그의 `error:`·`fatal:` 줄은 upstream git 시험이 일부러 만드는 실패 출력(해당 시험 모두 ✔) |
| `git push origin main` | 게이트 `Push gate: 4230e0d54fc5 → refs/heads/main: verified (artifacts/verified.json)`, `509736e..4230e0d` |
| GitHub `verify` | 실행 38768034901, `4230e0d` success(29초) |
| `npm run mirrors:check` | `Backup forks hold every pinned commit.` 다섯 upstream 고정(edentext `4c4c94c`·hop `80888af`·rhwp `1a76570` v0.8.7·gridcraft `d9d09f0`·craft-libs `d27646a`). `d9f41e7` 이후 `upstreams.lock.json` 변화 없음 → `mirrors:pin` 안 함 |
| `npm run deploy` | 22파일 새로 올림(520개는 이미 있음), `https://3094b805.sketch-docs.pages.dev` |
| `npm run test:live` | 1회에 통과 — PASS 18·FAIL 0(`https://docs.sketchps.app`). 재실행 없음 |

## 배포 뒤 사람이 확인할 것 (사용자용 절차)

자동 시험이 대신할 수 없는 네 가지다. **데스크톱 Chrome**에서 `https://docs.sketchps.app`을 열고 시작 화면의 Excel로 들어간다. 연습 파일은 중요하지 않은 xlsx의 **사본**을 쓴다(아래 2는 그 파일을 덮어쓴다). 문제가 보이면 몇 번째 단계에서 무엇이 보였는지만 알려 주면 된다.

1. **한글 입력 뒤 Enter**(헤드리스 시험에서 확정되지 않았던 F2 — 계획 §4.2)
   1. "Excel 열기"로 사본을 연다. 빈 칸(예: H2)을 한 번 누른다.
   2. macOS 한국어(두벌식) 입력기로 `감`을 치고 **Enter를 한 번** 누른다.
   3. 확인: (a) H2에 `감`이 보인다 (b) 선택이 H3으로 내려갔다 (c) H2를 다시 고르면 위쪽 수식 입력줄에 `감` (d) 왼쪽 아래 상태가 "입력"으로 남아 있지 않다.
   4. `가나다`로 한 번, 마지막 글자에 밑줄(조합 중)이 있을 때 바로 Enter로 한 번 더 해 본다.
   5. 한 번이라도 Enter 뒤에 편집 상자가 남거나 아래 칸으로 안 내려가면 실제 문제다.
2. **원본에 저장 — 실제 권한 창·경고 창**
   1. 사본을 열고 아무 칸이나 고친다(위쪽에 "저장하지 않은 변경"이 보인다).
   2. "저장"(또는 Ctrl+S)을 누른다. Chrome이 **파일 수정 권한**을 묻는다 → 허용.
   3. "원본 파일에 저장" 경고 창이 뜬다: 이 파일에서 잃을 수 있는 요소 목록이 있는지 본다. 먼저 "취소" → 파일이 그대로인지(아직 "저장하지 않은 변경"), 다시 저장 → "그래도 저장".
   4. 확인: "저장하지 않은 변경"이 사라진다. Excel(또는 Numbers)로 그 파일을 열면 고친 값이 있다.
   5. "보관한 원본"을 누르면 덮어쓰기 전 원본이 목록에 있다. 하나를 고르고 새 이름으로 저장하면 원래 내용의 파일이 생긴다.
   6. 같은 파일에 다시 저장하면 경고 창 없이 저장된다(처음 덮어쓸 때만 묻는다).
   7. "다른 이름으로 저장"으로 새 파일을 만들어 Excel에서 열리는지도 한 번 본다.
3. **복구 제안**
   1. 사본을 열고 칸 하나를 고친 뒤 **저장하지 않고** 30초 넘게 기다리거나 다른 탭으로 옮겼다 돌아온다(이때 복구 사본이 만들어진다).
   2. 탭을 닫는다(떠날지 묻는 창이 뜨면 떠나기).
   3. 새 탭에서 다시 Excel로 같은 파일을 연다.
   4. 확인: "이 파일에서 저장하지 않은 편집 내용의 복구 사본이 있습니다(시각)…"와 "복구"·"버리기"가 보인다. "복구" → 고친 값이 돌아오고 "저장하지 않은 변경" 상태다(원본 파일은 바뀌지 않았다).
   5. 한 번 더 같은 과정으로 제안을 띄우고 "버리기" → 지울지 묻는다 → 확인하면 제안이 사라지고, 다시 열어도 제안이 없다.
   6. 같은 파일을 두 탭에서 열면 "이 파일이 다른 탭에서도 열려 있습니다."가 보인다.
4. **글꼴 드롭다운**
   1. 아무 칸이나 고르고 위쪽 리본의 글꼴 상자를 연다.
   2. 확인: 순서가 Pretendard → 맑은 고딕·굴림·돋움·바탕 → 영어 글꼴이고, Pretendard에는 "웹 글꼴 · 다른 PC에 없을 수 있음", 이 Mac에 없는 글꼴에는 "이 브라우저에 없음 — 대체 글꼴로 표시"가 붙는다. 글자가 잘리거나 겹치지 않는다.
   3. 칸에 영문을 쓰고 Pretendard와 Arial을 번갈아 고르면 화면 글자 모양이 달라진다. 셀 서식 창의 글꼴 목록도 같은 순서다.

## 다음 할 일 (순서 — 사용자 결정 1b → 3 → 2)

1. ~~**단계 3: OPFS 복구 사본·탭 알림**(계획 §3.6).~~ **끝**(계획 §4.1 "3" 행, 남은 것은 그 아래 "3에서 남은 것"). 아래는 원래 계획이다.
   - 편집 중 사본: dirty이고 30초 무입력이면 OPFS `sketch-docs-xlsx-drafts`에 저장한다. 키 = 이름 + 원본 해시 + 탭 id, 메타데이터는 엔진 판·docUid·`rev`·시각. 큰 문서는 스냅샷 시간을 잰다.
   - 다시 열 때 복구 제안: Web Lock `sketch-docs-xlsx-draft@<키>`를 잡은 탭만 제안·삭제한다.
   - 같은 파일 두 탭: BroadcastChannel로 알리기만 한다(Q8).
   - 저장 성공·버리기 때 사본을 지운다.
   - 시험: 탭을 닫았다 열면 복구 제안, 다른 탭이 편집 중이면 제안 안 함. 위험 부류라 변이를 한다.
2. ~~**단계 2a·2b: 원본에 저장**.~~ **끝**(계획 §4.1 "2a·2b" 행, 남은 것은 "2에서 남은 것" — 행·열 삽입 감지는 엔진 재빌드가 필요). 아래는 원래 계획이다.
   - Q2 ②: 손실이 있어도 허용한다. 저장 전에 잃는 요소를 구체적으로 경고하고, 문구는 `docs/xlsx-roundtrip-losses.md` 끝 목록을 쓴다.
   - 덮어쓰기 전 OPFS 원본 백업, 되돌리기 화면.
   - 지금 `XlsxViewer`의 원본 선택 되돌리기 분기를 "경고 → 확인 → 덮어쓰기"로 바꾼다. 원본 저장(Ctrl+S on 연 파일)도 연다.
3. ~~**단계 4**~~ **끝**(계획 §4.1 "4" 행): 자동 저장 토글 숨김(엔진 패치), "보기 전용" 남은 문구, README·`xlsx-i18n-audit`.
4. **고칠 것 F1·F2**(계획 §4.2):
   - F1(**빠른 입력 유실 고침** — 그리드 우회만. **Enter 직후 같은 프레임 단축키 무시는 남은 일**, 실패한 방식 목록과 함께 계획 §4.2): 셀 편집기를 여닫는 프레임의 키 유실("999" → 9, Enter와 같은 프레임의 Ctrl+S). 먼저 upstream 웹판에서 재현되는지 가린다(허락 뒤 별도 빌드).
   - F2: 한글 Enter 확정은 사용자 수동 확인 절차가 문서에 있다.
5. ~~**B2 글꼴 드롭다운**~~ **끝**(계획 §4.1 "B2" 행): 결정 F1~F5 모두 추천대로(조율자 `decision-xlsx-fonts.md`). A(편집) 뒤에 한다.
6. 엔진 메뉴 "파일 → 열기 → 찾아보기" **클릭 경로** 브라우저 시험이 아직 없다. 같은 요청 경로는 Ctrl+O로 시험했다. 좌표를 찾는 실행이 필요하다.

## 지킬 결정·규칙

- **push·배포는 사용자 지시 때만.** 무거운 실행(verify·trunk·cargo·브라우저 전체)은 조율자 허락 뒤에 한다. 커밋하면 `[조율자] 커밋 끝: <해시>`를 알린다.
- 실제 사용자 파일(`~/Coding/SUPERVISOR/svr-edentext-word-hwp/real-xlsx/`, 저장소 밖)은 **이름·셀 내용·시트 이름을 커밋·로그·스크린샷에 남기지 않는다.** 측정은 scratchpad 사본(`real-N.xlsx`)으로 하고 종류·개수만 적는다. 측정기는 이 출처 밖 요청을 막는다.
- 결정 정본: 조율자 `decision-xlsx-edit.md`(Q1~Q14 + 사용자 확인), `decision-xlsx-fonts.md`.
- 저장 계약: 검사·내보내기는 선택기 전, 쓰기는 잠금 안 해시 확인, `saved`는 쓰기가 닫힌 뒤, 실패·취소는 `discard`. 원본 덮어쓰기 전 OPFS 사본(다시 읽어 해시 확인).

## 작업 방법 — 엔진 overlay 고치기

1. scratchpad에 `git clone source/gridcraft gc` → `d9d09f0` checkout.
2. `brand`·`korean-font`·`korean-ui` 패치를 적용해 각각 커밋한다.
3. `sketch-bridge.patch`를 적용한다.
4. 고친 뒤 `git add -A && git diff --cached <korean-ui 커밋> > overlays/gridcraft/sketch-bridge.patch`.
   - Rust 시험을 사본에서 돌릴 때는 생성 파일 `crates/ui-egui/src/i18n/ko_sketch.rs`를 `.cache/build/gridcraft/…`에서 복사해 넣는다. **패치를 만들기 전에 지운다**(생성 파일이 패치에 들어가면 안 된다 — 패치에 `ko_sketch.rs`가 0건인지 확인).
   - overlay를 바꾸면 `sketch_`만이 아니라 **ui-egui 전체** `cargo test --no-fail-fast -p gridcraft-ui-egui`를 돌린다(조율자 지시 — B2 때 `sketch_`만 돌려 upstream 시험 2개가 깨진 것을 놓쳤다).
   - kittest 통과는 웹 동작의 증거가 아니다(프레임 강제·포커스 차이, F1에서 확인). 입력·포커스 부류는 브라우저 시험으로 판정한다.
5. Rust 시험: 그 사본에서 `RUSTUP_TOOLCHAIN=1.99.0 CARGO_TARGET_DIR=<scratch>/gc-target cargo test --offline --locked -p gridcraft-engine --lib sketch_`
6. 빌드: `npm run prepare:engines` → `npm run build` → `TEST_DIST=dist node tests/xlsx.integration.mjs`

시험 작성 요령(이번에 밟은 것):
- 엔진 입력은 `keyboard.type(text, { delay: 50 })`
- 단축키 전에는 엔진 상태가 `editing:false`가 될 때까지 기다린다
- 셀 값은 스냅샷 바이트로 읽는다(`cellsOf`)
- "미저장 유지" 단언은 상태 메시지가 도착할 시간을 둔다(`stillUnsaved`)
- fixture를 다시 만들면 ZIP 시각이 달라진다 → 쓰인 바이트를 읽어 비교한다

## 다음 세션 시작 지시문

"`docs/handoff-2026-10-15-xlsx-edit.md`의 '지금 바로 할 일 — push·배포'부터 하라(조율자 확인 뒤, verify를 HEAD에서 다시). 리뷰 판정은 계획 §9, 남은 일은 §4.2·각 단계의 '남은 것'. 실제 사용자 파일 정보는 기록하지 않는다."
