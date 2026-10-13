# PDF 뷰어·주석 추가 (2026-10-13)

선행: `2026-10-13-engine-preload.md`(첫 화면 형식 선택·엔진 미리 받기·진행 화면). 2026-10-13 완료(`fa504a9`~`2ad35e2`).

개정 이력: 초안(`c27c593`, `8c1ce1a`) → Codex 계획 리뷰 2회(고유 지적 13건, 모두 수용) → 이 판.

## 사용자 결정 (2026-10-13)

- 범위: 보기 + 주석 + PDF로 저장. 주석은 표준 PDF 주석으로 저장해서 Acrobat·미리보기·Chrome에서도 보이게 한다.
- 화면: 세 번째 편집기. 공통 헤더에 W·한·PDF 버튼을 두고, `/pdf` 경로와 첫 화면 카드를 추가한다. 세 편집기의 상태는 전환해도 각각 유지한다.
- 코드: npm 패키지 `svelte-pdf-mini`를 정확한 버전으로 고정한다(0.9.1, MIT). 공개 API만 쓰고 패치하지 않는다. `source/` 클론·overlay 방식은 쓰지 않는다.
- 엔진 미리 받기: DOCX·HWPX·PDF 엔진 모두 첫 화면에서 백그라운드로 받는다(엔진 미리 받기 요청). 순서는 마지막에 쓴 편집기 → DOCX → HWPX → PDF.
- 참고: [xivly](https://github.com/julien-blanchon/xivly)(MIT, 같은 라이브러리로 만든 리더)의 주석 도구막대·저장 흐름·pdf.js 자산 설정. 코드를 그대로 가져오면 그 파일에 MIT 고지를 단다.

## 저장 정책

- **열린 파일에 저장(Ctrl+S):** PDF를 열 때의 파일 핸들과 기준 해시를 저장 대상으로 삼는다. 한글 편집기와 다르다. 한글은 형식 변환 손실 때문에 원본 덮어쓰기를 막지만, PDF는 원본 바이트에 주석만 더하고 아래 보존 검사를 통과할 때만 쓴다.
- **보존 검사:** 내보낸 PDF를 다시 읽어 원본과 비교한다. 하나라도 다르면 쓰지 않는다(한글의 `contentLoss` 원칙과 같다).
  - 쪽 수
  - 쪽마다 내용 스트림 해시
  - 우리가 만들지 않은 기존 주석(종류·위치·내용)
  - 양식 필드 이름·값
- **거절하는 문서:** 디지털 서명이 있는 PDF(주석을 더하면 서명이 무효가 될 수 있음)와 암호 PDF는 저장하지 않는다. 열어서 보기·주석 그리기는 된다. 이 경우 저장 메뉴가 이유를 보여 준다.
- **트랜잭션:** `docs/implementation-roadmap.md`의 저장 트랜잭션 6단계를 따른다.
  - 저장 요청은 문서 epoch와 주석 revision의 불변 snapshot으로 만들고, 한 번에 하나씩 직렬로 처리한다.
  - 성공한 snapshot의 revision만 저장 완료로 반영한다. 저장하는 동안 추가한 편집은 dirty로 남는다.
  - 늦게 도착한 worker 응답(문서가 바뀐 뒤)은 버린다.
  - 쓰기는 File System Access의 writable stream으로 한다. `close()`가 성공해야 파일이 바뀐다. 실패하면 원본 해시·저장 대상·dirty를 유지한다.

## 완료 조건 (DoD)

1. **진입:** `/`의 PDF 카드, 헤더의 PDF 버튼으로 PDF 편집기에 들어간다. `/pdf`·`/pdf.html` 직접 접속, 뒤로/앞으로 가기, 새로고침이 편집기를 바꾸지 않는다. 첫 화면에서 같은 화면으로 열린다(엔진 미리 받기의 규칙과 같음).
2. **보기:** 파일 메뉴에서 PDF를 열고 다음을 쓴다.
   - 확대·축소, 맞춤(쪽 너비·쪽 전체), 쪽 이동
   - 찾기(대소문자·악센트 무시), 목차, 썸네일
   - 텍스트 선택·복사, 인쇄
3. **주석:** 하이라이트·밑줄·취소선·메모·펜·사각형을 그린다. 실행 취소·다시 실행이 된다.
4. **저장:** 위 "저장 정책"대로 동작한다.
   - Ctrl+S는 열린 파일에, 다른 이름으로 저장은 새 파일에 쓴다. 저장한 파일을 다시 열면 주석 6종의 종류·좌표·색·내용이 그대로다.
   - 밖에서 바뀐 파일, 보존 검사 실패, 서명·암호 PDF는 거절한다. 거절할 때는 파일을 열지도 쓰지도 않는다.
5. **이탈 확인:** 저장 안 한 주석이 있으면 탭 닫기, 다른 PDF 열기, 첫 화면으로 뒤로 가기에서 확인을 받는다. 취소하면 문서와 파일 연결, dirty가 그대로다.
6. **문서가 밖으로 나가지 않음:**
   - PDF를 열고 보는 동안 외부 출처 요청 0건
   - pdf.js worker·cMap·표준 글꼴·wasm·ICC는 우리 배포판에서 받는다. 한국어 CID 글꼴 PDF는 우리 cMap 응답을 받아 canvas에 글자를 그린다.
   - 논문 기능의 온라인 인용 조회는 쓰지 않는다.
7. **기존 동작:** Word·한글 동작이 그대로다. 기존 단위·통합·회귀 시험이 모두 통과한다.
8. **번들 경계:**
   - 첫 화면·Word·한글 진입 청크의 정적 import 그래프에 PDF 코드(`svelte-pdf-mini`, `pdfjs-dist`)가 없다. 빌드 산출물 검사로 확인한다.
   - PDF 엔진 파일은 다른 엔진처럼 `engines/manifest.json`에 올라가고, 첫 화면에서 순서대로 미리 받는다.
   - 진입 청크 크기는 1단계 전에 기록한 값과 비교해 적는다.
9. **라이선스:** 정보 창과 `legal/`에 런타임 의존성 전부의 라이선스가 있다. 라이선스 파일이 없는 의존성이 있으면 `npm run verify`가 실패한다.
10. **배포 조건:** Cloudflare Pages 제한(파일당 25MiB, 20,000개) 안이다. 일반 `npm run verify`와 후보 검증(`npm run upstream:check -- --current`)이 통과한다. 배포한 뒤 `npm run test:live`가 통과한다.
11. **개발 서버:** `npm run dev`에서 `/pdf`로 한국어 PDF를 열고 worker가 돈다.

## DoD ↔ 시험

| DoD | 시험(파일) | 판정 |
|---|---|---|
| 1 | 회귀 `tests/regressions.mjs`: PDF 카드·헤더 전환·직접 URL·뒤로/앞으로·새로고침 | 각 단계에서 PDF 화면과 주소가 일치 |
| 2 | 통합 `tests/pdf.integration.mjs` | 픽스처 A: 쪽 수 3, 찾기 "Résumé"·"resume" 결과 수 같음, 목차 2번째 항목 → 2쪽, 썸네일 3개, 확대 후 scale 변화, 맞춤 두 종류의 쪽 너비 값, 선택 후 클립보드 문자열, `window.print` 호출 |
| 3 | 통합 | 6종을 각각 그린 뒤 저장 전 주석 목록(종류·좌표·색·내용), undo 6회 → 0개, redo 6회 → 6개 |
| 4 | 단위 `tests/pdf-save.test.mjs`(보존 검사·snapshot·직렬화), 통합(저장 왕복·거절) | 왕복 후 주석 목록이 저장 전과 같음. 거절 경우마다 writable 생성 0회, 원본 해시 같음 |
| 4(실패) | 단위·통합 | 권한 거절, `createWritable`·`write`·`close` 실패 주입 → 원본 해시·저장 대상·dirty·주석 이력 유지, busy 해제. 저장 중 편집 → dirty 유지. 연속 Ctrl+S → 쓰기 직렬. 문서 교체 뒤 늦은 응답 → 무시 |
| 5 | 통합 | 승인·취소 양쪽, 3가지 경로 |
| 6 | 통합 | Playwright 요청 로그에서 다른 출처 0건. 픽스처 B(한국어 CID)에서 같은 출처 cMap 응답 200, canvas 영역 비어 있지 않음. 변이: cMap 경로를 틀리게 하면 실패 |
| 7 | `npm run verify` 전체 | 기존 시험 실패 0 |
| 8 | 단위 `tests/bundle-boundary.test.mjs`(빌드 산출물의 import 그래프), 회귀(엔진 목록에 pdf) | PDF 모듈이 진입 그래프에 0건 |
| 9 | 단위 `tests/release-info.test.mjs` | LICENSE 없는 의존성 → 실패 |
| 10 | `npm run verify`, `npm run upstream:check -- --current` | 둘 다 통과, Pages 제한 검사 통과 |
| 11 | 수동(명령과 결과를 이 문서에 기록) | `/pdf`에서 픽스처 B 열기 성공 |
| 외부 뷰어 | 수동: Acrobat Reader·macOS 미리보기·Chrome에서 왕복 파일 열기 | 6종 주석이 보이는지 스크린샷으로 기록 |

픽스처(`tests/fixtures/pdf/`, 만드는 스크립트 `scripts/make-pdf-fixtures.mjs`도 커밋):
- A: 3쪽, 목차 2항목, 본문에 "Résumé"·"resume", 기존 주석 1개, 양식 필드 1개(값 있음)
- B: 한국어 CID 글꼴(Adobe-Korea1 cMap 필요)
- C: 서명 필드 포함
- D: 암호

## 범위 밖

- PDF 본문 편집(글자 고치기·쪽 추가/삭제·병합)
- Word·한글 문서를 PDF로 변환
- PDF 오프라인 사용(서비스 워커 캐시)
- 논문 전용 기능(인용 카드·참고문헌·그림 색인), 서재·태그 같은 xivly의 라이브러리 기능
- 서명·암호 PDF 저장
- 모바일 터치 주석 최적화, Safari

## 확인한 사실 (2026-10-13, 0단계에서 실행으로 다시 확인)

- `svelte-pdf-mini` 0.9.1(npm, MIT, 풀었을 때 1.0MB). 저장소 clone과 `npm view`로 확인했다.
  - 의존성: `pdfjs-dist` ^6.4.299(Apache-2.0, 풀었을 때 34.9MB), `@cantoo/pdf-lib`, `dompurify`, `katex`, `marked`, `perfect-freehand`, `runed`, `svelte-toolbelt`
  - peer: `svelte` ^5.57.0. 우리 셸은 5.55.9다. EdenText 엔진은 따로 빌드하므로 영향 범위는 우리 셸이다.
  - README: 기본값으로 cMap·글꼴·wasm·ICC를 jsDelivr에서 받는다. `configurePdf()`로 자체 경로를 준다. `vite dev`에는 `optimizeDeps.exclude: ['pdfjs-dist']`가 필요하다. `svelte-pdf-mini/pdf-codec`이 주석 읽기·쓰기를 하고 worker에서도 돈다.
- xivly 0.8.0(MIT, 커밋 `3cd2006`)
  - `src/lib/pdf.ts`: `configurePdf`로 cMap 등을 자체 경로로 준다.
  - `src/lib/export.ts`: `exportPdf`를 Web Worker에서 돌리고 120초 상한과 worker 재시작을 둔다.
- 우리 쪽
  - `src/routes.ts`의 `EditorMode`가 `'word' | 'hwp'`다.
  - `vite.config.ts` 입력이 `home`·`word`·`hwp`다.
  - `scripts/release-info.mjs`는 npm 라이선스 목록을 이름으로 하드코딩한다.
  - `scripts/build-engines.mjs`는 Word 엔진 안에 한글 컴포넌트 파일 5개를 이름으로 복사한다. 공용 모듈을 새로 만들면 이 목록도 바꿔야 한다.
  - `scripts/verify.mjs`는 단위 시험 파일을 이름으로 열거한다. 후보 검증은 `.cache/candidate-public`·`candidate-dist`를 쓰고, public 파일 몇 개만 복사한다.
  - `engines/manifest.json`은 셸 빌드 전에 `build-engines.mjs`가 만든다.

## 단계

공통: 단계마다 아래 명령을 돌려 기대값을 확인한 뒤 커밋한다. 새 시험 파일은 `package.json` 스크립트와 `scripts/verify.mjs` 실행 목록에 같은 커밋에서 등록한다.

### 0. 외부 사실 실행 확인 (커밋은 이 문서의 기록만)
- 임시 폴더에 `svelte-pdf-mini@0.9.1`을 설치한다. 다음을 이 문서에 기록한다.
  - `package.json` 무결성 값·`exports`·타입 선언
  - `pdfjs-dist` 실제 버전과 `cmaps/`·`standard_fonts/`·`wasm/`·`iccs/`·worker 파일 경로
- 작은 실행 시험
  - Chrome: `configurePdf`에 로컬 경로를 주고 픽스처 B를 렌더링한다. 외부 요청 0건이어야 한다.
  - Node 또는 worker: `pdf-codec`으로 주석 6종을 쓰고 다시 읽는다.
- **합격:** 위 세 가지가 모두 된다. 안 되면 여기서 멈추고 사용자에게 보고한다.

### 1. Svelte 업그레이드만
- 시작 전에 첫 화면·Word·한글 진입 청크 크기를 기록한다.
- `svelte`를 ≥5.57로 올린다.
- 명령: `npm run verify`. 기대: 단위·통합·회귀 실패 0(현재 단위 40·회귀 14).

### 2. 의존성과 라이선스
- `svelte-pdf-mini`를 정확한 버전으로 넣는다(이 단계에서는 import하지 않음).
- `release-info.mjs`는 `npm ls --omit=dev --all --json`으로 런타임 의존성 전체의 LICENSE를 모은다. 없으면 실패한다.
- 명령: `npm run test:contracts`(release-info 시험 추가), `npm run verify`.

### 3. pdf.js 자산 배치
- `build-engines.mjs`가 전달받은 `output`(일반 `public/`, 후보 `.cache/candidate-public/`)에 `pdfjs/<pdfjs 버전>/`으로 worker·cMap·글꼴·wasm·ICC를 복사한다. `.gitignore`에 `public/pdfjs/`를 더한다.
- dev 서버도 같은 경로를 쓴다(`npm run dev`가 `build-engines` 뒤에 시작함).
- 명령: `npm run verify`, `npm run upstream:check -- --current`. 기대: 두 산출물에 `pdfjs/<버전>/` 존재, Pages 제한 통과.

### 4. 독립 보기 컴포넌트
- `src/pdf/PdfEditor.svelte`(보기만)와 `src/pdf/setup.ts`(`configurePdf`, 이 모듈 안에서만 import)를 만든다.
- 시험용 진입 `pdf.html`이 셸 없이 `PdfEditor`를 띄운다. 이 단계에서는 셸에 연결하지 않는다.
- `vite.config.ts`: `optimizeDeps.exclude: ['pdfjs-dist']`, 입력에 `pdf` 추가.
- 픽스처 A·B와 만드는 스크립트를 추가한다.
- 명령: `npm run test:pdf`(신규 `tests/pdf.integration.mjs`), `npm run verify`. 기대: DoD 2·6 시험 통과, cMap 변이 실패 확인.
- 수동: `npm run dev` → `/pdf.html`에서 픽스처 B(DoD 11).

### 5. 셸 연결
- `EditorMode`에 `pdf`를 더한다. `modeFromPath`·`isHomePath` 시험에 PDF 경로를 추가한다.
- `EditorControls`에 PDF 버튼, `EditorShell`에 동적 import 마운트, 첫 화면 PDF 카드, `home.ts` 카드 가로채기 대상을 추가한다.
- `pdf.html`을 셸 진입으로 바꾼다.
- 명령: `npm run verify`. 기대: DoD 1 회귀 통과, 기존 회귀 14개 통과.

### 6. 엔진 목록·미리 받기
- 셸 빌드 뒤 단계가 Vite `build.manifest`에서 PDF 진입 청크와 정적 의존 청크, worker를 찾는다. 이것을 실제 출력 폴더(`dist/` 또는 `candidate-dist/`)의 `engines/manifest.json`에 `pdf`로 더한다.
- dev 서버에서는 목록에 `pdf`가 없으면 진행 화면 없이 연다(`ManifestError`와 같은 경로). `enginePreload`가 없는 엔진 항목을 오류 없이 다루는지 단위 시험을 추가한다.
- `engines.ts` 순서에 `pdf`를 더한다. 엔진 목록 회귀 시나리오에 PDF를 더하고, "편집기 자체 요청"은 진행 화면이 끝난 뒤의 요청으로 센다.
- 번들 경계 시험 `tests/bundle-boundary.test.mjs`(DoD 8)를 추가한다.
- 명령: `npm run verify`, `npm run upstream:check -- --current`. 기대: 두 산출물의 목록에 `pdf`, `outputHash`에 목록 포함, 경계 시험 통과.

### 7. 파일 선택·쓰기 공용화 (동작 보존 리팩터링)
- 7a: 파일 선택기 래퍼를 공용 모듈로 뺀다. 7b: 해시·쓰기를 공용 모듈로 뺀다. 각각 따로 커밋한다.
- 공용 모듈을 `build-engines.mjs`의 Word 엔진 복사 목록에 더한다.
- 명령(각 커밋): `npm run verify`. 기대: 루트·Word 엔진 타입 검사 통과, 한글 저장·취소·외부 변경·원본 보호 시험이 리팩터링 전과 같은 결과.

### 8. 주석(저장 없음)
- `Annotations` 도구막대(6종·색·실행 취소/다시 실행). 구성은 xivly `AnnotationToolbar`를 참고한다.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 3 통과.

### 9. 내보내기 worker와 보존 검사(아직 저장 UI 없음)
- `src/pdf/export.worker.ts`: snapshot을 받아 `exportPdf`를 실행하고, 결과를 다시 읽어 보존 검사를 한다. 상한 120초이고, 시간이 넘으면 worker를 다시 시작한다(xivly 방식).
- 픽스처 C·D를 추가한다. 기존 주석·양식이 있는 A로 왕복 보존을 확인한다.
- 명령: `npm run test:contracts`(신규 `tests/pdf-save.test.mjs`), `npm run verify`. 기대: A 보존 통과, C·D 거절, 보존 검사 변이(내용 스트림 비교 제거) 실패.

### 10. 저장 UI와 이탈 확인
- 파일 메뉴의 저장·다른 이름으로 저장·Ctrl+S, snapshot 직렬화, dirty, 이탈 확인 3경로를 붙인다.
- 실패 주입 시험(권한 거절·`createWritable`·`write`·`close` 실패), 저장 중 편집, 연속 저장, 늦은 응답.
- 명령: `npm run test:pdf`, `npm run verify`. 기대: DoD 4·5 통과.

### 11. 검증·문서·리뷰
- `npm run verify`, `npm run upstream:check -- --current`, 진입 청크 크기 비교 기록
- 외부 뷰어 수동 확인(Acrobat Reader·미리보기·Chrome)
- README·`docs/project-decisions.md`·`CLAUDE.md` 갱신
- Codex 코드 리뷰 2회. 판정은 ledger에 기록하고, 수용한 것만 별도 커밋으로 고친다.
- push·배포는 사용자가 요청할 때만 한다. 배포한 뒤 `npm run test:live`를 돌린다.

## 위험

- **Svelte 5.57 업그레이드:** 셸의 `$effect`·`untrack` 동작이 바뀔 수 있다. 1단계를 따로 커밋한다.
- **0.x 라이브러리:** API가 바뀔 수 있다. 정확한 버전으로 고정하고, 올릴 때는 PDF 통합 시험으로 판정한다. 주간 upstream-watch에 npm 최신판 검사를 넣을지는 11단계에서 정한다.
- **보존 검사의 범위:** 내용 스트림·기존 주석·양식 값만 비교한다. 그 밖의 객체(첨부 파일, 자바스크립트, 메타데이터)가 바뀌어도 잡지 못한다. 9단계에서 `exportPdf`가 원본 객체를 그대로 두는지(증분 저장인지 재작성인지) 확인한다. 재작성이라면 비교 대상을 넓히거나, 그런 객체가 있는 문서를 거절한다.
- **pdfjs-dist 크기:** 대부분 소스맵·legacy 빌드라 실제로 배포하는 파일은 일부다. 3단계에서 파일 수와 가장 큰 파일 크기를 재고, Pages 제한을 verify가 확인한다.
- **미리 받기 양:** PDF 엔진이 더해지면 첫 화면에서 받는 양이 늘어난다. 6단계에서 크기를 재서 엔진 미리 받기 문서에 기록한다.
- **CSS 층:** 라이브러리 스타일이 `@layer svelte-pdf-mini`에 있다. 셸 CSS와의 우선순위를 4단계에서 확인한다.

## 진행

| 단계 | 상태 | 커밋 |
|---|---|---|
| 계획 | Codex 리뷰 2회 반영 | (이 커밋) |
| 0. 외부 사실 실행 확인 | 대기 | |
| 1. Svelte 업그레이드 | 대기 | |
| 2. 의존성·라이선스 | 대기 | |
| 3. pdf.js 자산 | 대기 | |
| 4. 독립 보기 컴포넌트 | 대기 | |
| 5. 셸 연결 | 대기 | |
| 6. 엔진 목록·미리 받기 | 대기 | |
| 7. 공용화 리팩터링 | 대기 | |
| 8. 주석 | 대기 | |
| 9. 내보내기·보존 검사 | 대기 | |
| 10. 저장 UI·이탈 확인 | 대기 | |
| 11. 검증·문서·리뷰 | 대기 | |
