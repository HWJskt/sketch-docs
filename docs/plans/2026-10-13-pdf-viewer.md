# PDF 뷰어·주석 추가 (2026-10-13)

선행: `2026-10-13-engine-preload.md`(첫 화면 형식 선택·엔진 미리 받기·진행 화면). 2026-10-13 완료(`fa504a9`~`2ad35e2`).

개정 이력:
- 초안(`c27c593`, `8c1ce1a`)
- Codex 계획 리뷰 1차 2회(고유 지적 13건, 모두 수용) → `e353ae2`
- Codex 계획 리뷰 2차 2회(고유 지적 10건, 모두 수용. 1차와 겹치지 않는 새 지적: 여러 탭 저장, 복구 사본, 보존 검사 범위, 엔진 목록 시작점, 번들 시험 순서, 서명 픽스처) → `790ec0c`
- Codex 계획 리뷰 3차 2회(herdr pane, 고유 지적 10건, 모두 수용: 증분 저장 접두부 검사 무효, 열거식 보존 검사, 복구 사본 확인 시점, 5단계 순서, PDF 브라우저 시험 게이트 등록, 청크 안 모듈 식별, 전환 시험 강도, 단계 분할, 외부 계약 합격 조건, 라이선스 수집 분리) → 이 판

## 사용자 결정 (2026-10-13)

