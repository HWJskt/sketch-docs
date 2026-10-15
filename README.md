# Sketch Docs

브라우저에서 Word(DOCX·ODT)와 한글(HWP·HWPX) 문서를 편집하고, PDF를 보며 주석을 다는 웹 편집기. 서버에 문서를 올리지 않는다. 파일은 브라우저의 로컬 파일 API로 열고 저장한다.

- 서비스: <https://docs.sketchps.app>
- 라이선스: [AGPL-3.0-only](LICENSE)

*A browser editor for Word (DOCX/ODT) and Hangul (HWP/HWPX) documents, built on [EdenText](https://github.com/stffnb/edentext), [HOP](https://github.com/golbin/hop) and [rhwp](https://github.com/edwardkim/rhwp). This repository holds only our product code; the upstream projects are restored from pinned commits at build time.*

## 구성

Sketch Docs는 오픈 소스 편집기 세 개를 하나의 화면으로 묶는다.

| 구성요소 | 역할 | 라이선스 |
|---|---|---|
| [EdenText](https://github.com/stffnb/edentext) | Word 편집기 (DOCX/ODT) | AGPL-3.0-only |
| [HOP](https://github.com/golbin/hop) | 한글 편집 호스트와 검증된 rhwp WASM | MIT |
| [rhwp](https://github.com/edwardkim/rhwp) | 한글 문서 엔진과 웹 Studio | MIT |
| [svelte-pdf-mini](https://github.com/julien-blanchon/svelte-pdf-mini) 0.9.1 (npm, 정확한 버전 고정·패치 안 함) | PDF 보기·주석 부품, 주석 읽기·쓰기(pdf.js 6.4.299·@cantoo/pdf-lib 2.11.1) | MIT (pdf.js Apache-2.0) |

**이 저장소에는 우리 코드만 있다.** 세 원본은 `upstreams.lock.json`에 고정한 커밋으로 `source/`에 내려받는다(Git에는 포함하지 않음). 빌드는 다음 순서로 진행한다.

1. 원본의 고정 커밋을 `.cache/build/`로 복사한다.
2. 우리 변경(`overlays/`)을 그 복사본에만 적용한다. 원본 클론은 수정하지 않는다.
3. 엔진을 빌드한다.

원본 저장소가 사라질 때를 대비해 고정 커밋을 보존 fork([edentext](https://github.com/HWJskt/edentext) · [hop](https://github.com/HWJskt/hop) · [rhwp](https://github.com/HWJskt/rhwp))에 `sketch-docs/pin-<commit>` 태그로 남긴다. 원본에서 받을 수 없으면 자동으로 fork에서 받는다.

| 경로 | 내용 |
|---|---|
| `src/`, `index.html`, `word.html`, `hwp.html`, `pdf.html` | 공통 셸, 편집기 전환, 한글 파일 메뉴·저장, 정보 창 |
| `src/pdf/` | PDF 편집기: 보기·주석, 저장 트랜잭션(`save.ts`), 보존 검사(`preserve.ts`), 서명·암호 판별, 내보내기 worker, 복구 사본 |
| `scripts/pdf-assets.mjs`, `scripts/pdf-manifest.mjs` | pdf.js 자산을 `pdfjs/<버전>/`에 배치, PDF 엔진 파일 목록 |
| `scripts/make-pdf-fixtures.mjs`, `tests/fixtures/pdf/` | 시험용 PDF 7종(의존성 없이 생성, `--check`로 재현 비교) |
| `overlays/edentext/` | EdenText 변경: 한국어 기본값·번역, 저장 메뉴, 셸 연결 |
| `overlays/rhwp/` | rhwp Studio 변경: 호스트 연결(열기·저장·인쇄·변경 상태), 파일 메뉴 스타일 |
| `scripts/build-engines.mjs` | 원본 검증, 복사본에 변경 적용, 엔진 빌드 |
| `scripts/upstreams.mjs` | 원본 내려받기·업데이트 후보 검사·채택 |
| `scripts/release-info.mjs` | 라이선스 고지와 소스 링크(`legal/release.json`) 생성 |
| `public/sw.js` | 오프라인 Word를 위한 서비스 워커 |
| `tests/` | 단위·계약 시험과 실제 Chrome 회귀 시험 |
| `docs/` | 설계 결정, 계획, 검증 기록 |

## 실행

필요한 것: Node.js 24.21.0, npm, Git, 데스크톱 Chrome(시험용).

```sh
git clone https://github.com/HWJskt/sketch-docs.git
cd sketch-docs
npm ci
npm run upstream:sync      # 세 원본을 고정 커밋으로 source/에 내려받음
npm run dev                # 엔진 빌드 후 http://localhost:5173
```

첫 실행은 EdenText 의존성을 설치하므로 오래 걸린다.

- `/`: 문서 형식 선택(DOCX·HWPX). 이 화면에 있는 동안 마지막으로 쓴 편집기부터 엔진을 미리 받는다(데이터 절약 모드·2G 제외). 카드를 누르면 페이지를 다시 읽지 않고 같은 화면에서 편집기를 띄워 받던 파일을 이어 쓴다.
- `/word.html`: Word 편집기. 새 문서는 DOCX로 저장한다.
- `/hwp.html`: 한글 편집기. 파일 메뉴에서 새 문서·열기·저장·다른 이름으로 저장(.hwpx/.hwp)·인쇄를 할 수 있다.

공통 헤더의 W·한·PDF 버튼은 세 편집기의 작성 중 문서와 저장 대상을 각각 유지한 채 전환한다.

PDF 편집기는 형광펜·밑줄·취소선·메모·펜·사각형 주석을 표준 PDF 주석으로 저장한다. 열린 파일에 저장(Ctrl+S)하기 전에 저장본을 다시 읽어 원본과 비교하고(보존 검사), 그 세션에서 처음 덮어쓸 때 원본을 브라우저 저장소에 보관한다("저장 전 원본 복원"). 서명된 PDF와 암호 PDF는 열어서 주석을 달 수 있지만 저장하지 않는다. 형식 변환은 하지 않는다. 파일 열기·저장은 File System Access API를 지원하는 데스크톱 Chrome·Edge에서 동작한다.

## 빌드와 검증

```sh
npm run build    # 엔진 + 앱 빌드 → dist/
npm run verify   # 배포 전 필수 검사
```

`npm run verify`는 다음을 모두 통과해야 `artifacts/verified.json`에 성공을 기록한다.

1. 원본 커밋·작업 트리·HOP WASM 출처를 확인한다.
2. 변경 적용을 검사한다: `git apply --check`, 그리고 모든 문자열 치환 지점이 정확히 한 번씩 일치하는지.
3. 우리 앱과 변경이 적용된 Word 엔진을 타입 검사한다.
4. 단위·계약 시험을 돌린다.
   - 파일 쓰기: 손실 보고, 외부 변경 감지, 쓰기 실패
   - 단축키와 경로 판정
   - 소스 링크
   - 원본 Git 조작: ignored 파일 보존, 체크아웃 복원, fork 폴백
   - 서비스 워커: 캐시 쓰기 실패, 오프라인 대체, 리다이렉트 저장, 옛 캐시 정리
   - 엔진 파일 목록(`engines/manifest.json`): 진입 JS·CSS·WASM, 미리 받을 글꼴·이미지
   - 엔진 미리 받기: 진행률, 중복 요청 공유, 형식 선택 시 다른 엔진 중단, 정체 알림, 실패 뒤 다시 받기, 목록에 없는 엔진
   - PDF: 보존 검사(시험용 PDF 왕복과 손상 13종), 서명·암호 판별, 저장 트랜잭션(복구 사본·탭 간 잠금·외부 변경·직렬), 내보내기 worker 시간 상한, 복구 사본 저장소, 주석 dirty 판정, pdf.js 자산·엔진 목록
   - 라이선스 고지: 런타임 npm 의존성 전부
5. Chrome 통합 시험 (`tests/integration.mjs`)을 돌린다.
   - Word: DOCX 저장 내용
   - 한글: HWP/HWPX 저장·재열기, 원본 보호, 사본 재저장, 인쇄
   - 공통: 편집기 전환 시 문서·실행 취소 이력 유지, 이탈 확인, 오프라인 Word
6. Chrome 회귀 시험 (`tests/regressions.mjs`)을 Cloudflare Pages처럼 동작하는 정적 서버(확장자 없는 URL, `_headers`)에서 돌린다.
   - 확장자 없는 URL, 뒤로 가기, 오프라인
   - 서비스 워커 설치 실패·스크립트 응답 지연
   - 모던 툴바 저장 메뉴
   - Word 엔진 직접 접근
   - 엔진 파일 목록: 각 편집기가 처음 열 때 받는 100KB 넘는 파일이 모두 목록에 있고, 목록의 필수 파일은 실제로 받는지
   - 엔진 다운로드 진행 화면: 느린 네트워크에서 진행률 표시 뒤 편집기가 열리고 WASM은 한 번만 받는지, 정체·실패 시 다시 시도
   - 첫 화면 미리 받기: 마지막으로 쓴 편집기 먼저, 받는 도중에 골라도 처음부터 다시 받지 않음, 뒤로 가기로 첫 화면 복귀, Save-Data면 받지 않음
   - 번들 경계(`tests/bundle-boundary.mjs`): 첫 화면·Word·한글 쪽 청크에 PDF 라이브러리 모듈이 없는지
   - PDF 브라우저 시험(`tests/pdf.integration.mjs`): 보기 기능, 같은 출처 자산, 주석 6종, 다른 이름으로·열린 파일 저장과 재열기, 서명·암호 거절, 두 탭 동시 저장, 원본 복원, 이탈 확인
   - 5·6의 브라우저 시험(Excel `tests/xlsx.integration.mjs` 포함)은 이 기기의 Chrome 언어로 한 번, 영어 Chrome(`TEST_LOCALE=en-US`)으로 한 번 더 돈다. GitHub 영어 러너에서만 드러난 실패(`4aec08c`)가 있었다.
7. 배포 산출물이 파일당 25MiB, 전체 20,000개 제한 안에 드는지 확인한다.
8. 검사하는 동안 우리 코드나 lock이 바뀌지 않았는지 확인한다.

OS 파일 선택기, 실제 프린터, 한컴오피스·Word에서 다시 열기, IME 입력, Safari는 자동 시험 범위 밖이다. 수동으로 확인한다.

## 원본 업데이트

원본이 업데이트되어도 우리 변경이 조용히 깨지지 않도록, 새 원본은 **후보**로 전체 검사를 통과해야만 채택한다.

```sh
npm run upstream:check                          # 각 원본의 최신 기본 브랜치를 fetch해 검사
npm run upstream:check -- --edentext <ref>      # 특정 ref만 지정
npm run upstream:check -- --current             # 지금 체크아웃된 상태 그대로 검사
npm run upstream:promote                        # 통과한 후보를 lock에 채택
npm run verify
```

- `upstream:check`는 원본 체크아웃을 잠시 후보로 바꾼다. `.cache/candidate-*`, `candidate-dist/`에서 위 검사를 모두 돌리고, 성공하든 실패하든 원래 커밋(rhwp 포함)으로 되돌린다.
- 원본 클론에 수정한 파일이 있으면 아무것도 바꾸지 않고 멈춘다. ignored 파일을 덮어쓰게 되는 체크아웃도 거절한다.
- 호환되지 않는 업데이트는 검사 실패로 끝나고 lock은 바뀌지 않는다. 이때는 `overlays/`나 연결 코드를 고친 뒤 다시 검사한다.
- 후보 검증 뒤 우리 코드가 바뀌면 promote가 거절된다.
- 채택한 뒤 `npm run mirrors:pin`으로 새 고정 커밋을 보존 fork에 태그로 남긴다(GitHub CLI 인증 필요).

최신 원본 검사는 로컬 `upstream:check`로만 한다(2026-10-15 결정). 채택은 `upstream:promote` → `npm run verify` → 커밋 → push(아래 게이트 통과).

## push 게이트와 GitHub Actions

`npm run hooks:install`(한 번)이 `core.hooksPath`를 `.githooks`로 맞춘다. pre-push 훅(`scripts/push-gate.mjs`)은 push하는 각 ref의 끝 커밋(주석 태그는 가리키는 커밋)마다 — 그 사이 커밋은 하나하나 검사하지 않는다:

- `artifacts/verified.json`이 그 커밋·깨끗한 작업 트리·같은 제품 파일에서 만든 통과 보고면 바로 통과한다.
- 아니면 그 커밋을 임시 worktree(이 클론의 `source/`와 Cargo 빌드 출력을 빌려 쓰고, `node_modules`(`npm ci --prefer-offline`)와 빌드 작업 폴더는 따로 둠)에서 `npm run verify` 한 뒤 통과한다. 실패하면 push를 막는다. 어느 쪽이든 verify가 영어 Chrome 회차를 포함한다.
- 중단(Ctrl-C)하면 임시 worktree를 지운다. 강제 종료로 남은 것은 다음 실행이 지운다.
- 훅은 `.githooks/`에 있으므로 048a813 이전 커밋을 체크아웃한 상태에서는 걸리지 않는다.
- 원격 브랜치 삭제는 검사하지 않는다.
- `git push --no-verify`는 모든 훅을 건너뛴다. 이것은 막을 수 없다.
- 설치 확인 `git config --get core.hooksPath`(→ `.githooks`), 되돌리기 `git config --unset core.hooksPath`.

GitHub Actions(Rust·브라우저 없음):
- push마다 `verify`: `npm run check`, `npm run test:contracts`.
- 매주(와 수동 실행) `dependency-watch`: `svelte-pdf-mini` 새 판·`npm audit --omit=dev`, 그리고 gridcraft·craft-libs 고정 커밋의 Cargo.lock을 `cargo audit`(판·sha256 고정 바이너리)으로 RustSec과 대조한다. 걸리면 이슈를 연다(cargo audit은 취약점만 — unmaintained 등 경고는 실행 기록에만. craft-libs 자체 lock에는 엔진이 쓰지 않는 crate도 있어 그것만 걸리면 제품과 무관할 수 있다). 빌드나 upstream 코드 실행은 없고, 쓰기 권한은 이슈를 쓰는 job에만 있다.

## 배포 (관리자용)

배포는 명시적으로 실행할 때만 한다. push만으로는 배포되지 않는다.

```sh
npm run verify
npx wrangler login    # 처음 한 번
npm run deploy
```

`npm run deploy`는 아래 조건을 모두 확인한 뒤에만 `dist/`를 Cloudflare Pages 프로젝트 `sketch-docs`에 올린다.

1. 검증 보고가 현재 커밋·코드와 일치한다.
2. 작업 트리가 깨끗하다.
3. 그 커밋이 GitHub에 push되어 있다.
4. 원본 고정 커밋이 보존 fork에 태그로 남아 있다.

배포한 뒤 `npm run test:live`로 실제 URL(`https://docs.sketchps.app`)에서 브라우저 회귀 시험을 돌린다. 서버를 조작해야 하는 시나리오 2개는 건너뛴다. 회귀 시나리오(`tests/regressions.mjs`)가 실패하면 그 순간의 페이지 HTML·스크린샷과, Node에서 새로 요청한 `origin/`의 본문·응답 헤더(`cf-ray`·`age`·`etag` 등 허용 목록만, 쿠키 없음)를 `artifacts/live-failure/<시각>/<시나리오>/`에 남긴다(`tests/failure-evidence.mjs`). 배포 직후 반영 지연인지 진짜 결함인지 가르는 근거다 — 2026-10-15 첫 `test:live` 실패는 이것이 없어 추정으로만 남았다.

이 중 3번은 `origin`이 아니라 `package.json`에 적힌 공개 저장소를 인증 없이 조회해 확인한다.

## 소스 제공과 라이선스

Sketch Docs는 AGPL-3.0-only로 배포한다.

- **우리 코드:** 서비스 안 정보 창(ⓘ)의 "이 버전의 소스 코드 (GitHub)" 링크가 배포판을 빌드한 커밋으로 연결된다.
- **원본:** 같은 창에서 각 원본 저장소와 보존 fork의 고정 커밋 링크를 제공한다.
- **고지:** 각 구성요소의 라이선스 원문과 타사 고지는 배포판의 `legal/`에 들어 있다.

문서는 브라우저 안에서만 처리하며 서버로 보내지 않는다. 단, EdenText의 AI 도우미처럼 사용자가 직접 설정하는 외부 기능은 예외다.

설계 결정과 검증 기록은 [`docs/`](docs/)에 있다. [프로젝트 결정](docs/project-decisions.md) · [공통 헤더 설계](docs/architecture/common-editor-header.md) · [공개 배포 계획](docs/plans/2026-10-12-public-release.md)
