# Excel 보기 화면 한국어화 — 단계 계획 (2026-10-15)

지시: 조율자(사용자 요청 2026-10-15) — Excel 화면의 영어를 한국어로, 용어는 Word 메뉴를 참고. 변경은 `overlays/gridcraft/`로만(`source/`는 읽기 전용).

## 확인한 사실

- Word: 저장된 선택이 없으면 브라우저 언어와 상관없이 한국어로 시작한다(`overlays/edentext/product.patch`의 `appLanguage()` → `'ko'`). Word 용어의 정본은 `overlays/edentext/ko.ts`(리본 탭·툴바·표·보기 등).
- gridcraft: `crates/ui-egui/src/i18n.rs`의 `Language::tr()`이 `i18n/ko.rs`(약 400항목)에서 찾고, 없으면 영어를 쓴다. 웹판 `web.rs`는 CJK 글꼴이 없다는 이유로 브라우저 언어가 ko·ja·zh면 영어로 둔다.
- 대체 글꼴 Pretendard Regular는 굵은 역할 글꼴 사슬에도 붙는다(`theme.rs` `font_definitions_with`). 굵은 자리의 한국어는 보통 굵기로 그려질 것으로 예상 — 화면으로 확인한다.
- 정적 스캔: `tr("…")` 직접 키 90개, `tr()`을 거치지 않는 위젯 직접 문자열 125개(대부분 `dialogs.rs`). 리본처럼 도우미 함수 안에서 `tr()`을 부르는 문자열은 정적 스캔에 잡히지 않는다.

## 단계

| 단계 | 할 일 | 완료 조건 | 검증 |
|---|---|---|---|
| K1. 언어·측정 도구 | 웹판을 항상 한국어로 시작(Word와 같게). 측정 빌드용 추가 패치(번역 없는 `tr()` 키를 콘솔에 한 번씩 기록)와 측정 실행기: 리본 탭 전부·파일 메뉴·셀/시트 탭 우클릭·상태줄·허용 대화상자(찾기·이동)·거절 경고 창을 열고 스크린샷 + 누락 키 목록 | 측정 빌드는 제품 출력과 분리. 기준선 수치(누락 키 수·화면별 영어 문자열) 기록 | 측정 실행기, `npm run test:contracts` |
| K2. 번역 채우기·용어 맞춤 | `korean-ui.patch`로 `ko.rs` 보충, 화면에 보이는데 `tr()`을 거치지 않는 문자열은 `tr()`로 감싼다. 같은 개념은 Word 한국어에 맞추고, Word에 없는 스프레드시트 용어는 한국어 Excel 관례. 거절 경고 문구도 한국어 | 측정 재실행에서 보기 화면의 남은 영어를 목록으로 설명(고유명사·글꼴명·의도적 유지만 남음) | 측정 실행기, `TEST_DIST=dist node tests/xlsx.integration.mjs` |
| K3. 굵은 글씨·회귀 | 굵은 셀·굵은 UI 자리의 한국어 확인, `npm run verify` | 빈 네모 0 | 스크린샷, `npm run verify` |

용어 대조표(영어·gridcraft 원래 번역·바꾼 번역·근거)는 `docs/xlsx-korean-terms.md`에 둔다. 사용자 판단이 필요한 용어 쟁점은 모아서 결정 파일로 올린다.

## 결과 (2026-10-15)

| 측정 | 기준선(한국어로 켠 직후) | 수정 뒤 |
|---|---|---|
| 번역이 없는 `tr()` 키 중 영어(측정 실행기 `node scripts/xlsx-i18n-audit.mjs`) | 98 | **0** (남은 32개는 이미 한국어인 문자열이 `tr()`을 한 번 더 거친 것 31개와 빈 문자열 1개) |
| `tr()`을 거치지 않는 위젯 직접 문자열 | 정적 스캔 125 | 171개를 `crate::i18n::t()`로 감쌈(`scripts/xlsx-wrap-tr.mjs`, 값 인자·식별자·URL·format! 제외), 배열 변수로 그리는 탭·선택지 8곳 수동 |
| 스크린샷(리본 탭 10개·파일 메뉴·셀 우클릭·찾기·이동·거절 경고 창) | AutoSave, Slicer, Pen…, Watch Window, 우클릭 메뉴, 찾기·이동 본문, OK/Cancel 등 영어 | 영어 없음. 남은 라틴 문자: 제품 이름 "GridCraft"(경고 창 제목·자동화 탭 "GridCraft 정보"), 글꼴 이름 "Calibri", 단축키 기호 |

- 번역표 254항목(`overlays/gridcraft/ko-sketch.json`): gridcraft 번역 변경 13(메모/노트), 새로 채움 241. 대조표 `docs/xlsx-korean-terms.md`.
- 용어 쟁점 6개는 사용자 결정 B로 한국어 Excel 관례 유지(병합·글꼴 색·기울임꼴·텍스트 상자·페이지·맞춤).
- 굵은 글씨: 굵은 셀의 한국어는 빈 네모 없이 표시되지만 보통 굵기로 그려진다(굵은 한국어 글꼴이 없다). Pretendard Bold를 넣으면 WASM이 약 2.66MB 늘어 약 24.2MB(한도 25MiB = 26.2MB 안, 여유 약 2MB).
- 거절 경고 창 문구: "보기 전용으로 연 통합 문서라 바꾸거나 저장할 수 없습니다."
- `npm run build` 뒤 `tests/xlsx.integration.mjs` 통과.

측정하지 못한 것: 마우스를 올려야 나오는 도구 설명(정적 감싸기로 직접 문자열은 덮었지만 화면 확인은 안 함), 보기 전용에서 거절되는 명령이 여는 대화상자, 차트·피벗 창.
