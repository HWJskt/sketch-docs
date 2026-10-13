# PDF 뷰어·주석 검증 (2026-10-14)

계획 `docs/plans/2026-10-13-pdf-viewer.md` 11단계 기록이다. 단계별 결과는 계획의 "진행" 표에 있다.

## 자동 검사

| 명령 | 결과 |
|---|---|
| `npm run verify` | exit 0. 단위 118, 루트 통합 1, 회귀 17, PDF 브라우저 29, 번들 경계 1 |
| `npm run upstream:check -- --current` | exit 0. 같은 항목이 `candidate-dist/`에서 통과 |

## 크기 (`dist/`, 이번 빌드)

| 항목 | 1단계 전 | 지금 |
|---|---|---|
| 첫 화면이 받는 JS (gzip) | 20.6kB | 24.9kB |
| Word·한글 진입 JS (gzip) | 27.8kB | 33.3kB |
| PDF 진입 JS (gzip, 셸까지) | — | 33.3kB |
| PDF 엔진 필수 파일(`engines/manifest.json`) | — | 2,642,265바이트 |
| 배포 파일 | — | 527개, 약 160MB |

늘어난 부분은 PDF 진입이 생기면서 공용 청크로 갈라진 Svelte 런타임과 rolldown 런타임이다. 첫 화면·Word·한글 쪽 청크에 PDF 라이브러리 모듈은 없다(`tests/bundle-boundary.mjs`).

## 외부 뷰어

- **macOS Quick Look**(미리보기와 같은 PDFKit): 시험용 PDF A에 주석 6종을 써서 `qlmanage -t`로 그렸다. 형광펜(노랑)·밑줄(파랑)·취소선(빨강)·메모 아이콘·펜(초록)·사각형(보라)과 기존 양식 값이 보였다. 원래 있던 메모 주석은 appearance가 없어 그려지지 않았다(원본 그대로). 그림: [quicklook-annotations.png](pdf-viewer/quicklook-annotations.png)
- **확인하지 못함:** Acrobat Reader(이 기기에 없음), Chrome 내장 PDF 뷰어(헤드리스에서 쓸 수 없음). 사람이 저장한 파일을 열어 확인해야 한다.

## 자동 시험 범위 밖

- 실제 OS 파일 선택기와 권한 창(시험은 OPFS 핸들로 선택기를 대신함), Safari·모바일, 실제 프린터
- 큰 PDF(수십 MB)에서 보존 검사·내보내기 시간
- 다른 첨부 파일이 있는 PDF의 보존 검사(시험용 PDF가 없음)

## 알려진 남은 일

- (정리함, 2026-10-14) pdf.js worker가 두 벌(라이브러리의 Vite `?url` 사본과 우리 `pdfjs/` 사본, 각 1.26MB) 있었다. 라이브러리 사본은 라이브러리를 고치지 않고는 뺄 수 없어 우리 사본을 뺐다(`configurePdf`의 `workerSrc` 제거). 배포 파일 527 → 526개. 앞의 "`.js`도 1.26MB"는 잘못 쟀다 — 90바이트짜리 주소 모듈이다.
- KaTeX 글꼴 59개(1.1MB)는 쓰지 않는 파일이 아니었다: 메모에 `$…$` 수식을 쓰면 라이브러리가 KaTeX와 글꼴을 불러온다(`svelte-pdf-mini/dist/internal/markdown.js`). 그대로 둔다.
- (정함, 2026-10-14) 주간 upstream-watch의 `npm` job이 `svelte-pdf-mini` npm 최신판과 고정판을 비교하고 lockfile로 `npm audit --omit=dev`를 돌린다(설치·패키지 코드 실행 없음). 하나라도 걸리면 쓰기 권한만 가진 별도 job이 이슈 "npm check needs attention"을 열거나 댓글을 단다. 새 판 시험은 사람이 한다.
- (해결) wrangler 4.142의 npm audit 권고: 배포 전에 4.149.0으로 올렸다(`npm audit` 0건).

## 배포 (2026-10-14)

- `a345d0c`를 `npm run verify`(단위 137, 브라우저 50) → push → `npm run mirrors:check` → `npm run deploy`(wrangler 4.149.0, 526개 중 350개 업로드)로 배포했다.
- `npm run test:live`(https://docs.sketchps.app): 15개 통과, 2개는 서버 제어가 필요해 건너뜀(서비스 워커 설치 실패·응답 지연).
- 실제 Pages에서 미리 받기 회귀가 통과했다: 첫 화면에서 미리 받은 한글 WASM과 PDF worker가 편집기를 열 때 네트워크로 다시 오지 않았다(엔진 미리 받기 계획의 "배포 뒤 확인" 항목).
- `fd30829`(pdf.js worker 한 벌, 주간 npm 확인)을 같은 절차로 배포했다(525개 중 14개 업로드). `npm run test:live`: 15개 통과, 2개 건너뜀.
- 배포 뒤 GitHub Actions가 `fa504a9`부터 실패하던 것을 찾았다. 엔진 목록 회귀 시험이 영어 Chrome에서 Word의 영어 맞춤법 사전과 Hunspell 청크(1.3MB)를 만나 깨졌다(한국어 기기에서는 받지 않아 통과). 시나리오 로캘을 ko-KR로 고정했다(`4aec08c`). 그 뒤 CI verify와 upstream-watch(최신 원본·npm 확인) 모두 통과했고, 이 때문에 열린 이슈 #1은 닫았다.
- 옛 `pdfjs/6.4.299/pdf.worker.min.mjs`는 새 배포에 없지만 `docs.sketchps.app`의 Cloudflare 캐시에 `immutable`로 남아 있다. 새 코드는 이 주소를 쓰지 않는다.
