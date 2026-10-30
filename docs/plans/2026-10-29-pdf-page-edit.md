# PDF 페이지 편집 추가 (2026-10-29)

선행: `2026-10-13-pdf-viewer.md`. 시작 커밋 `dec60a4`. 실행 지시서의 사용자 결정을 구현하며 push·배포는 하지 않는다. 구현은 이 체크아웃에서 단계별 시험 후 로컬 커밋한다.

> **현재 저장 정책:** 아래 2026-10-30 절이 2026-10-29 폴더+새 이름 정책을 대체한다. 이전 절과 검증 결과는 당시 기록이다.

## 사용자 결정

- 썸네일에서 마우스 끌기와 앞/뒤 버튼으로 이동, 삭제, 모든 페이지 경계에서 빈 페이지/PDF 삽입.
- Shift 범위 및 Ctrl/Cmd 개별 다중 선택. 이동 시 선택 페이지의 문서 내 순서를 유지한다.
- **추가 승인(2026-10-29):** 페이지 편집 문서만 `showDirectoryPicker`로 폴더를 고르고 새 파일 이름을 입력한다. 이미 있는 이름은 거절하며 덮어쓰지 않는다. `showSaveFilePicker`가 선택한 기존 파일을 비우기 때문에 이 경로를 분리한다. 주석만 편집한 문서의 기존 저장 경로는 유지한다.
- 페이지 편집 문서는 다른 이름으로 저장만 허용. 저장 버튼·Ctrl/Cmd+S는 이유를 표시하고 거절한다.
- 주석과 함께 편집하며 이동·삭제가 해당 페이지 주석에 적용된다. 삽입 PDF의 기존 주석은 읽기 전용.
- 빈 페이지는 앞 페이지의 MediaBox·회전을 따른다. 맨 앞이면 뒤 페이지를 따른다. 마지막 페이지 삭제는 거절.
- 페이지 편집에도 실행 취소·다시 실행. 원본 및 삽입 PDF의 실제 손실 위험만 저장 전에 확인.
- 암호 PDF·서명값이 있는 PDF(`/FT /Sig` + `/V`, `/Perms`) 삽입 거절. 기존 원본의 저장 거절 유지.

## 설계와 저장 정책

### 페이지와 이력

불변 원본 소스 바이트와 안정적인 페이지 ID를 가진 페이지 목록을 사용한다. 페이지 변경 시 `@cantoo/pdf-lib`로 목록 순서대로 재구성한다. 주석의 `page`는 1부터 시작하며 안정 ID를 거쳐 새 순번으로 바꾸고 삭제된 페이지의 주석은 제거한다. 빈 페이지는 독립된 페이지 항목이다.

주석과 페이지에 **하나의 snapshot 이력**을 둔다. 두 이력을 따로 두면 `주석 추가 → 페이지 삭제 → undo`에서 삭제된 페이지의 주석 편집이 엉뚱한 페이지에 적용될 수 있다. 각 snapshot은 페이지 목록과 주석 목록을 함께 가진다. 라이브러리 공개 controlled `annotations`·`onAnnotationsChange`를 쓰며 내장 undo/redo 단축키는 비활성화하고 호스트 버튼·단축키로 대체한다. 비동기 재구성 중 편집을 잠그고 성공한 결과만 원자적으로 반영한다. 실패는 현재 snapshot·dirty·이력을 유지한다.

원본에서 편집 가능한 우리 주석은 재구성 PDF에서 제거한 뒤 snapshot으로 다시 쓴다. 삽입 PDF의 우리 주석도 표준 주석으로 보존하되 private 표시를 제거해 읽기 전용 foreign으로 바꾼다. Popup·답글 관계 및 페이지 참조는 단계 0에서 확인한다. JSON 모델 첨부를 무작정 복사하면 옛 페이지 번호와 중복 주석이 생기므로 새 snapshot 모델로 다시 생성한다.

### 저장

페이지 변경 없는 문서는 기존 exporter·`checkPreservation`·복구 사본·Web Locks 경로를 그대로 사용한다. 페이지 변경 문서는 재구성 기준 바이트에 주석을 내보내고 **그 재구성 기준과 출력 사이**에는 기존 보존 검사를 적용한다. 재구성이 원본 전체 보존이라는 주장을 하지 않는다. 페이지 수·순서·크기·콘텐츠·foreign 주석은 별도 시험으로 확인한다.

원본/삽입 소스에 실제 존재하는 outline, 내부 링크/destination, AcroForm, PageLabels, StructTree 및 재구성에서 가져오지 않는 카탈로그 정보를 탐지한다. 해당 항목만 한국어로 나열하고 확인을 받은 뒤 선택기를 연다. 취소·구조 해석 실패·보호 문서는 선택기 전에 중단한다. 페이지 편집을 undo해 최초 목록으로 돌아오면 원본 경로를 다시 쓸 수 있지만, 재구성 저장 이후의 세션은 새 이름 저장 정책을 유지한다.