- 범위: 보기 + 주석 + PDF로 저장. 주석은 표준 PDF 주석으로 저장해서 Acrobat·미리보기·Chrome에서도 보이게 한다.
- 화면: 세 번째 편집기. 공통 헤더에 W·한·PDF 버튼을 두고, `/pdf` 경로와 첫 화면 카드를 추가한다. 세 편집기의 상태는 전환해도 각각 유지한다.
- 코드: npm 패키지 `svelte-pdf-mini`를 정확한 버전으로 고정한다(0.9.1, MIT). 공개 API만 쓰고 패치하지 않는다. `source/` 클론·overlay 방식은 쓰지 않는다.
- 엔진 미리 받기: DOCX·HWPX·PDF 엔진 모두 첫 화면에서 백그라운드로 받는다. 순서는 마지막에 쓴 편집기 → DOCX → HWPX → PDF.
- 참고: [xivly](https://github.com/julien-blanchon/xivly)(MIT, 같은 라이브러리로 만든 리더)의 주석 도구막대·저장 흐름·pdf.js 자산 설정. 코드를 그대로 가져오면 그 파일에 MIT 고지를 단다.
- 복구 사본·"저장 전 원본 복원" 메뉴: 넣는다(2026-10-13 사용자 결정, 계획 3차 리뷰 뒤). 아래 "복구 사본" 그대로.

## 저장 정책

- **열린 파일에 저장(Ctrl+S):** PDF를 열 때의 파일 핸들과 기준 해시를 저장 대상으로 삼는다. 한글과 다르다. 한글은 형식 변환 손실 때문에 원본 덮어쓰기를 막는다. PDF는 원본에 주석만 더하고, 아래 보존 검사와 복구 사본을 통과할 때만 쓴다.
- **보존 검사:** 저장 방식(증분 저장이든 재작성이든)과 상관없이 같은 검사를 한다. 증분 저장도 원본 객체를 뒤에서 재정의할 수 있어서 "앞부분 바이트가 원본과 같다"는 보존 증거가 아니다.
  - 원본과 출력을 각각 최종 xref로 해석한다. trailer의 `/Root`·`/Info`에서 시작해 도달하는 객체 그래프 전체를 값으로 비교한다(참조는 따라가서 비교, 객체 번호는 무시, 스트림은 해석한 바이트의 해시).
  - **허용하는 차이**만 명시한다. 그 밖의 차이는 하나라도 있으면 쓰지 않는다.
    - 각 쪽의 `/Annots` 배열: 원본 항목이 같은 순서로 모두 남고, 뒤에 snapshot의 새 주석만 더해짐
    - 새 주석 객체와 그 appearance 스트림: snapshot의 종류·좌표·색·내용과 같음
    - 내용이 있는 새 주석에 붙는 Popup 주석
    - 라이브러리의 주석 모델 JSON 첨부 파일과 그 연결(카탈로그 `/Names`의 `/EmbeddedFiles`, `/AF`). 원본에 있던 다른 첨부 파일은 그대로여야 한다.
    - 이전 저장에서 우리가 쓴 주석(라이브러리가 자기 것으로 판별하는 것)의 교체·삭제
    - 문서 정보의 `ModDate`·`Producer`
  - 비교 코드가 해석하지 못하는 구조(예: 손상된 xref, 객체 스트림 해석 실패)는 판정 불가로 보고 거절한다.
  - export는 기본이 증분 저장이다(0b 확인). 복구는 쉬워지지만(원본 길이까지 자르면 됨) 검사를 줄이지는 않는다.
  - foreign 주석(우리가 쓰지 않은 기존 주석)은 PDF 편집기에서 읽기 전용으로 둔다. 라이브러리는 UI에서 고친 foreign 주석을 다시 쓰는데, 그러면 보존 검사에 걸린다.
- **복구 사본(2026-10-13 사용자 결정):**
  - 열린 파일에 처음 덮어쓰기 직전에 원본 바이트를 브라우저의 Origin Private File System에 저장한다.
  - 저장한 사본의 해시가 원본 해시와 같음을 확인한 뒤에만 쓴다. 사본을 못 만들면 쓰지 않는다.
  - 파일마다 최근 1개, 전체 최근 5개를 둔다.
  - 파일 메뉴의 "저장 전 원본 복원"은 그 사본을 다른 이름으로 저장 선택기로 내보낸다. 열린 파일을 직접 되돌리지 않는다.
- **거절하는 문서:** 아래는 저장하지 않는다. 열어서 보기·주석 그리기는 된다. 저장 메뉴가 거절 이유를 보여 준다.
  - 서명값이 있는 서명 필드(`/FT /Sig` 필드에 `/V` 사전이 있음)나 `/Perms`가 있는 PDF. 주석을 더하면 서명이 무효가 될 수 있다. 빈 서명 필드만 있으면 일반 문서처럼 저장한다.
  - 암호 PDF. 비밀번호를 넣고 보기·주석 그리기는 된다.
- **트랜잭션:** `docs/implementation-roadmap.md`의 저장 트랜잭션 6단계를 따른다.
  - 저장 요청은 문서 epoch와 주석 revision의 불변 snapshot으로 만든다. 한 탭에서는 한 번에 하나씩 처리한다.
  - **여러 탭:** 쓰기는 Web Locks(`navigator.locks`, 이름 하나로 모든 PDF 저장을 잠금) 안에서 한다. 잠금을 얻은 뒤 대상 파일 해시를 다시 확인한다. 다른 탭이 먼저 썼으면 해시가 달라 "밖에서 바뀐 파일"로 거절한다.
  - 성공한 snapshot의 revision만 저장 완료로 반영한다. 저장하는 동안 추가한 편집은 dirty로 남는다.
  - 늦게 도착한 worker 응답(문서가 바뀐 뒤)은 버린다.
  - 쓰기는 File System Access의 writable stream으로 한다. `close()`가 성공해야 파일이 바뀐다. 실패하면 원본 해시·저장 대상·dirty를 유지한다.

## 완료 조건 (DoD)

1. **진입·전환:**
   - `/`의 PDF 카드, 헤더의 PDF 버튼으로 PDF 편집기에 들어간다.
   - `/pdf`·`/pdf.html` 직접 접속, 뒤로/앞으로 가기, 새로고침이 편집기를 바꾸지 않는다. 첫 화면에서 같은 화면으로 열린다(엔진 미리 받기의 규칙과 같음).
   - 세 편집기에 각각 다른 문서를 열고 편집한 뒤 왕복 전환해도 문서·파일 연결·dirty·실행 취소 이력이 그대로다.
2. **보기:** 파일 메뉴에서 PDF를 열고 다음을 쓴다.
   - 확대·축소, 맞춤(쪽 너비·쪽 전체), 쪽 이동
   - 찾기(대소문자·악센트 무시), 목차, 썸네일
   - 텍스트 선택·복사, 인쇄
   - 암호 PDF: 비밀번호를 넣고 본다. 틀린 비밀번호는 다시 묻는다.
3. **주석:** 하이라이트·밑줄·취소선·메모·펜·사각형을 그린다. 실행 취소·다시 실행이 된다. 서명·암호 PDF에서도 그린다.
4. **저장:** 위 "저장 정책"대로 동작한다.
   - Ctrl+S는 열린 파일에, 다른 이름으로 저장은 새 파일에 쓴다. 저장한 파일을 다시 열면 주석 6종의 종류·좌표·색·내용이 그대로다.
   - 밖에서 바뀐 파일, 보존 검사 실패, 서명값 있는 PDF, 암호 PDF는 거절한다. 거절할 때는 writable을 만들지 않고 원본 해시가 그대로다.
   - 두 탭이 같은 파일을 동시에 저장하면 한쪽만 성공한다. 다른 쪽은 거절되고 dirty·이력이 남는다.
   - 덮어쓰기 전에 복구 사본이 있고, 복원하면 원본과 해시가 같다.
5. **이탈 확인:** 저장 안 한 주석이 있으면 탭 닫기, 다른 PDF 열기, 첫 화면으로 뒤로 가기에서 확인을 받는다. 취소하면 문서와 파일 연결, dirty가 그대로다.
6. **문서가 밖으로 나가지 않음:**
   - PDF를 열고 보는 동안 외부 출처 요청 0건
   - pdf.js worker·cMap·표준 글꼴·wasm·ICC는 우리 배포판에서 받는다. 한국어 CID 글꼴 PDF는 우리 cMap 응답을 받아 canvas에 글자를 그린다.
   - 논문 기능의 온라인 인용 조회는 쓰지 않는다.
7. **기존 동작:** Word·한글 동작이 그대로다. 기존 단위·통합·회귀 시험이 모두 통과한다.
8. **번들 경계:**
   - 첫 화면·Word·한글 진입 청크와 셸 청크의 정적 import 그래프에 PDF 코드(`svelte-pdf-mini`, `pdfjs-dist`, `@cantoo/pdf-lib`)가 없다. 빌드 산출물 검사로 확인한다.
   - PDF 엔진 파일(`PdfEditor` 동적 청크와 그 정적 의존 JS·CSS, pdf.js worker)은 `engines/manifest.json`의 `pdf`에 올라가고, 첫 화면에서 순서대로 미리 받는다.
   - 진입 청크 크기는 1단계 전에 기록한 값과 비교해 적는다.
9. **라이선스:** 정보 창과 `legal/`에 런타임 의존성 전부의 라이선스가 있다. 라이선스 파일이 없는 의존성이 있으면 `npm run verify`가 실패한다.
10. **배포 조건:** Cloudflare Pages 제한(파일당 25MiB, 20,000개) 안이다. 일반 `npm run verify`, 후보 검증(`npm run upstream:check -- --current`), `npm run build`가 통과한다. 배포한 뒤 `npm run test:live`가 통과한다.
11. **개발 서버:** `npm run dev`에서 `/pdf`로 픽스처 B를 열고 worker가 돈다.

## DoD ↔ 시험

| DoD | 시험(파일) | 판정 |
|---|---|---|
| 1 | 회귀 `tests/regressions.mjs` | PDF 카드·헤더 전환·직접 URL·뒤로/앞으로·새로고침의 각 단계에서 PDF 화면과 주소 일치 |
| 1(보기 상태) | 통합 `tests/pdf.integration.mjs` (5c) | Word·한글·PDF에 서로 다른 문서와 저장 대상을 연결 → W→한→PDF→W 전환 → 각 편집기의 문서 본문(PDF는 현재 쪽·배율), 문서 이름이 전환 전과 같음 |
| 1(편집 상태) | 통합 (8c) | 세 편집기에 구별되는 편집(Word·한글 본문, PDF 주석)과 서로 다른 파일 핸들 → 왕복 전환 → 실제 내용 비교, undo→redo 결과 비교. 각 편집기에서 저장 → 자기 대상만 바뀌고 나머지 두 파일 해시 그대로(10b 이후 PDF 포함). 이름·dirty는 보조 단언 |
| 2 | 통합 | 픽스처 A: 쪽 수 3, 찾기 "Résumé"·"resume" 결과 수 같음, 목차 2번째 항목 → 2쪽, 썸네일 3개, 확대 후 scale 변화, 맞춤 두 종류의 쪽 너비 값, 선택 후 클립보드 문자열, `window.print` 호출. 픽스처 D: 틀린 비밀번호 → 다시 묻기, 맞는 비밀번호 → 1쪽 렌더 |
| 3 | 통합 | A·C1·D에서 6종을 각각 그린 뒤 주석 목록(종류·좌표·색·내용), undo 6회 → 0개, redo 6회 → 6개 |
| 4(보존) | 단위 `tests/pdf-preserve.test.mjs` | A·E·F 왕복 보존 통과. 변이마다 거절(재작성 출력과, 원본 뒤에 덧붙인 증분 출력 두 형태로 각각): 이미지 XObject 제거(E), `Contents` 비우기, `Rotate` 변경, `UserUnit`·`Group` 삭제(F), `PageLabels` 삭제(F), 기존 주석 appearance 변경, 양식 값 변경, snapshot에 없는 주석 추가. 손상 xref → 판정 불가 거절 |
| 4(판별) | 단위 `tests/pdf-preserve.test.mjs` | C1·D 거절, C2 저장 가능 |
| 4(트랜잭션) | 단위 `tests/pdf-save.test.mjs`(가짜 파일 핸들) | snapshot·직렬화·늦은 응답 무시. 권한 거절, `createWritable`·`write`·`close` 실패 주입 → 원본 해시·저장 대상·dirty·주석 이력 유지, busy 해제. 복구 사본 실패 → writable 생성 0회. 잠금 안 해시 재확인 |
| 4(UI) | 통합 | 저장 왕복 후 주석 목록이 저장 전과 같음. 거절 경우마다 writable 생성 0회와 원본 해시 같음. 같은 파일을 연 두 페이지가 동시에 저장 → 한쪽 성공, 다른 쪽 "밖에서 바뀐 파일" 거절·dirty 유지. 원본 복원 결과 해시 = 원본 해시 |
| 5 | 통합 | 승인·취소 양쪽, 3가지 경로 |
| 6 | 통합 | Playwright 요청 로그에서 다른 출처 0건. 픽스처 B에서 같은 출처 cMap 응답 200, canvas 영역 비어 있지 않음. 변이: cMap 경로를 틀리게 하면 실패 |
| 7 | `npm run verify` 전체 | 기존 시험 실패 0 |
| 8 | 빌드 뒤 시험 `tests/bundle-boundary.mjs <outDir>`, 회귀(엔진 목록에 pdf) | 빌드 훅이 기록한 청크별 모듈 ID로 판정: 진입·셸에서 정적으로 닿는 청크의 모듈 중 세 PDF 패키지 경로 0건. 목록의 `pdf` 파일이 실제 PDF 열기 요청과 같음. 변이: 각 패키지에서 실제로 쓰는 export 하나를 셸에 넣으면 실패 |
| 9 | 단위 `tests/release-info.test.mjs` | LICENSE 없는 의존성 → 실패 |
| 10 | `npm run verify`, `npm run upstream:check -- --current`, `npm run build` | 셋 다 통과, Pages 제한 검사 통과 |
| 11 | 수동(명령과 결과를 이 문서에 기록) | `npm run dev` → `/pdf`에서 픽스처 B 열기 성공, worker 요청 200 |
| 외부 뷰어 | 수동: Acrobat Reader·macOS 미리보기·Chrome에서 왕복 파일 열기 | 6종 주석이 보이는지 스크린샷으로 기록 |

### 픽스처

`tests/fixtures/pdf/`. 만드는 스크립트 `scripts/make-pdf-fixtures.mjs`도 커밋한다. 의존성 없이 PDF 객체를 직접 쓰고, 암호는 Node 내장 `crypto`(AES-128, R4)로 만든다.

| 이름 | 내용 |
|---|---|
| A | 3쪽, 목차 2항목, 본문에 "Résumé"·"resume", 기존 주석 1개, 양식 필드 1개(값 있음) |
| B | 한국어 CID 글꼴, 글꼴 미포함. Adobe-Korea1 cMap(`UniKS-UCS2-H`)이 있어야 그려진다. |
| C1 | 서명값이 있는 서명 필드(`/V`에 `/ByteRange`·`/Contents`). 서명 바이트는 암호학적으로 유효하지 않다. 판별은 구조로만 하므로 이 픽스처로 충분하다. |
| C2 | 빈 서명 필드만 있음 |
| D | 사용자 암호 `test` |
| E | 이미지 XObject 1개를 쓰는 1쪽 |
| F | 쪽에 `/UserUnit 2`·`/Group`, 카탈로그에 `/PageLabels`, 우리 비교 코드가 따로 다루지 않는 사용자 키 `/XSketchTest` |

`node scripts/make-pdf-fixtures.mjs --check`는 다시 만든 바이트가 커밋된 파일과 같은지 비교한다(날짜·ID를 고정한다).

## 범위 밖

- PDF 본문 편집(글자 고치기·쪽 추가/삭제·병합)
- Word·한글 문서를 PDF로 변환
- PDF 오프라인 사용(서비스 워커 캐시)
- 논문 전용 기능(인용 카드·참고문헌·그림 색인), 서재·태그 같은 xivly의 라이브러리 기능
- 서명·암호 PDF 저장, 서명 검증
- 외부 프로그램과의 파일 잠금
- 모바일 터치 주석 최적화, Safari

## 확인한 사실

### 라이브러리 (0b에서 실행으로 확인, 2026-10-13)

기록: `docs/validation/2026-10-13-pdf-probe.md`. 요약:

- `svelte-pdf-mini` 0.9.1(MIT). peer `svelte ^5.57.0`. 공개 심볼 `configurePdf`·`Document`·`Viewer`·`Zoom`·`PageNav`·`Find`·`Outline`·`Thumbnails`·`Annotations`, `pdf-codec`의 `exportPdf`·`importAnnotations`·`saveSupport`·`PdfSaveError`.
- `pdfjs-dist` 6.4.299. `configurePdf`에 같은 출처 경로를 주면 외부 요청 0건으로 한국어 CID PDF가 그려진다. 암호 PDF는 `password`로 열린다.
- `pdf-codec`은 Web Worker에서 6종 주석을 쓰고 다시 읽는다. 차이 0건.
- `exportPdf`는 기본이 증분 저장이다. 원본 바이트가 출력 앞에 그대로 남는다.
- 저장할 때 라이브러리가 Popup 주석과 주석 모델 JSON 첨부 파일을 더한다. 다시 저장하면 자기가 쓴 주석을 바꿔 쓴다.
- `saveSupport()`는 암호 파일만 막는다. 서명 판별은 우리가 한다.
- 런타임 전이 의존성 22개 모두 LICENSE 파일이 있다. `svelte-toolbelt`는 package.json에 `license` 필드가 없다.
- Vite worker는 `worker: { format: 'es' }`가 필요하다.
- xivly 참고 커밋 `3cd200662247a19cb559fd8929445d6c1f154cc1`에 `src/lib/export.ts`·`src/lib/pdf.ts`가 있다.

### 우리 저장소에서 확인한 사실 (2026-10-13)

- `src/routes.ts`의 `EditorMode`가 `'word' | 'hwp'`다.
- `vite.config.ts` 입력이 `home`·`word`·`hwp`다. `build.manifest`는 켜져 있지 않다.
- `src/EditorShell.svelte`의 `states()`·`blocked`는 Word·한글 두 편집기만 본다.
- `src/hangulFiles.ts`의 `writeArtifact`는 해시 확인과 쓰기 사이를 잠그지 않는다. 탭 사이 조정도 없다.
- `scripts/release-info.mjs`는 npm 라이선스 목록을 이름으로 하드코딩한다.
- `scripts/build-engines.mjs`는 Word 엔진 안에 한글 컴포넌트 파일 5개를 이름으로 복사한다. 공용 모듈을 새로 만들면 이 목록도 바꿔야 한다.
- `scripts/verify.mjs`
  - 단위 시험 파일을 이름으로 열거하고, 셸 빌드보다 **먼저** 돌린다. `TEST_DIST`는 빌드 뒤 브라우저 시험에만 준다.
  - `productHash`는 루트 HTML 파일을 이름으로 열거한다(`pdf.html`을 더해야 한다).
  - 후보 검증은 `.cache/candidate-public`·`candidate-dist`를 쓰고, public 파일 몇 개만 복사한다.
- `engines/manifest.json`은 셸 빌드 전에 `build-engines.mjs`가 만든다. `npm run build`는 `prepare:engines` 뒤 `vite build`다.

## 단계

공통 규칙:
- 단계마다 적힌 명령을 돌려 기대값을 확인한 뒤 커밋한다.
- 새 단위 시험은 `package.json`의 `test:contracts`와 `scripts/verify.mjs`의 단위 시험 목록에 같은 커밋에서 등록한다.
- 빌드 산출물을 읽는 시험은 단위 목록에 넣지 않는다. `verify.mjs`의 빌드 뒤 단계에서 `outDir`을 인자로 준다.
- PDF 브라우저 시험은 `tests/pdf.integration.mjs` 하나에 모은다. 4a-1에서 `verify.mjs`의 빌드 뒤 브라우저 시험 목록(지금 `integration`·`regressions`)에 등록하고 같은 `TEST_DIST=outDir`을 준다. 그래서 일반·후보 검증과 push CI가 매번 돌린다. runner는 스스로 빌드하지 않는다.
- `npm run test:pdf` = `npm run build && TEST_DIST=dist node tests/pdf.integration.mjs`. 4a-1에서 일부러 PDF 단언 하나를 틀리게 해 `test:pdf`·`verify`·`upstream:check -- --current`가 모두 실패하는지 확인한다.

### 0a. 픽스처
- `scripts/make-pdf-fixtures.mjs`와 픽스처 A·B·C1·C2·D·E·F를 커밋한다.
- 명령: `node scripts/make-pdf-fixtures.mjs --check`. 기대: exit 0.
- 픽스처가 pdf.js로 열리는지는 0b의 0번 항목에서 확인한다(pdf.js는 0b에서 설치).

### 0b. 라이브러리 실행 확인 (커밋은 시험 스크립트와 기록)
- `scripts/pdf-probe/run.mjs --dir <임시폴더>`: 임시 폴더에 `svelte-pdf-mini@0.9.1`을 설치하고 아래를 차례로 확인해 JSON으로 출력한다. 시작한 서버·브라우저는 finally에서 닫는다.
  0. 픽스처 7개를 pdf.js로 연다(D는 비밀번호 `test`). 기대: 쪽 수 A=3, 나머지 1. 안 열리면 0a로 돌아가 고친다.
  1. 설치본의 무결성 값·`exports`·타입 선언, peer, 전이 의존성 버전, `pdfjs-dist` 실제 버전과 `cmaps/`·`standard_fonts/`·`wasm/`·`iccs/`·worker 경로. 기대: 계획이 쓰는 공개 심볼이 타입 선언에 모두 있음 — 보기 컴포넌트, `configurePdf`, `svelte-pdf-mini/pdf-codec`의 주석 읽기·쓰기와 `exportPdf`(정확한 이름은 이 항목에서 확정해 기록)
  2. 렌더링: 시험 페이지를 우리 Vite로 빌드해 Chrome(playwright-core)으로 연다. `configurePdf`에 같은 출처 경로를 주고 B를 그린다. 기대: 외부 출처 요청 0건, cMap 응답 200, canvas 비어 있지 않음.
  3. 주석 왕복: 같은 페이지의 Web Worker에서 `pdf-codec`으로 A에 6종 주석을 쓰고 다시 읽는다. 기대: 종류·좌표(±0.01)·색·내용이 같음.
  4. 증분 여부: 3의 출력 앞 `A 길이` 바이트가 A와 같은지. 기대값 없음(기록만 한다).
  5. 판별·보존 검사 API: `@cantoo/pdf-lib`로 C1의 `/V`, C2의 빈 필드, D의 암호 표시, E의 XObject 그래프, F의 `/UserUnit`·`/PageLabels`, 3의 출력의 최종 xref 객체를 읽는다. 기대: 모두 읽힘.
  6. 암호 보기: D를 비밀번호 `test`로 그린다. 기대: canvas 비어 있지 않음.
- 명령: `node scripts/pdf-probe/run.mjs --dir <scratch>`. 기대: exit 0, 항목 0·1·2·3·5·6이 통과.
- 결과는 `docs/validation/2026-10-13-pdf-probe.md`에 출력 JSON, 최소 실행 코드 경로, 확인한 xivly 커밋 전체 SHA와 함께 적는다. "미확인 전제" 절을 실행 결과로 바꾼다.
- **합격:** 0·1·2·3·5·6 통과. 하나라도 안 되면 여기서 멈추고 사용자에게 보고한다. 합격 기록 전에는 1단계 이후를 시작하지 않는다.

### 1. Svelte 업그레이드만
- 시작 전에 첫 화면·Word·한글 진입 청크 크기를 기록한다.
- `svelte`를 ≥5.57로 올린다.
- 명령: `npm run verify`. 기대: 단위·통합·회귀 실패 0(현재 단위 40·회귀 14).

### 2a-1. 라이선스 수집기 정리 (동작 보존)
- 지금 하드코딩한 npm 4개(`canvaskit-wasm`·`@noble/hashes`·`fflate`·`svelte`)의 수집을 함수로 뺀다. 목록은 그대로다.
- 명령: `npm run test:contracts`. 기대: 만든 `legal/` 파일 목록과 `notices.txt` 바이트가 바꾸기 전과 같음(시험으로 비교).

### 2a-2. 런타임 전이 의존성 전체로 확대 (동작 변경)
- `npm ls --omit=dev --all --json`으로 런타임 의존성 전체를 모은다. 지금 lock에서도 24개다(`clsx`·`esm-env`·`acorn`·`@webgpu/types` 등). LICENSE 파일이 없으면 실패한다. package.json의 `license` 필드가 아니라 파일로 판정한다(`svelte-toolbelt`는 필드가 없다).
- 명령: `npm run test:contracts`, `npm run verify`. 기대: `legal/`에 lock의 런타임 패키지 전부, LICENSE 없는 가짜 의존성 → 실패.
- 실제로 LICENSE 파일 없이 배포된 패키지는 `scripts/release-info.mjs`의 `licenseFileExceptions`에 정확한 버전으로 적고, package.json의 라이선스와 저장소를 고지한다. 버전이 바뀌면 다시 확인해 적는다.

### 2b. 의존성 추가
- `svelte-pdf-mini`와 `@cantoo/pdf-lib`(보존 검사용, 0b에서 확인한 버전)를 정확한 버전으로 넣는다. 이 단계에서는 import하지 않는다.
- 명령: `npm run verify`. 기대: 통과, `legal/`에 새 런타임 의존성 전부.

### 3. pdf.js 자산 배치
- `build-engines.mjs`가 전달받은 `output`(일반 `public/`, 후보 `.cache/candidate-public/`)에 `pdfjs/<pdfjs 버전>/`으로 worker·cMap·글꼴·wasm·ICC를 복사한다. `.gitignore`에 `public/pdfjs/`를 더한다.
- dev 서버도 같은 경로를 쓴다(`npm run dev`가 `build-engines` 뒤에 시작함).
- 명령: `npm run verify`, `npm run upstream:check -- --current`. 기대: 두 산출물에 `pdfjs/<버전>/` 존재, Pages 제한 통과. 파일 수와 가장 큰 파일 크기를 이 문서에 적는다.

### 4a-1. 독립 진입과 자산 설정
- `src/pdf/setup.ts`(`configurePdf`, 이 모듈 안에서만 import)와 빈 `src/pdf/PdfEditor.svelte`를 만든다.
- 시험용 진입 `pdf.html`이 셸 없이 `PdfEditor`를 띄운다. `vite.config.ts`에 `optimizeDeps.exclude: ['pdfjs-dist']`, `worker: { format: 'es' }`, 입력 `pdf`를 더한다. `verify.mjs`의 `productHash` 목록에 `pdf.html`을 더한다.
- `tests/pdf.integration.mjs`와 `test:pdf`를 만들고 verify에 등록한다(공통 규칙).
- 명령: `npm run test:pdf`, `npm run verify`. 기대: `/pdf.html`이 뜨고 외부 출처 요청 0건. 등록 변이 확인.

### 4a-2. 열기·그리기
- 명령: `npm run test:pdf`. 기대: A 1쪽 canvas가 비어 있지 않음, B에서 DoD 6(cMap 200, 변이 실패). cMap 경로가 틀리면 문서는 열리고 칠해진 픽셀이 0이다(0b 확인) — 변이 판정은 픽셀로 한다.

### 4a-3. 확대·맞춤
- 명령: `npm run test:pdf`. 기대: 확대 후 scale 변화, 맞춤 두 종류의 쪽 너비 값.

### 4a-4. 쪽 이동
- 명령: `npm run test:pdf`. 기대: 다음·이전·번호 입력으로 현재 쪽 1→2→3→1.

### 4b-1. 찾기
- 명령: `npm run test:pdf`. 기대: A에서 "Résumé"·"resume" 결과 수 같음.

### 4b-2. 목차
- 명령: `npm run test:pdf`. 기대: 목차 2번째 항목 → 2쪽.

### 4b-3. 썸네일
- 명령: `npm run test:pdf`. 기대: 썸네일 3개, 3번째 클릭 → 3쪽.

### 4c-1. 선택·복사
- 명령: `npm run test:pdf`. 기대: 클립보드 문자열.

### 4c-2. 인쇄
- 명령: `npm run test:pdf`. 기대: `window.print` 호출.

### 4d. 암호 PDF 보기
- 비밀번호 입력 창. 틀리면 다시 묻는다.
- 명령: `npm run test:pdf`. 기대: DoD 2의 픽스처 D 항목.

### 5a. PDF 엔진 타입과 목록 없는 엔진 처리
- `enginePreload`의 `Engine`에 `pdf`를 더하고, `EngineProgress`의 라벨을 더한다.
- 목록(`engines/manifest.json`)에 해당 엔진 항목이 없으면 `prepare`가 `ManifestError`를 던져 진행 화면 없이 열게 한다(dev 서버, 6a 전 빌드).
- 명령: `npm run test:contracts`, `npm run verify`. 기대: `enginePreload` 단위 시험 "목록에 없는 엔진 → ManifestError" 통과, 기존 시험 통과.

### 5b. 경로
- `EditorMode`에 `pdf`를 더한다. `modeFromPath`·`isHomePath` 시험에 `/pdf`·`/pdf.html`을 추가한다.
- 명령: `npm run test:contracts`. 기대: 계약 시험 통과.

### 5c. 셸 마운트·헤더
- `EditorControls`에 PDF 버튼, `EditorShell`에 `PdfEditor` 동적 import 마운트(필요하면 `EngineProgress engine="pdf"`)를 추가한다. `states()`·`blocked`·이탈 판단에 PDF 상태를 더한다. `pdf.html`을 셸 진입으로 바꾼다.
- 명령: `npm run verify`. 기대: DoD 1의 헤더 전환·직접 URL·뒤로/앞으로·새로고침 회귀, DoD 1(보기 상태) 통합, 기존 회귀 14개.
- 수동: `npm run dev` → `/pdf`에서 픽스처 B 열기, worker 요청 200(DoD 11). 결과를 이 문서에 적는다.

### 5d. 첫 화면 카드
- 첫 화면 PDF 카드와 `home.ts` 카드 가로채기 대상을 추가한다.
- 명령: `npm run verify`. 기대: DoD 1의 PDF 카드 회귀(같은 화면에서 열림).

### 6a. PDF 엔진 목록
- `vite.config.ts`에 `build.manifest: true`를 켠다. 산출물의 `.vite/`(manifest와 6c의 모듈 목록)는 검사 자료라 배포 파일에서 뺀다. `outputHash`·Pages 제한 검사·`deploy`가 같은 목록을 쓰는지 시험한다.
- 셸 빌드 뒤 단계(`scripts/pdf-manifest.mjs`)가 Vite manifest에서 `src/pdf/PdfEditor.svelte`의 동적 청크를 시작점으로 정적 의존 JS·CSS를 모은다. 여기에 3단계의 worker 파일을 더해, 실제 출력 폴더의 `engines/manifest.json`에 `pdf`로 넣는다.
- 이 단계를 `verify.mjs`(일반·후보)와 `npm run build` 모두에서 부른다. `outputHash`보다 먼저 돈다.
- 단위 시험: 가짜 Vite manifest로 시작점·의존 수집·누락 파일 실패.
- 명령: `npm run verify`, `npm run upstream:check -- --current`, `npm run build`. 기대: 세 산출물의 목록에 `pdf`. 회귀: PDF를 처음 열 때 진행 화면이 끝난 뒤 목록 밖 100KB 넘는 요청 0건.

### 6b. 미리 받기 순서
- `engines.ts` 순서에 `pdf`를 더한다.
- 명령: `npm run verify`. 기대: 회귀 "첫 화면 미리 받기 순서"에 PDF 포함, 단위 통과. 첫 화면에서 받는 총량을 엔진 미리 받기 문서에 적는다.

### 6c. 번들 경계 시험
- Vite manifest에는 청크 안에 들어간 모듈 목록이 없다. 그래서 빌드 플러그인이 `generateBundle`에서 청크별 `moduleIds`를 `.vite/chunk-modules.json`으로 기록한다(배포 파일에서는 뺀다).
- `tests/bundle-boundary.mjs <outDir>`: manifest로 첫 화면·Word·한글 진입과 셸 청크에서 정적으로 닿는 청크를 모으고, 그 청크들의 모듈 ID에 `svelte-pdf-mini`·`pdfjs-dist`·`@cantoo/pdf-lib` 경로가 0건인지 본다.
- `verify.mjs`가 셸 빌드와 6a 뒤에 실제 `outDir`(일반 `dist/`, 후보 `candidate-dist/`)로 부른다.
- 명령: `npm run verify`, `rm -rf dist && npm run upstream:check -- --current`. 기대: 둘 다 통과. 변이 세 개(세 패키지에서 각각 실제로 쓰는 export 하나를 셸에서 호출) → 각각 실패.

### 7. 파일 선택·쓰기 공용화 (동작 보존 리팩터링)
- 7a: 파일 선택기 래퍼를 공용 모듈로 뺀다. 7b: 해시·쓰기를 공용 모듈로 뺀다. 각각 따로 커밋한다.
- 공용 모듈을 `build-engines.mjs`의 Word 엔진 복사 목록에 더한다.
- 명령(각 커밋): `npm run verify`. 기대: 루트·Word 엔진 타입 검사 통과, 한글 저장·취소·외부 변경·원본 보호 시험이 리팩터링 전과 같은 결과.

### 8a. 주석 상태·이력
- 주석 목록과 실행 취소·다시 실행 저장소. dirty를 셸 상태로 보낸다. 도구막대 구성은 xivly `AnnotationToolbar`를 참고한다.
- 명령: `npm run test:contracts`(신규 `tests/pdf-annotations.test.mjs`). 기대: 추가 6회 → undo 6회 → 0개 → redo 6회 → 6개, dirty 전이.

### 8b. 도구별 그리기
- 첫 화면 PDF 카드·헤더 PDF 버튼 툴팁에 주석을 더한다(5d 이후에는 지금 되는 기능만 적어 둠: "PDF 문서 보기").
- 하이라이트·밑줄·취소선 → 메모 → 펜 → 사각형 순으로 하나씩 추가하고, 도구마다 따로 커밋한다.
- 명령(각 커밋): `npm run test:pdf`. 기대: 그 도구로 그린 주석의 종류·좌표·색·내용. 6개가 끝나면 DoD 3 전체(A·C1·D).

### 8c. 세 편집기 편집 상태 보존
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 1(편집 상태) 표에서 저장 부분을 뺀 전부(PDF 저장 비교는 10b에서 더함).

### 9a. 보존 검사 모듈
- `src/pdf/preserve.ts`: 원본 바이트, 출력 바이트, 주석 snapshot을 받아 "보존 검사"대로 판정한다.
- 명령: `npm run test:contracts`(신규 `tests/pdf-preserve.test.mjs`). 기대: DoD 4(보존) 표의 통과·거절 경우 전부.

### 9b. 서명·암호 판별
- 명령: `npm run test:contracts`. 기대: C1·D 거절, C2 저장 가능, 판별 변이(`/V` 검사 제거) → 실패.

### 9c. 내보내기 worker
- `src/pdf/export.worker.ts`: snapshot을 받아 `exportPdf`를 실행하고 9a 검사 결과를 함께 돌려준다. 상한 120초이고, 시간이 넘으면 worker를 다시 시작한다.
- 명령: `npm run test:pdf`. 기대: A 왕복 보존 통과, 상한 초과 주입 → 거절·worker 재시작.

### 10a. 저장 조정자 (UI 없음)
- `src/pdf/save.ts`: snapshot 직렬화, Web Locks 안에서 해시 재확인, 복구 사본 저장과 해시 확인, writable 쓰기, revision 반영. 복구 사본 저장소는 주입받는다(시험은 가짜).
- 명령: `npm run test:contracts`(신규 `tests/pdf-save.test.mjs`). 기대: DoD 4(트랜잭션) 표 전부.

### 10b. 다른 이름으로 저장
- 파일 메뉴의 다른 이름으로 저장. 새 파일에만 쓰므로 복구 사본이 필요 없다.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: 저장 왕복 후 주석 목록 같음, 거절 경우(보존 실패·C1·D)에 writable 생성 0회. DoD 1(편집 상태)에 PDF 저장 비교를 더함.

### 10c. 열린 파일에 저장
- 첫 화면 PDF 카드 문구에 "PDF로 저장"을 더한다.
- 실제 복구 사본 저장소(OPFS), 파일 메뉴의 저장·Ctrl+S, 거절 이유 표시.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 4(UI)의 Ctrl+S 왕복·외부 변경 거절·두 탭 동시 저장·복구 사본 실패 시 writable 0회.

### 10d. 원본 복원
- 파일 메뉴 "저장 전 원본 복원".
- 명령: `npm run test:pdf`. 기대: 복원 파일 해시 = 원본 해시, 사본이 없으면 메뉴 비활성.

### 10e. 이탈 확인
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 5.

### 11. 검증·문서·리뷰
- `npm run verify`, `npm run upstream:check -- --current`, `npm run build`, 진입 청크 크기 비교 기록
- 외부 뷰어 수동 확인(Acrobat Reader·미리보기·Chrome)
- README·`docs/project-decisions.md`·`CLAUDE.md` 갱신
- Codex 코드 리뷰 2회. 판정은 ledger에 기록하고, 수용한 것만 별도 커밋으로 고친다.
- push·배포는 사용자가 요청할 때만 한다. 배포한 뒤 `npm run test:live`를 돌린다.

## 위험

- **Svelte 5.57 업그레이드:** 셸의 `$effect`·`untrack` 동작이 바뀔 수 있다. 1단계를 따로 커밋한다.
- **0.x 라이브러리:** API가 바뀔 수 있다. 정확한 버전으로 고정하고, 올릴 때는 PDF 통합 시험으로 판정한다. 주간 upstream-watch에 npm 최신판 검사를 넣을지는 11단계에서 정한다.
- **보존 검사 거절률:** 허용 차이 밖의 변경이 있으면 거절하므로, export가 쓸데없이 객체를 바꾸는 라이브러리라면 실제 PDF에서 저장 거절이 잦을 수 있다. 9c에서 A·E·F와 실제 PDF 몇 개로 거절 사유를 기록하고, 거절이 잦으면 사용자에게 보고한다.
- **복구 사본 용량:** OPFS 저장 공간이 모자라면 덮어쓰기를 거절한다(다른 이름으로 저장은 된다).
- **pdfjs-dist 크기:** 대부분 소스맵·legacy 빌드라 실제로 배포하는 파일은 일부다. 3단계에서 재고, Pages 제한을 verify가 확인한다.
- **미리 받기 양:** PDF 엔진이 더해지면 첫 화면에서 받는 양이 늘어난다. 6b단계에서 재서 기록한다.
- **서비스 워커:** `pdfjs/`는 저장하지 않는다(4a-1, rhwp와 같은 처리). PDF 편집기 JS 청크(`assets/`)는 다른 청크처럼 저장된다.
- **안 쓰는 배포 파일(4a-1에서 발견):** 라이브러리가 Vite `?url`로 묶는 worker 사본 `assets/pdf.worker.min-*.mjs`(1.26MB, 우리는 `pdfjs/`의 것을 씀)와 KaTeX 글꼴 59개(1.1MB)가 산출물에 들어간다. 6a에서 엔진 목록을 만들 때 어느 쪽 worker를 쓸지 하나로 정하고, KaTeX 글꼴은 11단계에서 제외 방법을 찾는다.
- **청크 분리 변화(4a-1):** PDF 진입이 생기자 Svelte 런타임이 공용 청크(`disclose-version-*.js`, 41.7kB)로 갈라졌다. 첫 화면 gzip 합계 약 20.6kB → 21.4kB(4a-1) → 24.3kB(4a-2: PDF 컴포넌트가 쓰는 Svelte 런타임 기능이 공용 청크에 합쳐짐. 공용 청크 모듈은 `svelte`·`clsx`뿐이고 PDF 패키지 0건). 11단계에서 공용 청크를 나눌지 정한다.
- **CSS 층:** 라이브러리 스타일이 `@layer svelte-pdf-mini`에 있다. 셸 CSS와의 우선순위를 4a-2단계에서 확인한다.

## 진행

| 단계 | 상태 | 커밋 |
|---|---|---|
| 계획 | Codex 계획 리뷰 3차 반영 | (이 커밋) |
| 0a. 픽스처 | 완료: `--check` exit 0, 7개 xref 오프셋·스트림 길이 직접 검사 0건 오류, pdf.js 6.4.299로 열림(D는 비밀번호 필요) | (이 커밋) |
| 0b. 라이브러리 실행 확인 | 완료: `node scripts/pdf-probe/run.mjs` exit 0, 필수 항목 6개 통과 | (이 커밋) |
| 1. Svelte 업그레이드 | 완료: 5.55.9 → 5.57.1(5.57.2는 출시 7일이라 2주 넘은 5.57.1). `npm run verify` 단위 40/40·통합 PASS·회귀 14 PASS. 진입 청크(gzip) home 1.50→1.50kB, word·hwp 0.15→0.15kB, routes 19.10→19.38kB, EditorShell 8.56→8.47kB | (이 커밋) |
| 2a-1. 라이선스 수집기 정리 | 완료: 특성화 시험(파일 목록·바이트·순서) 추가 후 리팩터링, 실제 리포 `legal/` 전후 diff 0(`release.json`은 `generatedAt`만 다름), 변이(LICENSE.md 못 찾음) → 4건 실패 | (이 커밋) |
| 2a-2. 런타임 전이 의존성 전체 | 완료: 23개(lock 런타임 집합과 같음, svelte 5.57에서 1개 줄어 계획의 24가 아님). LICENSE 파일 없는 `is-reference@3.0.3`·`locate-character@3.0.0`은 정확한 버전 예외로 package.json 라이선스·저장소를 고지. verify 단위 44/44·통합 PASS·회귀 14 PASS, `dist/legal` 31개 | (이 커밋) |
| 2b. 의존성 추가 | 완료: `svelte-pdf-mini` 0.9.1(10/8 출시, 사용자 고정판)·`@cantoo/pdf-lib` 2.11.1(9/15). 런타임 패키지 42개(선택 의존성 제외, lock 집합과 같음). `dompurify` 3.4.17·`marked` 18.1.1은 출시 1일이지만 보안 관련 수정이라 그대로 둠. verify 단위 45/45·통합 PASS·회귀 14 PASS, `dist/legal` 50개 | (이 커밋) |
| 3. pdf.js 자산 | 완료: `pdfjs/6.4.299/` 202개 파일, 가장 큰 파일 `pdf.worker.min.mjs` 1,264,342바이트, 배포 파일 총 454개. `/pdfjs/*` immutable. verify 단위 47/47·통합 PASS·회귀 14 PASS, `upstream:check -- --current` 통과 | (이 커밋) |
| 4a-1. 독립 진입·자산 설정 | 완료: `pdf.html`·`src/pdf/setup.ts`·`PdfEditor`(빈 화면), `test:pdf`, verify 브라우저 목록 등록(일반·후보 로그 모두 `PASS pdf`), 러너 변이 → exit 1. SW는 `pdfjs/`를 저장하지 않음(시험·변이). verify 단위 48/48 | (이 커밋) |
| 4a-2. 열기·그리기 | 완료: `PDF 열기`(File System Access 핸들, 없으면 파일 입력), A 3쪽·1쪽 칠해짐, B cMap `200 /pdfjs/<ver>/cmaps/UniKS-UCS2-H.bcmap`·글자 칠해짐, cMap 404 변이 → 픽셀 0. `test:pdf` 3개 PASS | (이 커밋) |
| 4a-3. 확대·맞춤 | 완료: 확대/축소(배율 변화, `manual`), 쪽 너비(쪽 폭이 보기 폭의 85~100%), 쪽 전체(쪽 높이 ≤ 보기 높이·쪽 너비보다 좁음). 라이브러리가 aria-label을 자체 영어 메시지로 덮어써서 `src/pdf/messages.ts`(한국어)를 `Viewer.Root messages`로 넘김. 변이(쪽 전체 → page-height) → 실패. `test:pdf` 4개 PASS | (이 커밋) |
| 4a-4. 쪽 이동 | 완료: 다음 1→2→3(마지막에서 다음 비활성), 이전 3→2, 번호 입력 1. `test:pdf` 5개 PASS. 변이 시험은 안 함(단언이 라이브러리의 실제 쪽 상태를 직접 읽음) | (이 커밋) |
| 4b-1. 찾기 | 완료: "Résumé"·"resume" 결과 2 / 2로 같음, 다음 결과 → 2쪽. 입력란은 `type=search`(역할 searchbox). 변이(악센트 구분 `diacritics`) → 1 ≠ 2로 실패. `test:pdf` 6개 PASS | (이 커밋) |
| 4b-2·4b-3. 목차·썸네일 | 완료: 옆 패널(목차/썸네일 전환). 목차 항목 `Introduction`·`Chapter 2`, 2번째 → 2쪽. 썸네일 3개(이름 1·2·3), 그려짐, 3번째 → 3쪽. 같은 패널 코드라 한 커밋으로 묶음(계획은 따로). `test:pdf` 8개 PASS | (이 커밋) |
| 4c-1·4c-2. 선택·복사, 인쇄 | 완료: 텍스트 층 선택 + Ctrl/Cmd+C → 클립보드에 `Introduction text`. 인쇄는 라이브러리 `PdfDocument.print()`(원본 PDF를 숨긴 blob iframe에 띄워 브라우저 PDF 엔진으로 인쇄) → print 1회. 주석을 넣은 인쇄는 저장본 바이트를 넘겨야 하므로 8b·10b에서 다룸. `test:pdf` 10개 PASS | (이 커밋) |
| 4d. 암호 PDF 보기 | 완료: `Document.Password`에 한국어 입력 화면. 틀린 암호 → 다시 묻기(쪽 수 0 유지), `test` → 1쪽 칠해짐, 외부 요청 0. `test:pdf` 11개 PASS | (이 커밋) |
| 5a. PDF 엔진 타입·목록 없는 엔진 | 완료: `Engine`에 `pdf`, 진행 화면 라벨 "PDF", 목록에 없는 엔진 → `ManifestError`(진행 화면 없이 열림), 백그라운드는 없는 엔진을 건너뜀. 변이(일반 Error) → 실패. verify 단위 49/49·브라우저 25 PASS | (이 커밋) |
| 5b·5c. 경로·셸 마운트·헤더 | 완료: `EditorMode`에 `pdf`만 더하면 헤더 컴포넌트 타입 오류라 5b를 5c와 한 커밋으로 묶음. `/pdf`·`/pdf.html` → 셸 PDF 편집기(동적 청크 `PdfEditor-*.js` 126kB, 셸·첫 화면 청크 PDF 코드 0). 헤더 W·한·PDF(폭 116→150px). Word modern 툴바는 셸 헤더가 오른쪽 끝을 덮어 **기존에도** 인쇄·테마·언어 버튼이 가려졌음 → 툴바 오른쪽 150px 비움, 회귀에 겹침 단언 추가. 통합 시험의 "세 번째 버튼 = 정보" 가정을 "마지막 버튼"으로. verify 단위 49/49·통합 PASS·회귀 15·PDF 12 PASS. DoD 11: Vite 개발 서버 `/pdf`에서 B 열기 — worker·cMap 200, 칠해진 픽셀 9,084, 오류 0 | (이 커밋) |
| 5d. 첫 화면 카드 | 완료: PDF 카드(3열, 601~960px 2열, 600px 이하 1열), 같은 화면에서 열림·뒤로 가기 회귀. 1280·800·375px 가로 넘침 없음. 카드 문구의 "PDF로 저장"은 10단계 전까지 아직 없는 기능. verify 단위 49/49·통합 PASS·브라우저 28 PASS | (이 커밋) |
| 6a. 엔진 목록 | 완료: `scripts/pdf-manifest.mjs`가 Vite manifest에서 `PdfEditor` 청크 + 동적 import `pdfjs-dist/build/pdf.mjs`(문서를 열 때 필요) + 정적 import·CSS + `pdfjs/<ver>/pdf.worker.min.mjs`를 `pdf`로 추가: 6개, 1,909,875바이트. `.vite/`는 목록을 만든 뒤 지움(배포 제외). 회귀 "엔진 목록"에 PDF(같은 프레임이라 fetch 아닌 요청으로 판정). 변이(pdf.mjs 제외) → "pdf: large startup downloads missing". verify·`upstream:check -- --current` 단위 51/51·브라우저 28, 두 산출물 목록 6개 | (이 커밋) |
| 6b. 미리 받기 순서 | 완료: 순서에 `pdf`. 회귀(마지막에 PDF → PDF 파일이 첫 요청, PDF 연 뒤 worker 네트워크 전송 1회 이하). 첫 화면 미리 받기 필수 합계 18.46MB 중 PDF 1.91MB(엔진 미리 받기 문서에 표). verify 단위 51/51·브라우저 29. 변이는 안 돌림(`engineOrder`가 목록에 없는 마지막 엔진을 무시하는 경로라 단언이 바로 실패함) | (이 커밋) |
| 6c. 번들 경계 시험 | 완료: 빌드 플러그인이 `.vite/chunk-modules.json`(청크별 모듈 ID) 기록, `tests/bundle-boundary.mjs <outDir>`가 첫 화면·Word·한글·PDF 진입에서 `PdfEditor`를 넘지 않고 닿는 청크 6개에 PDF 패키지 모듈 0건 확인. verify가 PDF 목록 추가 뒤·`.vite/` 삭제 전에 실행. 변이 3개(셸이 `configurePdf`·pdfjs `version`·`PDFDocument.create`를 씀) → 각각 새어 들어온 모듈 이름으로 실패. verify 단위 51/51·브라우저 30, `dist/` 없이 `upstream:check -- --current` 통과 | (이 커밋) |
| 7a. 선택기 타입 공용화 | 완료: `PickerWindow`를 `src/fileAccess.ts`로, Word 엔진 복사 목록에 추가. Word 엔진 타입 검사 713파일 0 오류, verify 단위 51/51·통합(원본 보호·사본 저장·외부 변경) PASS·브라우저 30 | (이 커밋) |
| 7b. 해시·쓰기 공용화 | 완료: `fingerprint`·`writeIfUnchanged`(외부 변경 확인 → writable 쓰기, 실패 시 abort)를 `fileAccess.ts`로, `writeArtifact`는 내용 손실 확인 뒤 이것을 부름. Word 엔진 tsconfig가 `.ts` 확장자 import를 허용하지 않아 소스는 확장자 없이 두고, Node 단위 시험에 `tests/ts-resolve.mjs` resolve 훅(`--import`). 기존 저장 계약 시험은 import 줄만 바뀌고 그대로 통과, 새 `tests/file-access.test.mjs` 3개. verify 단위 54/54·통합 PASS·브라우저 30 | (이 커밋) |
| 0~7 코드 리뷰 | 완료: Codex 2회(기준 `d9e77ae`), 고유 지적 9건 모두 수용 — 연속 열기 경합·읽기 실패 시 상태 손상·파일 교체 뒤 배율 표시·준비 전 인쇄·좁은 창 도구막대·파일 입력 재선택·probe 폴더 덮어쓰기·probe 주석 비교 범위·인수인계 시험 수 오기(PDF 14 → 실제 12). 시험 5개 추가, 고친 4곳 변이 → 각 해당 시험에서 실패. probe 재실행(비교가 7곳 변경을 잡음). verify 단위 54/54·회귀 17·PDF 17 | (이 커밋) |
| 8a. 주석 상태·이력 | 완료: 라이브러리 `Annotations.Root`(PDF 안 주석 불러오기, foreign `readonly`, 실행 취소·다시 실행). dirty는 `src/pdf/annotationState.ts`가 저장 시점의 우리 주석과 내용으로 비교(실행 취소로 돌아오면 깨끗). 헤더 "저장하지 않음"을 PDF에도 연결. 단위 3개(계약 57/57), 브라우저: A의 기존 메모 표시·dirty 아님·실행 취소 비활성. `test:pdf` 18개 | (이 커밋) |
| 8b·8c. 그리기 도구·편집 상태 보존 | 완료: 주석 도구막대(선택·형광펜·밑줄·취소선·메모·펜·사각형, 색 노랑·초록·파랑·빨강), 메모 편집 팝오버·선택 메뉴. 브라우저: 6종을 그리고 색·메모 글 확인, 실행 취소 끝까지 → 원래 주석만·dirty 해제, 다시 실행 → 6종. C1·D에서도 그리기. Word·한글을 오가도 주석·dirty·이력 유지, Word 글 유지. 한 도구막대 코드라 도구별 커밋 대신 한 커밋. 이 단계에서 번들 경계 검사가 rolldown 런타임이 pdf-lib 청크에 들어가 셸이 pdf-lib를 정적 import하는 것을 잡음 → 런타임 별도 청크(`c0a5cd6`), pdf-lib를 PDF 엔진 필수로(2.60MB). verify 단위 57/57·PDF 21·회귀 17 | (이 커밋) |
| 9a. 보존 검사 모듈 | 완료: `src/pdf/preserve.ts`. `/Root`·`/Info`에서 닿는 객체 전체를 값으로 비교(참조는 짝지어 따라감, 스트림은 디코딩한 바이트). 허용 차이: 쪽 `/Annots`의 우리 주석과 팝업, 주석 모델 첨부 파일(`/Names/EmbeddedFiles`·`/AF`), `/Info`의 `ModDate`·`Producer`. 라이브러리가 저장 때 하는 같은 의미의 변경도 실측해 허용: 상속 속성을 쪽에 복사(실효값으로 비교, CropBox 기본 MediaBox·Rotate 기본 0), 내용을 `q`/`Q` 스트림으로 감쌈(바깥 한 쌍씩 벗겨 원본 스트림과 바이트 비교), 리소스에 빈 `/XObject`·`/ExtGState` 추가. 우리 주석 ID가 snapshot과 정확히 같아야 함. 단위 39개: A·E·F·C2 전체/증분 왕복 통과, 두 번째 저장 통과, 손상 13종 × 2방식 거절(이유 문구까지), 읽을 수 없는 출력·snapshot 불일치 거절. 검사기 변이 4종(내용·주석 수·문자열·비교 불가 객체) 각각 시험 실패. 미시험: 다른 첨부 파일이 있는 PDF(픽스처 없음) | (이 커밋) |
| 9b~9c. 판별·worker | 대기 | |
| 10a~10e. 저장·복원·이탈 확인 | 대기 | |
| 11. 검증·문서·리뷰 | 대기 | |
