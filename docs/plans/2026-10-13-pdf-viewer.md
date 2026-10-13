# PDF 뷰어·주석 추가 (2026-10-13)

선행: `2026-10-13-engine-preload.md`(첫 화면 형식 선택·엔진 미리 받기·진행 화면). 2026-10-13 완료(`fa504a9`~`2ad35e2`).

개정 이력:
- 초안(`c27c593`, `8c1ce1a`)
- Codex 계획 리뷰 1차 2회(고유 지적 13건, 모두 수용) → `e353ae2`
- Codex 계획 리뷰 2차 2회(고유 지적 10건, 모두 수용. 1차와 겹치지 않는 새 지적: 여러 탭 저장, 복구 사본, 보존 검사 범위, 엔진 목록 시작점, 번들 시험 순서, 서명 픽스처) → 이 판

## 사용자 결정 (2026-10-13)

- 범위: 보기 + 주석 + PDF로 저장. 주석은 표준 PDF 주석으로 저장해서 Acrobat·미리보기·Chrome에서도 보이게 한다.
- 화면: 세 번째 편집기. 공통 헤더에 W·한·PDF 버튼을 두고, `/pdf` 경로와 첫 화면 카드를 추가한다. 세 편집기의 상태는 전환해도 각각 유지한다.
- 코드: npm 패키지 `svelte-pdf-mini`를 정확한 버전으로 고정한다(0.9.1, MIT). 공개 API만 쓰고 패치하지 않는다. `source/` 클론·overlay 방식은 쓰지 않는다.
- 엔진 미리 받기: DOCX·HWPX·PDF 엔진 모두 첫 화면에서 백그라운드로 받는다. 순서는 마지막에 쓴 편집기 → DOCX → HWPX → PDF.
- 참고: [xivly](https://github.com/julien-blanchon/xivly)(MIT, 같은 라이브러리로 만든 리더)의 주석 도구막대·저장 흐름·pdf.js 자산 설정. 코드를 그대로 가져오면 그 파일에 MIT 고지를 단다.

**사용자 확인 필요(계획 2차 리뷰에서 생김):** 아래 "복구 사본"과 "원본 복원" 메뉴. 확인 전에는 10c단계를 시작하지 않는다.

## 저장 정책

- **열린 파일에 저장(Ctrl+S):** PDF를 열 때의 파일 핸들과 기준 해시를 저장 대상으로 삼는다. 한글과 다르다. 한글은 형식 변환 손실 때문에 원본 덮어쓰기를 막는다. PDF는 원본에 주석만 더하고, 아래 보존 검사와 복구 사본을 통과할 때만 쓴다.
- **보존 방식:** 0단계 결과로 둘 중 하나를 정한다.
  - **A. 증분 저장(우선):** 원본 바이트는 그대로 두고 바뀐 객체를 뒤에 덧붙인다. 보존 검사는 두 가지다.
    1. 출력의 앞 `원본 길이` 바이트가 원본과 같다.
    2. 다시 읽었을 때 쪽마다 주석이 "기존 주석 + 우리가 만든 주석"과 같다.
  - **B. 재작성:** 원본 바이트가 남지 않는다. 내보낸 PDF를 다시 읽어 아래 객체를 원본과 비교하고, 하나라도 다르면 쓰지 않는다.
    - 쪽 수
    - 쪽마다 `MediaBox`·`CropBox`·`Rotate`
    - `Contents`와 `Resources`가 참조하는 객체 그래프의 해시(이미지·글꼴·XObject 포함, `/Annots` 제외)
    - 기존 주석의 사전과 appearance 스트림 해시
    - 문서 카탈로그 부가 객체(`AcroForm` 필드 값, `Names`, `Outlines`, `OpenAction`, `Metadata`)의 해시
    - 비교 코드가 모르는 객체 유형이 있으면 판정 불가로 보고 거절한다.
  - B로 가게 되면 9단계 전에 사용자에게 보고한다(저장을 거절하는 문서가 늘 수 있음).
- **복구 사본(사용자 확인 필요):**
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
| 1(상태) | 통합 `tests/pdf.integration.mjs` | Word·한글·PDF에 각각 문서를 열고 편집 → W→한→PDF→W 전환 → 세 편집기의 문서 이름·dirty·undo 가능 여부가 전환 전과 같음 |
| 2 | 통합 | 픽스처 A: 쪽 수 3, 찾기 "Résumé"·"resume" 결과 수 같음, 목차 2번째 항목 → 2쪽, 썸네일 3개, 확대 후 scale 변화, 맞춤 두 종류의 쪽 너비 값, 선택 후 클립보드 문자열, `window.print` 호출. 픽스처 D: 틀린 비밀번호 → 다시 묻기, 맞는 비밀번호 → 1쪽 렌더 |
| 3 | 통합 | A·C1·D에서 6종을 각각 그린 뒤 주석 목록(종류·좌표·색·내용), undo 6회 → 0개, redo 6회 → 6개 |
| 4(보존) | 단위 `tests/pdf-preserve.test.mjs` | A·E 왕복 보존 통과. 변이마다 거절: 이미지 XObject 제거(E), `Rotate` 변경, 기존 주석 appearance 변경, 양식 값 변경, 앞부분 1바이트 변경(방식 A) |
| 4(판별) | 단위 `tests/pdf-preserve.test.mjs` | C1·D 거절, C2 저장 가능 |
| 4(트랜잭션) | 단위 `tests/pdf-save.test.mjs`(가짜 파일 핸들) | snapshot·직렬화·늦은 응답 무시. 권한 거절, `createWritable`·`write`·`close` 실패 주입 → 원본 해시·저장 대상·dirty·주석 이력 유지, busy 해제. 복구 사본 실패 → writable 생성 0회. 잠금 안 해시 재확인 |
| 4(UI) | 통합 | 저장 왕복 후 주석 목록이 저장 전과 같음. 거절 경우마다 writable 생성 0회와 원본 해시 같음. 같은 파일을 연 두 페이지가 동시에 저장 → 한쪽 성공, 다른 쪽 "밖에서 바뀐 파일" 거절·dirty 유지. 원본 복원 결과 해시 = 원본 해시 |
| 5 | 통합 | 승인·취소 양쪽, 3가지 경로 |
| 6 | 통합 | Playwright 요청 로그에서 다른 출처 0건. 픽스처 B에서 같은 출처 cMap 응답 200, canvas 영역 비어 있지 않음. 변이: cMap 경로를 틀리게 하면 실패 |
| 7 | `npm run verify` 전체 | 기존 시험 실패 0 |
| 8 | 빌드 뒤 시험 `tests/bundle-boundary.mjs <outDir>`, 회귀(엔진 목록에 pdf) | PDF 모듈이 진입·셸 그래프에 0건. 목록의 `pdf` 파일이 실제 PDF 열기 요청과 같음 |
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

`node scripts/make-pdf-fixtures.mjs --check`는 다시 만든 바이트가 커밋된 파일과 같은지 비교한다(날짜·ID를 고정한다).

## 범위 밖

- PDF 본문 편집(글자 고치기·쪽 추가/삭제·병합)
- Word·한글 문서를 PDF로 변환
- PDF 오프라인 사용(서비스 워커 캐시)
- 논문 전용 기능(인용 카드·참고문헌·그림 색인), 서재·태그 같은 xivly의 라이브러리 기능
- 서명·암호 PDF 저장, 서명 검증
- 외부 프로그램과의 파일 잠금
- 모바일 터치 주석 최적화, Safari

## 사실과 미확인 전제

### 미확인 전제 (0단계 실행 전까지 사실로 쓰지 않는다)

저장소 clone과 `npm view`로 읽은 내용이다. 설치·실행으로는 아직 확인하지 않았다.

- `svelte-pdf-mini` 0.9.1(npm, MIT, 풀었을 때 1.0MB)
  - 의존성: `pdfjs-dist` ^6.4.299(Apache-2.0, 풀었을 때 34.9MB), `@cantoo/pdf-lib`, `dompurify`, `katex`, `marked`, `perfect-freehand`, `runed`, `svelte-toolbelt`
  - peer: `svelte` ^5.57.0. 우리 셸은 5.55.9다. EdenText 엔진은 따로 빌드하므로 영향 범위는 우리 셸이다.
  - README: 기본값으로 cMap·글꼴·wasm·ICC를 jsDelivr에서 받는다. `configurePdf()`로 자체 경로를 준다. `vite dev`에는 `optimizeDeps.exclude: ['pdfjs-dist']`가 필요하다. `svelte-pdf-mini/pdf-codec`이 주석 읽기·쓰기를 하고 worker에서도 돈다.
- xivly 0.8.0(MIT, 커밋 `3cd2006`)
  - `src/lib/pdf.ts`: `configurePdf`로 cMap 등을 자체 경로로 준다.
  - `src/lib/export.ts`: `exportPdf`를 Web Worker에서 돌리고 120초 상한과 worker 재시작을 둔다.

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

### 0a. 픽스처
- `scripts/make-pdf-fixtures.mjs`와 픽스처 A·B·C1·C2·D·E를 커밋한다.
- 명령: `node scripts/make-pdf-fixtures.mjs --check`. 기대: exit 0.
- 픽스처가 pdf.js로 열리는지는 0b의 0번 항목에서 확인한다(pdf.js는 0b에서 설치).

### 0b. 라이브러리 실행 확인 (커밋은 시험 스크립트와 기록)
- `scripts/pdf-probe/run.mjs --dir <임시폴더>`: 임시 폴더에 `svelte-pdf-mini@0.9.1`을 설치하고 아래를 차례로 확인해 JSON으로 출력한다. 시작한 서버·브라우저는 finally에서 닫는다.
  0. 픽스처 6개를 pdf.js로 연다(D는 비밀번호 `test`). 기대: 쪽 수 A=3, 나머지 1. 안 열리면 0a로 돌아가 고친다.
  1. 설치본의 무결성 값·`exports`·타입 선언, `pdfjs-dist` 실제 버전과 `cmaps/`·`standard_fonts/`·`wasm/`·`iccs/`·worker 경로
  2. 렌더링: 시험 페이지를 우리 Vite로 빌드해 Chrome(playwright-core)으로 연다. `configurePdf`에 같은 출처 경로를 주고 B를 그린다. 기대: 외부 출처 요청 0건, cMap 응답 200, canvas 비어 있지 않음.
  3. 주석 왕복: 같은 페이지의 Web Worker에서 `pdf-codec`으로 A에 6종 주석을 쓰고 다시 읽는다. 기대: 종류·좌표(±0.01)·색·내용이 같음.
  4. 증분 여부: 3의 출력 앞 `A 길이` 바이트가 A와 같은지. 기대값 없음(결과로 보존 방식 A/B를 정한다).
  5. 판별·보존 검사 API: `@cantoo/pdf-lib`로 C1의 `/V`, C2의 빈 필드, D의 암호 표시, E의 XObject 그래프를 읽는다. 기대: 넷 다 읽힘.
  6. 암호 보기: D를 비밀번호 `test`로 그린다. 기대: canvas 비어 있지 않음.
- 명령: `node scripts/pdf-probe/run.mjs --dir <scratch>`. 기대: exit 0, 항목 0·1·2·3·5·6이 통과.
- 결과는 `docs/validation/2026-10-13-pdf-probe.md`에 출력 JSON과 함께 적는다. "미확인 전제" 절을 실행 결과로 바꾼다.
- **합격:** 0·1·2·3·5·6 통과. 하나라도 안 되면 여기서 멈추고 사용자에게 보고한다. 4가 거짓이면 방식 B로 가며, 9단계 전에 사용자에게 보고한다.

### 1. Svelte 업그레이드만
- 시작 전에 첫 화면·Word·한글 진입 청크 크기를 기록한다.
- `svelte`를 ≥5.57로 올린다.
- 명령: `npm run verify`. 기대: 단위·통합·회귀 실패 0(현재 단위 40·회귀 14).

### 2a. 라이선스 수집기 (동작 보존)
- `release-info.mjs`가 하드코딩 목록 대신 `npm ls --omit=dev --all --json`으로 런타임 의존성 전체의 LICENSE를 모은다. 없으면 실패한다.
- 명령: `npm run test:contracts`. 기대: 지금 의존성으로 만든 `legal/` 목록이 바꾸기 전과 같음(시험으로 비교), LICENSE 없는 가짜 의존성 → 실패.

### 2b. 의존성 추가
- `svelte-pdf-mini`와 `@cantoo/pdf-lib`(보존 검사용, 0b에서 확인한 버전)를 정확한 버전으로 넣는다. 이 단계에서는 import하지 않는다.
- 명령: `npm run verify`. 기대: 통과, `legal/`에 새 런타임 의존성 전부.

### 3. pdf.js 자산 배치
- `build-engines.mjs`가 전달받은 `output`(일반 `public/`, 후보 `.cache/candidate-public/`)에 `pdfjs/<pdfjs 버전>/`으로 worker·cMap·글꼴·wasm·ICC를 복사한다. `.gitignore`에 `public/pdfjs/`를 더한다.
- dev 서버도 같은 경로를 쓴다(`npm run dev`가 `build-engines` 뒤에 시작함).
- 명령: `npm run verify`, `npm run upstream:check -- --current`. 기대: 두 산출물에 `pdfjs/<버전>/` 존재, Pages 제한 통과. 파일 수와 가장 큰 파일 크기를 이 문서에 적는다.

### 4a. 독립 보기: 열기·그리기·확대·쪽 이동
- `src/pdf/PdfEditor.svelte`와 `src/pdf/setup.ts`(`configurePdf`, 이 모듈 안에서만 import)를 만든다.
- 시험용 진입 `pdf.html`이 셸 없이 `PdfEditor`를 띄운다. `vite.config.ts`에 `optimizeDeps.exclude: ['pdfjs-dist']`와 입력 `pdf`를 더한다. `verify.mjs`의 `productHash` 목록에 `pdf.html`을 더한다.
- 명령: `npm run test:pdf`(신규 `tests/pdf.integration.mjs`), `npm run verify`. 기대: DoD 2의 확대·맞춤·쪽 이동, DoD 6 통과, cMap 변이 실패.

### 4b. 찾기·목차·썸네일
- 명령: `npm run test:pdf`. 기대: DoD 2의 찾기·목차·썸네일 항목.

### 4c. 선택·복사·인쇄
- 명령: `npm run test:pdf`. 기대: 클립보드 문자열, `window.print` 호출.

### 4d. 암호 PDF 보기
- 비밀번호 입력 창. 틀리면 다시 묻는다.
- 명령: `npm run test:pdf`. 기대: DoD 2의 픽스처 D 항목.

### 5. 셸 연결
- `EditorMode`에 `pdf`를 더한다. `modeFromPath`·`isHomePath` 시험에 PDF 경로를 추가한다.
- `EditorControls`에 PDF 버튼, `EditorShell`에 동적 import 마운트, 첫 화면 PDF 카드, `home.ts` 카드 가로채기 대상을 추가한다.
- `EditorShell`의 `states()`·`blocked`·이탈 판단에 PDF 상태를 더한다.
- `pdf.html`을 셸 진입으로 바꾼다.
- 명령: `npm run verify`. 기대: DoD 1 회귀, DoD 1(상태) 통합, 기존 회귀 14개 통과.
- 수동: `npm run dev` → `/pdf`에서 픽스처 B 열기, worker 요청 200(DoD 11). 결과를 이 문서에 적는다.

### 6a. PDF 엔진 목록
- `vite.config.ts`에 `build.manifest: true`를 켠다.
- 셸 빌드 뒤 단계(`scripts/pdf-manifest.mjs`)가 Vite manifest에서 `src/pdf/PdfEditor.svelte`의 동적 청크를 시작점으로 정적 의존 JS·CSS를 모은다. 여기에 3단계의 worker 파일을 더해, 실제 출력 폴더의 `engines/manifest.json`에 `pdf`로 넣는다.
- 이 단계를 `verify.mjs`(일반·후보)와 `npm run build` 모두에서 부른다. `outputHash`보다 먼저 돈다.
- 단위 시험: 가짜 Vite manifest로 시작점·의존 수집·누락 파일 실패.
- 명령: `npm run verify`, `npm run upstream:check -- --current`, `npm run build`. 기대: 세 산출물의 목록에 `pdf`. 회귀: PDF를 처음 열 때 진행 화면이 끝난 뒤 목록 밖 100KB 넘는 요청 0건.

### 6b. 미리 받기 순서
- `engines.ts` 순서에 `pdf`를 더한다.
- dev 서버처럼 목록에 `pdf`가 없으면 진행 화면 없이 연다(`ManifestError`와 같은 경로). `enginePreload`의 단위 시험에 "없는 엔진 항목"을 더한다.
- 명령: `npm run verify`. 기대: 회귀 "첫 화면 미리 받기 순서"에 PDF 포함, 단위 통과. 첫 화면에서 받는 총량을 엔진 미리 받기 문서에 적는다.

### 6c. 번들 경계 시험
- `tests/bundle-boundary.mjs <outDir>`: Vite manifest로 첫 화면·Word·한글 진입과 셸 청크의 정적 import 그래프를 따라가 PDF 모듈이 0건인지 본다.
- `verify.mjs`가 셸 빌드와 6a 뒤에 실제 `outDir`(일반 `dist/`, 후보 `candidate-dist/`)로 부른다.
- 명령: `npm run verify`, `rm -rf dist && npm run upstream:check -- --current`. 기대: 둘 다 통과. 변이(셸이 `svelte-pdf-mini`를 정적 import) → 실패.

### 7. 파일 선택·쓰기 공용화 (동작 보존 리팩터링)
- 7a: 파일 선택기 래퍼를 공용 모듈로 뺀다. 7b: 해시·쓰기를 공용 모듈로 뺀다. 각각 따로 커밋한다.
- 공용 모듈을 `build-engines.mjs`의 Word 엔진 복사 목록에 더한다.
- 명령(각 커밋): `npm run verify`. 기대: 루트·Word 엔진 타입 검사 통과, 한글 저장·취소·외부 변경·원본 보호 시험이 리팩터링 전과 같은 결과.

### 8. 주석(저장 없음)
- `Annotations` 도구막대(6종·색·실행 취소/다시 실행). 구성은 xivly `AnnotationToolbar`를 참고한다.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 3 통과.

### 9a. 보존 검사 모듈
- `src/pdf/preserve.ts`: 원본과 출력 바이트를 받아 0b에서 정한 방식(A 또는 B)으로 판정한다.
- 명령: `npm run test:contracts`(신규 `tests/pdf-preserve.test.mjs`). 기대: DoD 4(보존) 표의 통과·거절 경우 전부.

### 9b. 서명·암호 판별
- 명령: `npm run test:contracts`. 기대: C1·D 거절, C2 저장 가능, 판별 변이(`/V` 검사 제거) → 실패.

### 9c. 내보내기 worker
- `src/pdf/export.worker.ts`: snapshot을 받아 `exportPdf`를 실행하고 9a 검사 결과를 함께 돌려준다. 상한 120초이고, 시간이 넘으면 worker를 다시 시작한다.
- 명령: `npm run test:pdf`. 기대: A 왕복 보존 통과, 상한 초과 주입 → 거절·worker 재시작.

### 10a. 저장 조정자 (UI 없음)
- `src/pdf/save.ts`: snapshot 직렬화, Web Locks 안에서 해시 재확인, 복구 사본 저장과 해시 확인, writable 쓰기, revision 반영.
- 명령: `npm run test:contracts`(신규 `tests/pdf-save.test.mjs`). 기대: DoD 4(트랜잭션) 표 전부.

### 10b. 저장 UI
- 파일 메뉴의 저장·다른 이름으로 저장·Ctrl+S, 거절 이유 표시.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 4(UI)의 왕복·거절·두 탭 동시 저장.

### 10c. 원본 복원 (사용자 확인 뒤)
- 파일 메뉴 "저장 전 원본 복원".
- 명령: `npm run test:pdf`. 기대: 복원 파일 해시 = 원본 해시, 사본이 없으면 메뉴 비활성.

### 10d. 이탈 확인
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
- **보존 방식 B:** 비교 코드가 모르는 객체가 있으면 거절하므로, 실제 PDF에서 저장 거절이 잦을 수 있다. 0b 결과로 B가 되면 사용자에게 보고한다.
- **복구 사본 용량:** OPFS 저장 공간이 모자라면 덮어쓰기를 거절한다(다른 이름으로 저장은 된다).
- **pdfjs-dist 크기:** 대부분 소스맵·legacy 빌드라 실제로 배포하는 파일은 일부다. 3단계에서 재고, Pages 제한을 verify가 확인한다.
- **미리 받기 양:** PDF 엔진이 더해지면 첫 화면에서 받는 양이 늘어난다. 6b단계에서 재서 기록한다.
- **CSS 층:** 라이브러리 스타일이 `@layer svelte-pdf-mini`에 있다. 셸 CSS와의 우선순위를 4a단계에서 확인한다.

## 진행

| 단계 | 상태 | 커밋 |
|---|---|---|
| 계획 | Codex 계획 리뷰 2차 반영 | (이 커밋) |
| 0a. 픽스처 | 대기 | |
| 0b. 라이브러리 실행 확인 | 대기 | |
| 1. Svelte 업그레이드 | 대기 | |
| 2a. 라이선스 수집기 | 대기 | |
| 2b. 의존성 추가 | 대기 | |
| 3. pdf.js 자산 | 대기 | |
| 4a~4d. 독립 보기 | 대기 | |
| 5. 셸 연결 | 대기 | |
| 6a. 엔진 목록 | 대기 | |
| 6b. 미리 받기 순서 | 대기 | |
| 6c. 번들 경계 시험 | 대기 | |
| 7a·7b. 공용화 리팩터링 | 대기 | |
| 8. 주석 | 대기 | |
| 9a~9c. 보존 검사·판별·worker | 대기 | |
| 10a~10d. 저장·복원·이탈 확인 | 대기 | |
| 11. 검증·문서·리뷰 | 대기 | |