저장은 epoch·revision·페이지 목록·주석 snapshot을 캡처한다. 성공한 snapshot만 saved 기준으로 삼고 저장 중 추가 편집은 dirty로 남긴다. 쓰기는 기존 saver의 직렬 처리·Web Locks·대상 해시 재확인·close 성공 기준을 공유한다. 페이지 새 파일은 원본을 덮어쓰지 않으므로 복구 사본이 필요 없다. 기존 주석 전용 덮어쓰기의 복구 사본은 변경하지 않는다.

**승인된 새 파일 경로:** 이름 검사·생성·쓰기를 공통 Web Lock 안에서 처리한다. 기존 이름(빈 파일 포함)은 writable을 열지 않고 거절한다. 생성 이후 같은 이름의 entry·해시·수정 시각을 다시 확인하며, 쓰기 전/close 전 변경을 발견하면 abort한다. 실패 시 다른 파일일 수 있으므로 자동 삭제하지 않는다. 폴더 권한 거절·취소는 dirty·이력을 유지한다. 새 폴더 저장은 문서 교체 시 선택 대기를 취소하고 생성·쓰기 전에 epoch를 재검사한다. 기존 주석 전용 save picker가 이미 반환한 대상은 파일이 비워졌을 수 있어 종전 복구·쓰기 트랜잭션을 끝낸다. 같은 이름의 기존 파일은 해시 불변·쓰기 0회, 생성과 쓰기 사이 경합은 거절/abort를 시험한다.

