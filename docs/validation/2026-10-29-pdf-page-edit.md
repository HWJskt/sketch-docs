# PDF 페이지 편집 검증 기록

## 0. 라이브러리 probe

Node 24.21.0, svelte-pdf-mini 0.9.1, @cantoo/pdf-lib 2.11.1.

- `node --import ./tests/ts-resolve.mjs --test tests/pdf-page-probe.test.mjs`: passed 1, failed 0, skipped 0.
- copyPages는 표준 Text와 Popup을 유지하고 모델 JSON 첨부는 가져오지 않음. private JSON에서 읽은 주석도 실제 포함된 페이지 번호로 바뀜(초기 예상 2와 달리 1). private 표시 제거 뒤 foreign으로 읽힘.
- `gtimeout 60 node tests/pdf-page-probe-browser.mjs`: passed 1, failed 0, skipped 0. Chrome에서 controlled 목록 → 공개 store.add → undo 후 controlled 항목 유지. Document.Root src A→E 교체 후 3→1쪽, import 1→2회, 주석 및 라이브러리 undo 이력 초기화.
- 브라우저 probe 초기 실패 원인: Vite fallback 뒤 추가한 middleware라 시험 HTML 대신 앱 HTML 응답. 정적 probe HTML로 수정. 이후 의존성 최적화에서 pdf.js worker ?url 실패 → 제품과 같은 `exclude: ['pdfjs-dist']` 사용. svelte-pdf-mini까지 제외하면 CJS NodeType import 오류가 나므로 제외하지 않음. 제품 코드 변경 없음.

## 1. 페이지 모델

- `node --import ./tests/ts-resolve.mjs --test tests/pdf-pages.test.mjs`: passed 9, failed 0, skipped 0.
- `node --import ./tests/ts-resolve.mjs --test tests/pdf-page-history.test.mjs`: passed 2, failed 0, skipped 0.
- 실행 순서: 신규 모듈 없음으로 실패 관측 후 구현. 다중 이동/삭제/선택, 실제 손실 탐지, foreign+Popup 보존, 비영점 MediaBox+90도, 서명/암호 거절, 통합 이력과 저장 snapshot dirty 확인.

## 2. 통합 이력 UI 연결

- 변경 전/후 `gtimeout 300 node tests/pdf.integration.mjs`: 각각 passed 32, failed 0, skipped 0. 주석 6종·undo/redo·전환·저장·복구 기존 시나리오 유지.
- 이력 단위 3 passed / 0 failed / 0 skipped. 연속 주석 입력을 한 이력 단계로 묶는 시험 RED(2 pass/1 fail) → GREEN.
- `npm run build`: exit 0. `npm run check`: 오류 0·경고 0. Svelte autofixer issues 0; 기존 onState effect 및 bind:this 제안만 있음.

## 3. 썸네일 페이지 조작

- 신규 UI 시험은 변경 전 '선택한 페이지 앞으로' 버튼 없음으로 실패. 구현 후 이동·삭제·삽입·undo 시험 통과.
- `node tests/pdf.integration.mjs`: 34 passed, 0 failed, 0 skipped. 별도 `PDF_TEST_FILTER='page editing: inserted' node tests/pdf.integration.mjs`: 1 passed, 0 failed, 0 skipped.
- 실제 마우스 dragTo, Shift/Ctrl·Cmd 선택, 마지막 페이지 삭제 거절, 서명·암호 삽입 거절, 기존 주석의 삽입/삭제/undo 뒤 페이지 위치 확인.
- 첫 전체 실행은 fallback 파일 입력이 2개가 되어 기존 시험 locator가 모호해짐. 원본 열기·삽입 입력에 각각 접근성 이름을 주고 기존 시험이 원본 열기 입력을 지목하도록 수정. 동작 단언 유지.
- 재구성 기준과 주석 출력의 기존 보존 검사 시험 추가: 페이지 단위 10 passed / 0 failed / 0 skipped.
- PagePanel Svelte autofixer: issues 0, suggestions 0. 타입 검사 오류·경고 0.

## 4a. 저장 조정자

- `node --import ./tests/ts-resolve.mjs --test tests/pdf-save.test.mjs`: 14 passed / 0 failed / 0 skipped. 새 overwrite 금지 및 손실 확인 취소 시험 각각 RED → GREEN.
- 손실 확인은 내보내기·검증 뒤, 대상 선택 전에 실행. 거절하면 대상 선택·쓰기 모두 0회.
- 당시 파일 대상 UI 결정 대기. 후속 사용자 승인으로 아래 4b의 폴더+새 이름 경로를 구현했다.

## 독립 리뷰와 경계값 수정

별도 컨텍스트의 읽기 전용 리뷰에서 2건(P1 문서 epoch 경합, P2 분기형 첨부 이름 트리)을 받음.

