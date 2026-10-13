# PDF 뷰어·주석 추가 (2026-10-13)

선행: `2026-10-13-engine-preload.md`(첫 화면 형식 선택·엔진 미리 받기·진행 화면)를 먼저 끝낸다.

## 사용자 결정 (2026-10-13)

- 범위: 보기 + 주석 + PDF로 저장. 주석은 표준 PDF 주석으로 저장해서 Acrobat·미리보기·Chrome에서도 보이게 한다.
- 화면: 세 번째 편집기. 공통 헤더에 W·한·PDF 버튼을 두고, `/pdf` 경로와 첫 화면 카드를 추가한다. 세 편집기의 상태는 전환해도 각각 유지한다.
- 코드: npm 패키지 `svelte-pdf-mini`를 정확한 버전으로 고정한다(0.9.1, MIT). 공개 API만 쓰고 패치하지 않는다. `source/` 클론·overlay 방식은 쓰지 않는다.
- 참고: [xivly](https://github.com/julien-blanchon/xivly)(MIT, 같은 라이브러리로 만든 리더)의 주석 도구막대·저장 흐름·pdf.js 자산 설정. 코드를 그대로 가져오면 그 파일에 MIT 고지를 단다.

## 완료 조건 (DoD)

1. `/`에서 PDF 카드, 헤더에서 PDF 버튼으로 PDF 편집기에 들어간다. `/pdf`, `/pdf.html` 모두 열리고, 뒤로 가기·새로고침이 편집기를 바꾸지 않는다.
2. 파일 메뉴에서 PDF를 열고, 다음을 쓸 수 있다.
   - 확대·축소, 맞춤(쪽 너비·쪽 전체), 쪽 이동
   - 찾기(대소문자·악센트 무시), 목차(Outline), 썸네일
   - 텍스트 선택·복사, 인쇄
3. 주석: 하이라이트, 밑줄, 취소선, 메모(노트), 펜(잉크), 사각형. 실행 취소·다시 실행이 된다.
4. 저장
   - 다른 이름으로 저장: 새 파일에 원본 + 주석을 표준 PDF 주석으로 쓴다.
   - 저장(Ctrl+S): 같은 파일에 덮어쓴다. 연 뒤 파일이 밖에서 바뀌었으면 멈추고 알린다. 쓰기에 실패하면 원본은 그대로다(한글 편집기의 쓰기 계약과 같다).
   - 저장한 파일을 다시 열면 주석이 그대로 다시 읽힌다.
5. 저장하지 않은 주석이 있으면 탭을 닫거나 다른 파일을 열 때 확인을 받는다.
6. 문서는 브라우저 밖으로 나가지 않는다.
   - PDF를 여는 동안 외부 요청 0건(jsDelivr 포함)
   - pdf.js worker·cMap·표준 글꼴·wasm·ICC는 우리 배포판에서 제공한다. 한국어 CID 글꼴 PDF가 이 cMap으로 글자를 그린다.
   - 논문 기능의 온라인 인용 조회(OpenAlex·Semantic Scholar·Crossref)는 쓰지 않는다.
7. Word·한글 기존 동작이 그대로다. 기존 통합·회귀 시험이 모두 통과한다.
8. PDF 코드는 PDF 편집기를 처음 열 때만 내려받는다. 첫 화면·Word·한글 진입 번들 크기가 늘지 않는다(빌드 전후 수치를 기록한다).
9. 정보 창과 `legal/`에 새 런타임 의존성 전부의 라이선스가 들어간다. 빠진 의존성이 있으면 `npm run verify`가 실패한다.
10. Cloudflare Pages 제한(파일당 25MiB, 20,000개) 안이다. `npm run verify`와 실제 주소 `npm run test:live`가 통과한다.

## 범위 밖

- PDF 본문 편집(글자 고치기·쪽 추가/삭제·병합)
- Word·한글 문서를 PDF로 변환
- PDF 오프라인 사용(서비스 워커 캐시). 지금은 Word만 오프라인을 지원한다. 필요하면 다음 단계로 한다.
- 논문 전용 기능(인용 카드·참고문헌·그림 색인), 서재·태그 같은 xivly의 라이브러리 기능
- 암호 걸린 PDF 저장. 열기는 라이브러리의 `Document.Password`로 지원하되 저장은 거절한다.
- 모바일 터치 주석 최적화, Safari

## 확인한 사실 (2026-10-13)

- `svelte-pdf-mini` 0.9.1(npm, MIT, 풀었을 때 1.0MB)
  - 의존성: `pdfjs-dist` ^6.4.299(Apache-2.0, 풀었을 때 34.9MB), `@cantoo/pdf-lib`, `dompurify`, `katex`, `marked`, `perfect-freehand`, `runed`, `svelte-toolbelt`
  - peer: `svelte` ^5.57.0. 우리 셸은 `svelte` 5.55.9라 올려야 한다. EdenText 엔진은 따로 빌드하므로 영향 범위는 우리 셸이다.
  - 기본값으로 cMap·글꼴·wasm·ICC를 jsDelivr에서 받는다. `configurePdf()`로 자체 경로를 줘야 한다.
  - `vite dev`에는 `optimizeDeps.exclude: ['pdfjs-dist']`가 필요하다.
  - 주석 왕복은 `svelte-pdf-mini/pdf-codec`(`exportPdf`, 읽기)로 한다. worker에서도 돈다.
- xivly 0.8.0(MIT)
  - `src/lib/pdf.ts`가 `configurePdf`로 cMap 등을 자체 경로로 준다.
  - `src/lib/export.ts`는 `exportPdf`를 Web Worker에서 돌리고 120초 상한과 worker 재시작을 둔다.
- 우리 쪽에서 바꿀 곳
  - `src/routes.ts`의 `modeFromPath`가 `'word' | 'hwp'` 두 값이다.
  - `vite.config.ts` 입력이 `home`·`word`·`hwp` 셋이다.
  - `scripts/release-info.mjs`는 npm 라이선스 목록을 이름으로 하드코딩한다(`canvaskit-wasm`·`@noble/hashes`·`fflate`·`svelte`).

## 단계

단계마다: 실행해서 확인 → 커밋 → 다음 단계.

### 1. 의존성과 자산
- `svelte`를 ≥5.57로 올린다. 이것만 먼저 커밋하고 `npm run verify` 전체를 돌려 기존 동작이 그대로인지 본다.
- `svelte-pdf-mini`를 정확한 버전으로 넣는다.
- 빌드할 때 `node_modules/pdfjs-dist`에서 worker·`cmaps/`·`standard_fonts/`·`wasm/`·`iccs/`를 `public/pdfjs/`(생성물, gitignore)로 복사한다.
- `_headers`에서 `/pdfjs/*`를 immutable로 캐시하지 않는다. 파일 이름에 해시가 없기 때문이다. 대신 경로에 pdfjs 버전을 넣는다(`/pdfjs/<version>/`).
- `release-info`: 하드코딩 목록 대신 `npm ls --omit=dev --all --json`에서 런타임 의존성 전체의 LICENSE를 모은다. 라이선스 파일이 없는 패키지가 있으면 실패한다. pdfjs의 Apache-2.0 고지를 포함한다.
- 시험: release-info 단위 시험에 "의존성 하나의 LICENSE가 없으면 실패"를 추가한다.

### 2. 경로·셸 통합
- `EditorMode`에 `'pdf'`를 더한다. `modeFromPath` 시험에 `/pdf`, `/pdf.html`, `/x/pdf`를 추가한다.
- `pdf.html` 진입점을 만들고 vite 입력에 넣는다. 첫 화면에 PDF 카드, `EditorControls`에 PDF 버튼을 둔다.
- `EditorShell`이 PDF 편집기를 `pdfLoaded`일 때만 동적 `import()`로 마운트한다. 이렇게 해서 DoD 8을 지킨다.
- 엔진 미리 받기(`2026-10-13-engine-preload.md`)에 PDF를 붙인다: `engines.json`에 PDF 진입 청크·pdf.js worker를 넣는다. 첫 화면에 PDF 카드를 넣고, 같은 진행 화면을 쓴다. cMap·글꼴은 문서가 요구할 때만 받으므로 목록에 넣지 않는다.
- 시험(회귀): `/pdf` 확장자 없는 URL, 뒤로 가기, W→PDF→한 전환 뒤 각 상태 유지.

### 3. PDF 편집기 (보기)
- `src/PdfEditor.svelte`: `Document.Root` + `Viewer` + `Zoom`·`PageNav`·`Find`·`Outline`·`Thumbnails`. 주석은 아직 넣지 않는다.
- `src/pdf.ts`: `configurePdf()`로 자체 자산 경로를 지정한다. 셸이 시작할 때 한 번 부른다.
- 파일 열기는 File System Access API를 쓴다. 한글 편집기의 `PickerWindow` 흐름을 공용 모듈로 빼서 함께 쓴다(먼저 동작 보존 리팩터링 커밋, 그다음 기능 커밋).
- 시험(통합)
  - 시험용 PDF 두 개를 `tests/fixtures/`에 만든다. 여러 쪽 + 목차가 있는 것 하나, 한국어 CID 글꼴을 쓰는 것 하나. 만드는 스크립트도 커밋한다.
  - 열기 → 쪽 수 → 찾기 결과 수 → 목차 이동
  - 한국어 PDF의 텍스트 레이어에서 기대한 문자열을 확인한다.
  - 페이지가 외부로 보낸 요청이 0건인지 확인한다(Playwright request 로그).

### 4. 주석과 저장
- `Annotations.Root` + 도구막대(하이라이트·밑줄·취소선·메모·펜·사각형, 색, 실행 취소/다시 실행). 구성은 xivly `AnnotationToolbar`를 참고한다.
- 저장은 `exportPdf`를 Web Worker에서 돌린다(xivly `export.ts` 방식, 상한·재시작 포함). 쓰기는 한글 쪽 쓰기 계약을 공용화해서 쓴다: 연 뒤 외부 변경 감지, 쓰기 실패 시 원본 유지.
- 저장 안 한 상태(dirty)를 셸 이탈 확인에 연결한다.
- 시험(통합)
  - 주석 3종 추가 → 저장 → 저장 파일을 pdf-lib로 열어 `/Annots` 개수·종류 확인 → 다시 열었을 때 주석 3개
  - 저장 취소 시 원본 바이트가 그대로인지 해시로 확인
  - 밖에서 파일을 바꾼 뒤 Ctrl+S → 거절
  - worker가 실패해도 편집 내용 유지
  - 암호 PDF 저장 거절

### 5. 검증·문서·리뷰
- `npm run verify` 전체. 첫 화면·Word·한글 진입 JS 크기를 1단계 전과 비교해서 기록한다.
- README(구성표·경로·시험 목록), `docs/project-decisions.md`, `CLAUDE.md`를 갱신한다.
- 코드 리뷰: Codex `codex-review.sh --kind code` 2회. 지적은 판정해서 ledger에 남기고, 수용한 것만 별도 커밋으로 고친다.
- push와 배포는 사용자가 요청할 때만 한다. 배포한 뒤 `npm run test:live`를 돌린다.

## 위험

- **Svelte 5.57 업그레이드:** 우리 셸의 `$effect`·`untrack` 동작이 바뀔 수 있다. 1단계에서 따로 커밋하고 전체 verify로 확인한다.
- **pdfjs-dist 34.9MB:** 대부분 소스맵·legacy 빌드라 실제로 배포하는 파일은 일부다. cMap 약 170개·표준 글꼴 파일 수와 가장 큰 파일 크기를 1단계에서 재고, Pages 제한을 verify가 확인한다.
- **한국 첫 방문 속도:** worker·cMap 크기를 더해도 rhwp WASM(br 4.2MB)보다 작을 것으로 본다. 아직 재지 않았다.
- **0.x 라이브러리:** API가 바뀔 수 있다. 정확한 버전으로 고정하고, 올릴 때는 PDF 통합 시험으로 판정한다. 주간 upstream-watch에 npm 최신판 검사를 넣을지는 5단계에서 정한다.
- **주석 왕복 손실:** 라이브러리가 모르는 기존 주석(양식 필드·서명)을 저장 때 어떻게 다루는지 아직 모른다. 3단계에서 양식이 든 PDF로 확인하고, 손실이 생기면 저장을 거절하는 쪽으로 간다(한글 편집기의 `contentLoss` 원칙).
- **CSS 층:** 라이브러리 스타일이 `@layer svelte-pdf-mini`에 있다. 우리 `editorHeader.css`와의 우선순위를 확인한다.

## 진행

| 단계 | 상태 | 커밋 |
|---|---|---|
| 계획 | 작성 | |
| 1. 의존성·자산 | 대기 | |
| 2. 경로·셸 | 대기 | |
| 3. 보기 | 대기 | |
| 4. 주석·저장 | 대기 | |
| 5. 검증·문서·리뷰 | 대기 | |
