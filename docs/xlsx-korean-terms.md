# Excel 보기 한국어 용어 대조표 (2026-10-15)

정본: `overlays/gridcraft/ko-sketch.json`(빌드가 `ko_sketch.rs`로 만들어 gridcraft `ko.rs`보다 먼저 찾는다). 계획: `docs/plans/2026-10-15-xlsx-korean-ui.md`.

## 원칙과 사용자 결정

- 같은 개념은 Word 한국어(`overlays/edentext/ko.ts`) 용어, Word에 없는 스프레드시트 용어는 한국어 Excel 관례.
- **사용자 결정 B (2026-10-15)**: Word 용어와 한국어 Excel 관례가 갈리는 6개 개념은 Excel 관례를 유지한다 — 병합(Word 합치기), 글꼴 색·글꼴 크기(Word 글자색·글자 크기), 기울임꼴(Word 기울임), 텍스트 상자(Word 글상자), 페이지(Word 쪽), 맞춤(Word 정렬). gridcraft `ko.rs`의 해당 번역은 바꾸지 않았고, 새로 채운 번역도 이 6개는 Excel 관례로 썼다.
- Comment·Note는 Word(`newComment: '새 메모'`)와 한국어 Excel 365("스레드 메모 및 노트")가 같은 방향이라 gridcraft의 댓글→메모, 메모→노트로 바꿨다.
- UI 언어: 브라우저 언어와 상관없이 한국어로 시작한다(Word와 같다: `overlays/edentext/product.patch:934`, 적용 결과 `appLanguage.ts:10` `return isLocale(saved) ? saved : 'ko';`).

## gridcraft 번역을 바꾼 항목 (13)

| 영어 | gridcraft 원래 번역 | 바꾼 번역 | 근거 |
|---|---|---|---|
| Comment | 댓글 | 메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Comments | 댓글 | 메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| New⏎Comment | 새 댓글 | 새⏎메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Threaded Comments | 스레드 댓글 | 스레드 메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Show⏎Comments | 댓글⏎표시 | 메모⏎표시 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Previous Comment | 이전 댓글 | 이전 메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Next Comment | 다음 댓글 | 다음 메모 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Convert to Comments | 댓글로 변환 | 메모로 변환 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Clear Comments and Notes | 댓글 및 메모 지우기 | 메모 및 노트 지우기 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| New Note | 새 메모 | 새 노트 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Show/Hide Note | 메모 표시/숨기기 | 노트 표시/숨기기 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Show All Notes | 모든 메모 표시 | 모든 노트 표시 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Notes | 메모 | 노트 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |

## 새로 채운 항목 (241) — gridcraft 원래 번역 없음(영어로 표시되던 것)