- 문서 경합: A에서 시작한 삽입의 파일 읽기를 붙잡은 동안 이미 대기 중이던 B 열기를 완료하고, B 주석 import까지 기다린 뒤 삽입을 해제. 수정 전 B에 이전 작업의 오류가 표시됨(문제 표시 1, 기대 0). 이 실행에서는 조립 중 원본 소스가 없어 거절되었으므로 실제 잘못된 바이트 저장까지는 관측하지 않음. 모든 준비/조립/반영 단계에 epoch·open request·history identity 검사를 추가. 같은 브라우저 시험 GREEN, B는 1쪽·dirty 없음·오류 없음.
- 첨부 이름 트리: `/AF`가 없는 `/EmbeddedFiles/Kids` 합성 입력에서 손실 경고가 빠지는 것을 단위 시험으로 재현. Kids/Names 재귀 순회 및 읽을 수 없는 트리 거절로 수정.
- 직접 `/A << /S /GoTo >>`와 이름 트리 외 `/AF`도 재현 시험 RED → GREEN. 페이지 단위 12 passed / 0 failed / 0 skipped.
- 삽입 진행 중 복원 버튼이 활성인 경합: disabled 단언 RED → paging 동안 복원 동작 차단 → GREEN.
- 1280×900 UI 캡처 `artifacts/pdf-page-edit/desktop.png`: 선택 표시·삽입 메뉴·이동/삭제 버튼 확인. OS 선택기·실제 손 조작 시험은 아님.

## 4b. 폴더 + 새 파일 이름 저장

