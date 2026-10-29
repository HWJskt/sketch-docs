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
- 파일 대상 UI 결정은 대기 중이며 4b에서 연결한다.