| 영어 | 번역 | 근거 |
|---|---|---|
| New Comment | 새 메모 | Word `ko.ts` newComment |
| Delete Comment | 메모 삭제 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Comments pane | 메모 창 | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| No comments on this sheet yet. Select a cell and choose New Comment. | 이 시트에 아직 메모가 없습니다. 셀을 선택하고 새 메모를 고르세요. | Word(새 메모)·한국어 Excel 365(메모·노트) 공통 |
| Reply… | 회신… | 한국어 Excel 관례 |
| Resolve | 해결 | 한국어 Excel 관례 |
| Resolved | 해결됨 | 한국어 Excel 관례 |
|   OK   |   확인   | Word `ko.ts` common.ok |
| OK | 확인 | Word `ko.ts` common.ok |
| Cancel | 취소 | Word `ko.ts` common.cancel |
|  Close  | 닫기 | Word `ko.ts` common.close |
| Apply | 적용 | Word `ko.ts` common.apply |
| Add | 추가 | Word `ko.ts` common.add |
| Remove | 삭제 | Word `ko.ts` common.remove |
|   Solve   |   해 찾기   | 한국어 Excel 관례 |
| Change | 변경 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Change All | 모두 변경 | 한국어 Excel 관례 |
| Ignore Once | 한 번 무시 | 한국어 Excel 관례 |
| Add to Dictionary | 사전에 추가 | 한국어 Excel 관례 |
| (No suggestions) | (추천 단어 없음) | 한국어 Excel 관례 |
| Suggestions: | 추천 단어: | 한국어 Excel 관례 |
| Keep | 유지 | Word `ko.ts` ai.keepChanges |
| Hide | 숨기기 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Show | 표시 | Word `ko.ts` show |
| Rename | 이름 바꾸기 | Word `ko.ts` rename |
| Duplicate | 복제 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Edit… | 편집… | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| New… | 새로 만들기… | Word `ko.ts` newStyle |
| Open… | 열기… | Word `ko.ts` app.open |
| Reopen | 다시 열기 | Word `ko.ts` reopen |
| Send | 전송 | Word `ko.ts` ai.send |
| Search | 검색 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Search: | 검색: | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Preview | 미리 보기 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Name | 이름 | Word `ko.ts` name |
| Value | 값 | 한국어 Excel 관례 |
| Formula | 수식 | 한국어 Excel 관례 |
| Cell | 셀 | 한국어 Excel 관례 |
| Scope | 범위 | 한국어 Excel 관례 |
| Refers To | 참조 대상 | 한국어 Excel 관례 |
| Statistic | 통계 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Show password | 암호 표시 | Word `ko.ts` show |
| Don't Save | 저장 안 함 | 한국어 Excel 관례 |
| Can't Undo | 실행 취소할 수 없음 | Word `ko.ts` undo |
| Cut | 잘라내기 | Word `ko.ts` cut |
| Copy | 복사 | Word `ko.ts` copy |
| Paste (⌘V) | 붙여넣기 (⌘V) | Word `ko.ts` paste |
| Undo (⌘Z) | 실행 취소 (⌘Z) | Word `ko.ts` undo |
| Redo (⌘Y) | 다시 실행 (⌘Y) | Word `ko.ts` redo |
| Undo list | 실행 취소 목록 | Word `ko.ts` undo |
| Save (⌘S) | 저장 (⌘S) | Word `ko.ts` app.save |
| Insert… | 삽입… | Word `ko.ts` common.insert |
| Delete… | 삭제… | Word `ko.ts` delete |
| Define Name… | 이름 정의… | 한국어 Excel 관례 |
| Link… | 링크… | Word `ko.ts` insertLink |
| Insert Link (⌘K) | 링크 삽입 (⌘K) | Word `ko.ts` insertLink |
| Pick From Drop-down List… | 드롭다운 목록에서 선택… | 한국어 Excel 관례 |
| Filter by Selected Cell's Value | 선택한 셀 값으로 필터 | 한국어 Excel 관례 |
| Insert Sheet | 시트 삽입 | 한국어 Excel 관례 |
| Select All Sheets | 모든 시트 선택 | 한국어 Excel 관례 |
| Move or Copy… | 이동/복사… | 한국어 Excel 관례 |
| Unhide… | 숨기기 취소… | 한국어 Excel 관례 |
| Unprotect Sheet… | 시트 보호 해제… | 한국어 Excel 관례 |
| Previous sheet | 이전 시트 | 한국어 Excel 관례 |
| Next sheet | 다음 시트 | 한국어 Excel 관례 |
| New sheet (⇧F11) | 새 시트 (⇧F11) | 한국어 Excel 관례 |
| All sheets | 모든 시트 | 한국어 Excel 관례 |
| Expand formula bar | 수식 입력줄 확장 | 한국어 Excel 관례 |
| Find and Replace | 찾기 및 바꾸기 | Word `ko.ts` find/replace |
| Find what: | 찾을 내용: | Word `ko.ts` findPlaceholder |
| Replace with: | 바꿀 내용: | Word `ko.ts` replacePlaceholder |
| Find All | 모두 찾기 | 한국어 Excel 관례 |
| Find Next | 다음 찾기 | 한국어 Excel 관례 |
| Replace | 바꾸기 | Word `ko.ts` replace |
| Replace All | 모두 바꾸기 | Word `ko.ts` replaceAllTitle |
| Match case | 대/소문자 구분 | 한국어 Excel 관례 |
| Match entire cell contents | 전체 셀 내용 일치 | 한국어 Excel 관례 |
| Within workbook | 통합 문서에서 | 한국어 Excel 관례 |
| Go To | 이동 | 한국어 Excel 관례 |
| Reference: | 참조: | 한국어 Excel 관례 |
| Special… | 옵션… | 한국어 Excel 관례 |
| Find & Select | 찾기 및 선택 | 한국어 Excel 관례 |
| AutoSave | 자동 저장 | Word `ko.ts` autosave |
| AutoSave: save after every change (workbooks saved to a file) | 자동 저장: 바뀔 때마다 저장(파일로 저장한 통합 문서) | Word `ko.ts` autosave |
| Slicer | 슬라이서 | 한국어 Excel 관례 |
| Insert a slicer to filter a table | 표를 필터링할 슬라이서 삽입 | 한국어 Excel 관례 |
| Insert a picture | 그림 삽입 | Word `ko.ts` insertImage |
| Insert an icon | 아이콘 삽입 | 한국어 Excel 관례 |
| Recommended Charts | 추천 차트 | 한국어 Excel 관례 |
| Column or Bar | 세로 또는 가로 막대형 | 한국어 Excel 관례 |
| Line or Area | 꺾은선형 또는 영역형 | 한국어 Excel 관례 |
| Pie or Doughnut | 원형 또는 도넛형 | 한국어 Excel 관례 |
| Scatter or Bubble | 분산형 또는 거품형 | 한국어 Excel 관례 |
| Hierarchy & more | 계층 구조형 및 기타 | 한국어 Excel 관례 |
| Table (⌘T) | 표 (⌘T) | Word `ko.ts` table |
| Format as Table | 표 서식 | 한국어 Excel 관례 |
| Cell Styles | 셀 스타일 | 한국어 Excel 관례 |
| Pen⏎Black | 펜⏎검정 | 한국어 Excel 관례 |
| Pen⏎Blue | 펜⏎파랑 | 한국어 Excel 관례 |
| Pen⏎Red | 펜⏎빨강 | 한국어 Excel 관례 |
| Highlighter | 형광펜 | 한국어 Excel 관례 |
| Select and move ink and shapes | 잉크와 도형 선택 및 이동 | 한국어 Excel 관례 |
| Erase ink strokes | 잉크 지우기 | 한국어 Excel 관례 |
| Convert the last ink stroke to a shape | 마지막 잉크를 도형으로 변환 | 한국어 Excel 관례 |
| Paper Size | 용지 크기 | Word `ko.ts` pageFormat |
| Print Area | 인쇄 영역 | 한국어 Excel 관례 |
| Print Titles | 인쇄 제목 | 한국어 Excel 관례 |
| Insert Function | 함수 삽입 | 한국어 Excel 관례 |
| Insert Function (⇧F3) | 함수 삽입 (⇧F3) | 한국어 Excel 관례 |
| More Functions… | 함수 더 보기… | 한국어 Excel 관례 |
| e.g. lookup, average, date | 예: lookup, average, date | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Name Manager | 이름 관리자 | 한국어 Excel 관례 |
| No names defined | 정의된 이름이 없습니다 | 한국어 Excel 관례 |
| Show Formulas (⌃`) | 수식 표시 (⌃`) | 한국어 Excel 관례 |
| Watch⏎Window | 조사식⏎창 | 한국어 Excel 관례 |
| Add Watch (active cell) | 조사식 추가(활성 셀) | 한국어 Excel 관례 |
| Calculation Options | 계산 옵션 | 한국어 Excel 관례 |
| Calculate Now (F9) | 지금 계산 (F9) | 한국어 Excel 관례 |
| Calculate Sheet (⇧F9) | 시트 계산 (⇧F9) | 한국어 Excel 관례 |
| Import a text or CSV file | 텍스트 또는 CSV 파일 가져오기 | 한국어 Excel 관례 |
| Sort & Filter | 정렬 및 필터 | 한국어 Excel 관례 |
| Custom Sort | 사용자 지정 정렬 | 한국어 Excel 관례 |
| Filter (⌘⇧F) | 필터 (⌘⇧F) | 한국어 Excel 관례 |
| Clear Filter | 필터 지우기 | 한국어 Excel 관례 |
| Text to Columns | 텍스트 나누기 | 한국어 Excel 관례 |
| Flash Fill (⌘E) | 빠른 채우기 (⌘E) | 한국어 Excel 관례 |
| Remove Duplicates | 중복된 항목 제거 | 한국어 Excel 관례 |
| What-If Analysis | 가상 분석 | 한국어 Excel 관례 |
| Forecast Sheet | 예측 시트 | 한국어 Excel 관례 |
| Analysis Tools | 분석 도구 | 한국어 Excel 관례 |
| Spelling (F7) | 맞춤법 검사 (F7) | Word `ko.ts` spell |
| Workbook⏎Statistics | 통합 문서⏎통계 | Word `ko.ts` statistics |
| Workbook Statistics | 통합 문서 통계 | Word `ko.ts` statistics |
| Check Accessibility | 접근성 검사 | Word `ko.ts` accessibility |
| Protect⏎Sheet | 시트⏎보호 | 한국어 Excel 관례 |
| Protect Sheet | 시트 보호 | 한국어 Excel 관례 |
| Protect Workbook structure | 통합 문서 구조 보호 | 한국어 Excel 관례 |
| Zoom In | 확대 | Word `ko.ts` zoomIn |
| Zoom Out | 축소 | Word `ko.ts` zoomOut |
| Zoom to 100% | 100%로 되돌리기 | Word `ko.ts` resetZoom |
| Zoom to Selection | 선택 영역에 맞춤 | 한국어 Excel 관례 |
| Zoom… | 확대/축소… | Word `ko.ts` zoom |
| Macros | 매크로 | 한국어 Excel 관례 |
| Macros and scripts in this workbook (Alt+F8) | 이 통합 문서의 매크로와 스크립트 (Alt+F8) | 한국어 Excel 관례 |
| Macros preserved (not executed) | 매크로 보존(실행 안 함) | 한국어 Excel 관례 |
| This workbook has no scripts or macros. | 이 통합 문서에는 스크립트나 매크로가 없습니다. | 한국어 Excel 관례 |
| — VBA project (preserved, not run) | — VBA 프로젝트(보존, 실행 안 함) | 한국어 Excel 관례 |
| Automation in this workbook. GridCraft runs its own scripts; a file's VBA project is preserved but not executed. | 이 통합 문서의 자동화입니다. GridCraft는 자체 스크립트만 실행하며, 파일의 VBA 프로젝트는 보존하지만 실행하지 않습니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Search and run any command | 명령 검색 및 실행 | Word `ko.ts` ribbon.search |
| Search commands (⌘⇧Space) | 명령 검색 (⌘⇧Space) | Word `ko.ts` ribbon.search |
| Type a command, e.g. freeze, chart, bold… | 명령을 입력하세요. 예: 틀 고정, 차트, 굵게… | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| More commands | 명령 더 보기 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Every command run in this session (replayable) | 이 세션에서 실행한 모든 명령(다시 실행 가능) | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| How agents drive GridCraft (MCP / control channel) | 에이전트가 GridCraft를 제어하는 방법(MCP·제어 채널) | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| GridCraft is fully drivable by agents. Every menu item, button and gesture is a command: | GridCraft는 에이전트로 모든 기능을 제어할 수 있습니다. 메뉴 항목, 단추, 동작이 모두 명령입니다: | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Share: export or save a copy | 공유: 내보내기 또는 사본 저장 | Word `ko.ts` export |
| Export as PDF… | PDF로 내보내기… | Word `ko.ts` export |
| Print… | 인쇄… | Word `ko.ts` print |
| Version, contributors and the AI models that helped | 버전, 기여자, 도움을 준 AI 모델 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Start a new workbook | 새 통합 문서 시작 | 한국어 Excel 관례 |
| GridCraft | GridCraft | 고유명사 |
| GridCraft source code | GridCraft 소스 코드 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Modified for Sketch Docs. Based on GridCraft by the ArtCraft team. | Sketch Docs용 수정판. ArtCraft 팀의 GridCraft를 바탕으로 합니다. | 일반(브랜드 조건: 평문 출처) |
| No contributor data was built into this copy. | 이 빌드에는 기여자 정보가 들어 있지 않습니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| No model credits were built into this copy. | 이 빌드에는 AI 모델 정보가 들어 있지 않습니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Grab bag | 모아 보기 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Reverse the order | 순서 뒤집기 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Sort by | 정렬 기준 | Word `ko.ts` sortBy |
| Then by | 다음 기준 | Word `ko.ts` sortThenBy |
| Description (optional): | 설명(선택): | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Picture file path (PNG or JPEG): | 그림 파일 경로(PNG 또는 JPEG): | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Fits inside the selected cell and moves with its content. | 선택한 셀 안에 맞추고 셀 내용과 함께 이동합니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| + Add Level | + 기준 추가 | 한국어 Excel 관례 |
| My list has headers | 내 데이터에 머리글 표시 | 한국어 Excel 관례 |
| A to Z | 오름차순 | Word `ko.ts` sortAscending |
| Z to A | 내림차순 | Word `ko.ts` sortDescending |
| ↑  Sort Ascending | ↑  오름차순 정렬 | Word `ko.ts` sortAscending |
| ↓  Sort Descending | ↓  내림차순 정렬 | Word `ko.ts` sortDescending |
| Type to filter… | 입력하여 필터… | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Cell Values | 셀 값 | 한국어 Excel 관례 |
| Cell Color | 셀 색 | Word `ko.ts` chooseCellColor |
| Standard Colors | 표준 색 | 한국어 Excel 관례 |
| Theme Colors | 테마 색 | 한국어 Excel 관례 |
| More Borders… | 다른 테두리… | Word `ko.ts` moreColors |
| Data Labels | 데이터 레이블 | 한국어 Excel 관례 |
| Legend Entries (Series) | 범례 항목(계열) | 한국어 Excel 관례 |
| Horizontal axis title: | 가로 축 제목: | 한국어 Excel 관례 |
| Vertical axis title: | 세로 축 제목: | 한국어 Excel 관례 |
| Select a chart to format it. | 서식을 지정할 차트를 선택하세요. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| The chart no longer exists. | 차트가 더 이상 없습니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| There are no shapes, pictures or charts on this sheet. | 이 시트에는 도형, 그림, 차트가 없습니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Bring Forward | 앞으로 가져오기 | 한국어 Excel 관례 |
| Send Backward | 뒤로 보내기 | 한국어 Excel 관례 |
| Table Name: | 표 이름: | 한국어 Excel 관례 |
| Output options | 출력 옵션 | 한국어 Excel 관례 |
| Reports: | 보고서: | 한국어 Excel 관례 |
| The output range already holds data. Replace it with the report? | 출력 범위에 이미 데이터가 있습니다. 보고서로 바꾸시겠습니까? | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| A Date Occurring… | 발생 날짜… | 한국어 Excel 관례 |
| Duplicate Values… | 중복 값… | 한국어 Excel 관례 |
| Text that Contains… | 텍스트 포함… | 한국어 Excel 관례 |
| New Rule… | 새 규칙… | 한국어 Excel 관례 |
| Manage Rules… | 규칙 관리… | 한국어 Excel 관례 |
| There are no conditional formatting rules on this sheet. | 이 시트에는 조건부 서식 규칙이 없습니다. | 한국어 Excel 관례 |
| The spelling check is complete for the entire sheet. | 전체 시트의 맞춤법 검사를 마쳤습니다. | 한국어 Excel 관례 |
| Set Objective: | 목표 설정: | 한국어 Excel 관례 |
| To: | 대상: | 한국어 Excel 관례 |
| To value: | 찾는 값: | 한국어 Excel 관례 |
| Set cell: | 수식 셀: | 한국어 Excel 관례 |
| By changing cell: | 값을 바꿀 셀: | 한국어 Excel 관례 |
| By Changing Variable Cells: | 변수 셀 변경: | 한국어 Excel 관례 |
| Subject to the Constraints: | 제한 조건에 종속: | 한국어 Excel 관례 |
| Make Unconstrained Variables Non-Negative | 제한되지 않는 변수를 음이 아닌 수로 설정 | 한국어 Excel 관례 |
| Select a Solving Method: | 해법 선택: | 한국어 Excel 관례 |
| Keep Solver Solution | 해 찾기 해 보존 | 한국어 Excel 관례 |
| Restore Original Values | 원래 값 복원 | 한국어 Excel 관례 |
| Drag to fill cells. Drag from inside a cell to select a range. | 끌어서 셀을 채웁니다. 셀 안에서 끌면 범위를 선택합니다. | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Align Left | 왼쪽 맞춤 | Excel (결정 B) |
| Align Right | 오른쪽 맞춤 | Excel (결정 B) |
| Top Align | 위쪽 맞춤 | Excel (결정 B) |
| Middle Align | 가운데 맞춤 | Excel (결정 B) |
| Bottom Align | 아래쪽 맞춤 | Excel (결정 B) |
| Text Box | 텍스트 상자 | Excel (결정 B) |
| Page Breaks | 페이지 나누기 | Excel (결정 B) |
| About | 정보 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Contributors | 기여자 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Models | AI 모델 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Find | 찾기 | Word `ko.ts` find |
| All Charts | 모든 차트 | 한국어 Excel 관례 |
| Output Range: | 출력 범위: | 한국어 Excel 관례 |
| New Worksheet Ply: | 새 워크시트: | 한국어 Excel 관례 |
| Max | 최대 | 한국어 Excel 관례 |
| Min | 최소 | 한국어 Excel 관례 |
| Value Of: | 지정값: | 한국어 Excel 관례 |
| Answer | 해답 | 한국어 Excel 관례 |
| Limits | 한계값 | 한국어 Excel 관례 |
| None | 없음 | Word `ko.ts` noBorder |
| Bottom | 아래쪽 | 한국어 Excel 관례 |
| Top | 위쪽 | 한국어 Excel 관례 |
| Household Budget | 가계부 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Quarterly Sales Dashboard | 분기별 판매 대시보드 | 일반 번역(Word·Excel에 같은 메뉴 없음) |
| Gradebook | 성적표 | 일반 번역(Word·Excel에 같은 메뉴 없음) |

⏎는 줄바꿈(리본 두 줄 이름)이다.

## 편집 모드에서 더한 것 (2026-10-15, 단계 4 감사 — 셀 서식 창)

| 영어 | 한국어 | 근거 |
|---|---|---|
| Format Cells | 셀 서식 | Excel |
| Alignment | 맞춤 | Excel (결정 B) |
| Border | 테두리 | Excel |
| Font | 글꼴 | Excel |
| Format Cells\|Fill | 채우기 | Excel |
| Protection | 보호 | Excel |
| Category: | 범주: | Excel |
| Sample | 보기 | Excel |
| Type (custom format code): | 형식(사용자 지정 서식 코드): | Excel |