[File System Standard](https://fs.spec.whatwg.org/#api-filesystemdirectoryhandle-getfilehandle)의 `getFileHandle({create:true})`는 기존 파일도 반환하며 원자적 create-exclusive를 제공하지 않는다. Web Lock은 같은 origin의 협력하는 탭을 보호한다. 외부 프로그램이 조회와 생성 사이에 동일한 빈 파일을 만들거나 마지막 검사와 close 사이에 변경하는 경합까지 원자적으로 막지는 못한다. 이 플랫폼 한계와 실패 후 빈 파일이 남을 가능성을 보고한다.

## 완료 조건 (DoD) ↔ 시험

| 번호 | 완료 조건 | 시험·판정 |
|---|---|---|
| 1 | 단일·다중 이동, 삭제, 마지막 페이지 보호 | `pdf-pages.test.mjs`: 순서·선택·주석 remap; `pdf.integration.mjs`: 마우스 드래그·앞/뒤·다중 선택·삭제 |
| 2 | 앞/사이/뒤 빈 페이지·PDF 삽입, 회전/MediaBox | 단위: 비영점 MediaBox·90도 회전·첫/끝 삽입; 브라우저: 실제 썸네일·쪽 수 |
| 3 | 통합 undo/redo, 주석 추가→이동→삭제→복구, 새 분기 redo 삭제 | `pdf-page-history.test.mjs`, 브라우저 혼합 편집 후 저장/재열기 |
| 4 | 페이지 저장 정책, 실제 위험만 확인, 취소·보호·실패 때 파일 불변 | `pdf-save.test.mjs`, `pdf-pages.test.mjs`, 브라우저 picker/write 횟수·원본 바이트 |
| 5 | 삽입 foreign 주석·Popup 보존, 암호/서명 삽입 거절 | 합성 fixture 단위 및 브라우저 저장 후 재열기 |
| 6 | snapshot 트랜잭션·dirty·이탈·전환 유지 | 기존 저장 시험 + 페이지 편집 중 저장/다른 문서 열기·취소 시험 |
| 7 | 기존 PDF·Word·한글·Excel 회귀 없음 | 마지막 `npm run verify` exit code 및 각 suite 수치 기록 |

## 픽스처

기존 A(3쪽·outline·foreign·양식), C1(서명), C2(빈 서명), D(암호), E(이미지), F(PageLabels·UserUnit)와 테스트 코드가 만드는 합성 PDF를 사용한다. 합성은 비영점 MediaBox·90도 회전, 우리 주석/Popup/JSON 첨부, 내부 목적지, StructTree, 일반 첨부를 포함한다. 사용자 파일은 쓰지 않는다.

## 범위 밖

PDF 본문 편집·회전 UI·터치 드래그·다른 형식 변환·서명 검증·암호/서명 저장·배포. 북마크/양식/구조 태그를 재구성하는 기능은 제공하지 않고 실제 위험을 알린다. OS 선택기·실제 마우스·외부 PDF 앱의 수동 검사는 실행 여부를 보고한다.

## 단계

- [x] **0. 라이브러리 실행 확인**: 공개 API의 copyPages 주석/Popup/모델 첨부 및 페이지 번호, controlled annotations·src 재로딩을 probe로 실측. 기록과 probe만 커밋. `node --import ./tests/ts-resolve.mjs --test tests/pdf-page-probe.test.mjs` 및 Chrome probe. 결과가 설계와 다르면 근거를 남기고 조정.
- [x] **1. 페이지 모델·재구성**: `src/pdf/pages.ts`, `tests/pdf-pages.test.mjs`. 실패 시험 → 목록 연산·빈 페이지·보호·손실 탐지·foreign 보존 → 통과 후 커밋. 새 단위 시험을 package 및 verify 목록에 등록.
- [x] **2. 통합 이력**: `src/pdf/pageHistory.ts`, `tests/pdf-page-history.test.mjs` 및 UI 연결. 기존 주석 시험을 먼저 실행하고, 혼합 이력 실패 시험 → 구현 → 기존 PDF 브라우저 회귀 후 커밋. 이력 연결과 페이지 UI 동작 커밋을 분리.
- [x] **3. 썸네일 페이지 조작**: `PdfEditor.svelte`·필요한 별도 썸네일 컴포넌트. 실패 브라우저 시험 → 다중 선택·드래그·이동·삭제·삽입·busy·에러 처리 → 관련 시험 후 커밋.
- [x] **4. 페이지 저장**: 기존 주석 전용 경로 유지, 재구성 출력 검사·손실 확인·새 이름 정책·saved snapshot. 단위/브라우저 실패 시험 → 구현 → 시험 후 커밋.
- [x] **5. 회귀·문서·보고**: `npm run verify` 전체 한 번, 독립 리뷰, 발견 사항 수정과 관련 시험, README/검증 기록. 보고서를 지정 scratchpad에 쓰고 `herdr agent prompt claude-main`으로 알린다. push/배포 없음.

## 위험과 확인 기록

- main 체크아웃은 시작 시 깨끗했고 HEAD는 `dec60a4`. 지시서대로 해당 체크아웃에서 진행한다.
- 기본 PATH의 Node는 22.14.0. 설치된 `/Users/hwjung/.volta/tools/image/node/24.21.0/bin/node`는 실행 결과 24.21.0. 시험/빌드에는 해당 bin을 PATH 선두로 사용한다.
- src 교체는 PDF 뷰를 재생성하므로 확대/스크롤·선택 포커스는 브라우저 시험에서 확인한다.
- 대형 PDF는 재구성 시간·snapshot 메모리가 늘 수 있다. 실행하지 않은 성능 확인은 보고서에 남긴다.


## 최종 결과

- 코드 커밋 `24697d0`에서 최종 `npm run verify` exit 0, `RELEASE GATE PASSED`. 단위 218/0/0, 기본·en-US 각각 PDF 42/0/0·공통 회귀 20/0/0, Word/한글 및 Excel 통합 runner 각 exit 0.
- 첫 verify는 단위 통과 뒤 정적 pdf-lib 의존성으로 인한 manifest 경계 위반에서 실패했다. 기존 동적 import를 유지하도록 수정하고 최종 전체 검증을 재실행했다. 검사 규칙은 변경하지 않음. 상세: `docs/validation/2026-10-29-pdf-page-edit.md`.
- 종료 후 시험/서버 Node와 Playwright Chrome의 pgrep 일치 0개. push·배포 없음.


## 2026-10-30 사용자 결정: OS 저장 창

시작 `c2f153a`. 사용자 지시서 `pdf-save-picker-brief.md`의 1–7을 실행한다. 이 체크아웃 main에서 로컬 커밋만 하며 push·배포하지 않는다.

- 페이지 편집의 다른 이름으로 저장은 `showSaveFilePicker`. 편집기 이름 입력/폴더 선택/추가 확인 줄은 제거한다. OS 대치 확인 후 선택 대상에 바로 쓴다. Ctrl/Cmd+S는 계속 거절한다. 주석 전용 저장 동작은 유지한다.
- 제안 이름은 마지막으로 연 파일 이름의 끝 `.pdf`를 대소문자 구별 없이 제거한 뒤 `-편집.pdf`를 붙인다. `report.pdf`·`report.PDF`·`report` → `report-편집.pdf`; 다른 확장자는 보존한다.
- `startIn`은 마지막으로 연 파일 핸들이다(저장 후 바뀌는 base 핸들과 구별). 핸들이 없으면 해당 옵션을 생략한다. 별도 `id`는 지정하지 않는다: 기존 PDF 열기 선택기가 id 없이 Chrome 기본 기억을 사용하므로 별도 기억 공간을 만들지 않는다. 근거: [File System Access §3.2.2](https://wicg.github.io/file-system-access/#api-filepickeroptions-startin).
- 재구성 바이트(export 입력)와 디스크 원본 바이트(복구 입력)를 분리한다. export·보존 검사·손실 확인·OPFS keep 및 readback 해시 검증을 모두 선택기 전에 끝낸다. 복구 대상은 현재 base의 이름·바이트이며 매 페이지 저장 시 사본을 검증한다.
- 새 페이지 저장 경로는 공통 Web Lock 안에서 복구·선택·쓰기까지 실행한다. 선택 뒤 해시 검사나 동일 파일 판정/epoch 거절을 하지 않는다. 실패하면 같은 선택 대상에 메모리 원본 바이트를 다시 쓰고 복원 성공/실패를 오류로 표시한다. 새 파일을 선택한 경우에도 실패 시 원본 PDF로 되쓴다. 다른 기존 파일의 이전 내용은 읽을 수 없으며 OS 대치 확인이 보호한다.
- 선택기 전 문서 변경은 취소한다. 선택기 반환 뒤 문서 변경은 이미 비워졌을 수 있는 대상의 쓰기를 끝내되 새 문서 상태에는 반영하지 않는다. snapshot dirty/undo/redo 및 직렬화는 유지한다.
- 활성화 만료 시 기존 두 번째 클릭 `저장할 위치 고르기`를 유지하며 취소는 dirty/이력을 보존한다.

### DoD와 시험

| 번호 | 조건 | 시험 |
|---|---|---|
| S1 | OS 선택기, 제안 이름, startIn, 폼 없음 | Chrome `page saving:`: pdf/PDF/확장자 없음, 핸들 있음/없음, 인자 기록 |
| S2 | 새 이름 저장 후 페이지/주석 재열기 | 기존 실제 손실·페이지 재열기 시나리오를 새 선택기에 연결 |
| S3 | 원본 대치 및 복구 | 선택 즉시 비우는 fake picker; 출력 내용/OPFS 원본 해시/복원 후 해시 비교 |
| S4 | 복구 실패/손실 취소/export 실패 | 단위와 Chrome: picker 0, 원본 불변 |
| S5 | 취소·쓰기 실패 | dirty/undo/redo 보존; create/write/close 실패 후 원본 되쓰기·결과 표시, 복원도 실패하는 경우 |
| S6 | 저장 중 문서/편집 변경, Web Lock | 선택 뒤 문서 변경에도 쓰기; 선택 전 변경은 취소; 추가 편집 dirty; 잠금 안 선택/쓰기 |
| S7 | 주석 전용·활성화 만료 회귀 | 기존 주석 저장 시험 유지, 두 번째 클릭과 취소 |
| S8 | 죽은 폴더 코드 없음·기존 제품 회귀 | 사용처 검색 및 PDF 단위/브라우저, 최종 HEAD에서 verify |

### 변경 단계

- [x] 1. 저장 조정자: `src/pdf/save.ts`에 `pickerOriginal`(복구 바이트)와 `{handle, picked:true}` 대상을 추가한다. `tests/pdf-save.test.mjs`에서 destructive picker·선행 복구 실패·쓰기/복원 실패·epoch/잠금을 RED→GREEN. 기존 폴더 경로는 UI 전환까지 유지. 관련 단위 시험 후 커밋.
- [x] 2. `PdfEditor.svelte`: 마지막 열기 이름/핸들로 선택기 옵션 구성, 새 경로 연결, 폼 제거, Ctrl+S 문구 갱신. `tests/pdf.integration.mjs`의 폴더 시험을 위 S1–S7로 바꾸어 RED→GREEN. `npm run check`, Svelte autofixer, build 및 PDF Chrome 시험 후 커밋.
- [ ] 3. 제거만 별도 커밋: 호출 없는 `newFile.ts`, saver 폴더 분기·allowOverwrite·isCurrent 및 전용 옛 시험 제거. PDF 단위/Chrome 동등 통과 확인.
- [ ] 4. 독립 읽기 전용 리뷰, 필요한 수정과 시험, 검증 문서 커밋. 마지막 커밋에서 `gtimeout 1800 npm run verify` 한 번 실행하고 결과는 지정 scratchpad 보고서에만 기록. 프로세스 잔존 확인 후 herdr로 알림.

OS 대치 확인/실제 폴더 기억/실제 손 조작 및 외부 앱 재열기는 자동 fake picker 시험과 구별하여 미실행 여부를 보고한다. 외부 프로그램의 동시 쓰기·OPFS 소실·복원 재쓰기까지 실패하는 디스크 오류는 남은 위험이다.