- 사용자 승인(2026-10-29)을 계획 사용자 결정에 기록. 페이지 편집에만 새 이름 폼과 `showDirectoryPicker({mode:'readwrite'})`를 사용. 주석 전용 저장 선택기 경로 유지.
- 신규 저장 단위 시험 RED: 16 passed / 3 failed / 0 skipped. 구현 후 저장 단위 22 passed / 0 failed / 0 skipped; PDF 전체 단위 `node --import ./tests/ts-resolve.mjs --test tests/pdf-*.test.mjs`: 113 passed / 0 failed / 0 skipped.
- `PDF_TEST_FILTER='page saving:' gtimeout 150 node tests/pdf.integration.mjs`: 5 passed / 0 failed / 0 skipped. 첫 UI RED는 이전 빌드에 새 파일 이름 입력이 없어 timeout. 구현 빌드 후 기존 이름(내용 있음/빈 파일) 해시 불변·writable 0·write 0, 생성과 쓰기 사이 외부 내용 변경 시 write 0 및 내용 보존, 권한 거절·폴더 취소·폼 취소 후 dirty·undo·redo 유지 확인.
- 부재 검사~생성 사이 같은 이름의 내용 있는 파일, 생성 후 entry 교체, writable 열기 도중 변경, write 후 close 전 변경은 단위 시험에서 거절/abort 및 외부 내용 보존 확인. 이름 검사~쓰기 전체를 공통 Web Lock 안에서 실행.
- 추가 읽기 전용 리뷰 P2: 대기 중인 다른 문서 열기가 완료되어도 이전 문서의 새 이름 폼이 남음. 브라우저 RED(폼 count 1, 기대 0), 저장 lock 대기 중 교체 단위 RED(20 pass/1 fail). load 시 폼 취소, 선택 완료 후 epoch 및 lock 안/생성 직전/쓰기 전후 현재 문서 검사를 추가해 GREEN.
- `npm run check`: 오류 0, 경고 0. Svelte autofixer issues 0, 기존 effect/bind:this 권고만 있음. `npx vite build`: exit 0.
- `gtimeout 60 node artifacts/pdf-page-edit/visual.mjs`: exit 0. `desktop.png`, `new-file.png`에서 1280×900 선택/삽입 UI 및 새 이름 폼을 시각 확인.
- OS 수준의 원자적 create-exclusive·no-clobber API는 제공되지 않는다([표준](https://fs.spec.whatwg.org/#api-filesystemdirectoryhandle-getfilehandle)). 외부 프로그램의 조회~생성 사이 동일 빈 파일 생성과 마지막 검사~close 사이 변경은 완전히 차단하지 못한다. 실패 후 생성된 빈 파일은 다른 프로세스 소유일 수 있어 자동 삭제하지 않는다. 실제 OS 선택기·외부 프로그램 동시 수정은 미시험.

- 추가 리뷰 P1: 위 epoch 취소를 기존 주석 전용 save picker에도 적용하면 이미 비워진 파일의 쓰기를 취소할 수 있음. 취소 게이트를 directory 대상에만 한정. 기존 Save As 경로는 선택기 이후 기존 트랜잭션을 유지. 단위 RED(21 pass/1 fail) → GREEN, Chrome에서 picker가 비운 파일의 길이 0을 확인한 뒤 다른 문서를 완료하고 picker 반환을 해제해 기존 대상의 쓰기 1회·유효 1쪽 PDF 복원 확인. 브라우저 계수기 초기 실패는 같은 entry의 다른 handle과 복구 사본 쓰기를 함께 세는 문제였으며, 대상 파일 이름으로 한정한 prototype 계수기로 수정(쓰기 1회 단언 유지).

## 전체 검증에서 발견한 번들 경계 문제

- 첫 `gtimeout 1800 npm run verify`: exit 1. 단위 218 passed / 0 failed / 0 skipped 후 `addPdfEngine`에서 중단. `pages.ts`와 그 보호 검사 의존성이 pdf-lib를 정적으로 끌어들여 라이브러리가 PdfEditor 청크에 합쳐지고, 기존 manifest의 직접 동적 pdf-lib import 조건을 위반했다. 전체 브라우저 단계는 이 실행에서 시작되지 않았다. 로그 `/private/tmp/pdf-page-verify.log`.
- `pages.ts`와 `protection.ts`의 PDF 처리를 기존 동적 pdf-lib 진입점을 통해 실행하도록 변경. manifest 생성기·시험 단언은 바꾸지 않았다. 수정 중 protection만 별도 동적 청크로 만들면 preload 목록에 빠질 수 있어 보호 함수 자체는 정적으로 연결하고 그 내부 pdf-lib만 지연 로드한다.
- 수정 후 `npm run check`: 오류 0·경고 0. PDF 단위 113/0/0, `npx vite build` exit 0, 실제 `addPdfEngine('dist')` exit 0, `node tests/bundle-boundary.mjs dist`: shell 청크 7개에 PDF 라이브러리 코드 없음. `PDF_TEST_FILTER='page editing:' gtimeout 150 node tests/pdf.integration.mjs`: 5/0/0.
- 실패 뒤 수정본의 전체 검증을 위해 재실행한다. 따라서 전체 verify는 최초 1회 계획에서 실패 1회 + 수정 후 최종 1회로 늘어난다. 시험 조건 완화 없음.


## 최종 전체 검증 결과

- `gtimeout 1800 npm run verify`: **exit 0**, `RELEASE GATE PASSED`. 로그 `/private/tmp/pdf-page-verify-final.log`. `artifacts/verified.json`은 `passed: true`, 코드 커밋 `24697d0cecc71cdfff4ec7f4c001fc236cea7e99`, dirty false, `testedAt: 2026-10-29T11:04:38.115Z`, 배포 출력 파일 543개를 기록.
- 전체 단위: 218 passed / 0 failed / 0 skipped. root 및 Word 타입 검사 오류 0·경고 0. 번들 경계: shell 청크 7개에 PDF 라이브러리 없음.
- 기본 Chrome 환경과 `TEST_LOCALE=en-US` **각각**: `tests/pdf.integration.mjs` 42 passed / 0 failed / 0 skipped, `tests/regressions.mjs` 20 passed / 0 failed / 0 skipped, `tests/integration.mjs` Word/한글 통합 runner 1 passed / 0 failed / 0 skipped, `tests/xlsx.integration.mjs` 통합 runner 1 passed / 0 failed / 0 skipped. runner 수와 내부 개별 assertion 수는 구별한다.
- 전체 실행은 최초 실패 1회와 수정 후 통과 1회. 첫 로그 및 실패 원인은 위에 보존. 재실행 중 제품·시험 파일을 변경하지 않았음.
- 종료 후 `pgrep -af '[n]ode.*(tests/(integration|regressions|pdf|xlsx)|artifacts/pdf-page-edit|scripts/verify)'`: 출력 없음(0개). `pgrep -af '[p]laywright_chromiumdev_profile'`: 출력 없음(0개).
- 로컬 커밋만 생성. push·배포하지 않음.


## 2026-10-30 OS 저장 창 전환

2026-10-29 폴더+새 이름 방식은 폐기했다. 현재 정책은 계획의 2026-10-30 절이며 앞의 검증은 당시 기록이다. Node 실행값 24.21.0. 설치 Chrome + playwright-core, runner가 finally에서 브라우저·preview를 닫는다.

- 계획 `b44b4ab`, 저장 조정자 `6d97611`, UI 전환 `e5b0b05`, 죽은 폴더 코드 제거 `8b32b3d`, 문서 교체 경합 수정 `ec89d60`, 이전 문서 쓰기 오류 안내 `2f29ad7`.
- `node --import ./tests/ts-resolve.mjs --test tests/pdf-save.test.mjs`: 신규 시험 RED 22 passed / 5 failed / 0 skipped. 저장+복구 시험 GREEN 33 / 0 / 0. 폴더 경로·폐기된 overwrite 금지·중복 단위 시험 제거 뒤 저장 시험 17 / 0 / 0. 문서 교체는 주석/페이지 모두 실제 Chrome pending open 시나리오에서 검증한다.
- `PDF_TEST_FILTER='page saving: suggested' gtimeout 90 node tests/pdf.integration.mjs`: UI 변경 전 RED(이전 inline form에서 저장이 진행되지 않아 timeout). 변경 뒤 `PDF_TEST_FILTER='page saving:' gtimeout 300 node tests/pdf.integration.mjs`: 8 / 0 / 0. `gtimeout 300 node tests/pdf.integration.mjs`: 45 / 0 / 0.
- 폴더 코드 제거 후 PDF 단위 110 / 0 / 0, 페이지 저장 Chrome 8 / 0 / 0. 이어 중복 단위 2개를 제거해 최종 PDF 단위 목록은 108개이며 최종 전체 실행 결과는 아래 보고서에 남긴다.
- 제안 이름 `report.pdf`, `report.PDF`, `report` → `report-편집.pdf`, 핸들 유무 각각 시험. `startIn`은 마지막 열기 핸들, 파일 입력 경로는 생략. 두 번째 저장 뒤에도 last-open 핸들을 전달한다. 별도 `id`는 없으며 Chrome 기본 기억을 쓴다([표준 §3.2.2](https://wicg.github.io/file-system-access/#api-filepickeroptions-startin)).
- 선택 순간 기존 파일을 비우는 fake picker로 원본 대치 2쪽 출력, 선택기 전에 OPFS 사본이 원본과 바이트 단위 동일, 원본 복원 뒤 정확한 바이트와 1쪽 재열기를 확인했다. 바이트 동일은 SHA-256 동일보다 강한 단언이며 OPFS의 실제 해시 검증은 기존 recovery 코드와 단위 시험을 함께 사용한다.
- 복구 저장 실패·사본 readback 손상은 picker 0회. 손실 확인 취소도 picker 0회. 저장 취소·write 실패·되쓰기 실패 후 dirty/undo/redo 유지. 단위에서는 createWritable/write/close 각 실패와 되쓰기 성공/실패를 교차 시험한다.
- 별도 읽기 전용 리뷰: P1(문서 교체 시 저장 실패 안내 유실), P2(지연 SecurityError 뒤 옛 prompt 생성). P2 재현 RED는 `activation: busy remained after document replacement; prompts=1`. `pageEpoch`를 선택기 실패 후 확인하여 미선택 작업을 취소한다. prompt가 이미 있던 경우는 load에서 취소한다. 선택 대상이 이미 반환됐다면 epoch와 무관하게 쓰기를 끝낸다.
- P2 수정 뒤 페이지 저장 Chrome 10 / 0 / 0. 추가 시나리오는 복구 대기·활성화 응답 대기·두 번째 클릭 대기 중 문서 교체, 그리고 저장 snapshot 뒤 undo → 저장 완료 때 dirty 유지 → redo 때 clean → undo 때 dirty이다.
- P1 재현 RED: 문서 교체 뒤 원본 되쓰기는 성공했으나 오류 안내 locator timeout. 수정 뒤 성공/첫 쓰기 실패/쓰기+되쓰기 실패의 세 분기 모두 통과(`PDF_TEST_FILTER='page saving: selected emptied' gtimeout 90 node tests/pdf.integration.mjs`: 1 / 0 / 0). 새 문서 base/history는 바꾸지 않고 이전 파일 이름과 결과를 표시한다.
- 각 변경의 `npm run check`: 오류 0·경고 0. `npx vite build`: exit 0 (기존 큰 청크 안내). `npx @sveltejs/mcp svelte-autofixer ./src/pdf/PdfEditor.svelte --svelte-version 5.57.1`: issues 0, 기존 onState/getState effect·bind:this 권고는 유지.
- 최종 전체 검증은 **이 문서를 포함한 마지막 커밋에서** `gtimeout 1800 npm run verify`를 한 번 실행한다. 실행 결과·exit code·verified.json commit은 `/private/tmp/claude-501/-Users-hwjung-Coding-edentext-word-hwp/e4292c5c-5234-4b0f-886e-6c56def4338e/scratchpad/pdf-save-picker-report.md`에 기록한다. 검증 뒤 문서 수정 커밋은 만들지 않는다.
- 미실행: 실제 OS 저장 창/대치 확인/폴더 기억의 수동 조작, 외부 PDF 앱 재열기, 대용량 성능, 실제 디스크 고장·외부 프로그램 동시 수정. 자동 시험은 synthetic OPFS 파일만 쓴다. 사용자 파일·backups·source 변경 없음, 새 의존성·패치·overlay·push·배포 없음.
