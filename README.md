# Sketch Docs

이 저장소는 문서 형식 선택 화면, 편집기 연결, 한국어 설정과 파일 저장 메뉴를 관리한다. `source/edentext`, `source/hop`는 수정하지 않는 별도 Git 클론이다. 우리 변경은 `overlays/`와 `src/`에 있으며 빌드용 복사본에만 적용한다.

저장소 구조·버전 관리·소스 제공·직원용 도메인에 관한 합의와 남은 결정은 [프로젝트 결정 기록](docs/project-decisions.md)에 정리한다.

공통 헤더·편집기 전환·프로그램 정보는 [설계 기록](docs/architecture/common-editor-header.md), 검증 결과는 [공통 셸 검증](docs/validation/2026-10-12-common-shell.md)에 정리한다.

## 실행

Node 24.21.0과 데스크톱 Chrome을 검증에 사용한다. 루트에서 실행한다.

```sh
cd /Users/hwjung/Coding/edentext-word-hwp
npm ci
npm run upstream:sync
npm run dev -- --port 5173 --strictPort
```

이전에 `source/edentext`에서 띄운 서버가 5173을 사용 중이면 그 터미널에서 Ctrl+C로 종료한 뒤 실행한다. `npm run dev`는 먼저 두 엔진을 준비한다. 첫 빌드는 생성된 EdenText 작업 공간의 의존성을 설치하므로 시간이 더 걸린다.

- `/`: Word / 한글 선택
- `/word.html`: 한국어 EdenText, 새 문서는 DOCX 기본 저장
- `/hwp.html`: 한글 전용 엔진, 편집 왼쪽의 파일 메뉴에서 새 문서·열기·저장·다른 이름으로 저장 (.hwpx)/(.hwp)

공통 헤더의 Word/한글 버튼은 각각의 작성 중 문서와 저장 대상을 유지하며 전환한다. 새로고침 후 한글 복구는 지원하지 않는다. 첫 화면 하단과 편집 화면 오른쪽 ⓘ에서 Sketch Docs 정보·라이선스·해당 버전 소스 다운로드를 제공한다. 빌드 시 `public/legal/`에 약 153 MB의 소스 묶음과 고지를 생성하므로 배포할 때 `dist/legal/`도 함께 올린다. 소스의 `SOURCE-README.txt`에 오프라인 원본 복원 및 빌드 절차가 있다.

Word 엔진을 직접 실행하는 위치는 `/engines/word/index.html`이다. 빌드된 엔진은 개발 서버에서도 명시적인 `index.html`로 연다.

## 원본과 우리 코드

| 경로 | 소유와 역할 |
|---|---|
| `src/`, `index.html`, `word.html`, `hwp.html` | 우리 화면과 파일 작업 연결 |
| `overlays/edentext/product.patch` | 한국어 기본값·번역, DOCX 기본 저장, 기존 HWPX/HWP 변환 개선 |
| `overlays/edentext/ko.ts` | upstream 번역 타입으로 검사하는 한국어 사전 |
| `overlays/rhwp/host-bridge.txt` | 한글 엔진의 열기·직렬화·변경 상태 연결 |
| `scripts/build-engines.mjs` | 원본 검증, 복사본에 변경 적용, 엔진 빌드 |
| `upstreams.lock.json` | 검증한 EdenText/HOP/rhwp 커밋 |
| `source/` | 원본 클론. 루트 Git에서 제외 |
| `.cache/`, `public/engines/`, `public/rhwp/` | 다시 만들 수 있는 생성물. 직접 수정 금지 |
| `tests/` | 파일 쓰기 계약과 실제 브라우저 회귀 검사 |

현재 한글 엔진 경로는 **HOP가 고정한 `third_party/rhwp`의 웹 Studio와 HOP의 vendored WASM**이다. HOP 데스크톱 호스트를 브라우저로 그대로 실행하는 것은 아니다. HOP·rhwp 버전과 WASM 검증을 함께 수행한다.

## 업데이트 후보 검증

```sh
git -C source/edentext fetch origin
git -C source/hop fetch origin
npm run upstream:check -- --edentext origin/main --hop origin/main
```

후보 버전으로 원본 체크아웃을 잠시 바꾸고 별도 `.cache/candidate-*`, `candidate-dist/`에서 빌드·검증한다. 성공·실패 후 원래 커밋으로 돌아온다. 수정 파일이 있으면 자동 삭제하거나 덮어쓰지 않고 중단한다. 두 ref를 생략하면 현재 체크아웃을 후보로 검증한다.

검사 내용:

1. 커밋·작업 트리·HOP WASM 출처 확인
2. `git apply --check`와 연결 코드의 일치 지점 검사
3. 우리 앱과 적용된 Word 엔진의 타입 검사
4. 손실 보고·외부 변경·쓰기 실패 처리 단위 검사
5. Chrome에서 한국어 Word/DOCX, Word 저장 메뉴에서 한글 형식 제외, 한글 파일 메뉴 위치·세로 배치와 HWP/HWPX 저장·재열기, 원본 보호·사본 재저장 검사

호환되지 않는 업데이트는 검사 실패로 끝나고 기존 lock을 바꾸지 않는다. `artifacts/candidate-verified.json` 결과를 검토한 뒤 채택한다.

```sh
npm run upstream:promote
npm run verify
```

후보 검증 뒤 우리 소스·패치·테스트가 바뀌면 promote가 거절된다. 수정 후 다시 검증해야 한다. 업데이트가 호환되지 않으면 `overlays`/연결 코드를 수정하고 후보 검사를 다시 실행한다. 미래의 모든 업데이트가 수정 없이 호환된다고 보장하지 않는다.

## 배포 전

`npm run verify`가 성공한 `dist/`만 배포 대상으로 사용한다. 성공 보고는 `artifacts/verified.json`에 커밋과 우리 코드 해시를 기록한다. 실패한 실행은 이전 성공 보고를 무효화한다. 코드·lock을 바꾼 뒤에는 다시 실행한다. 자동 라이브 배포나 원격 push는 설정하지 않았다.

빠른 화면 확인은 `npm run build`, 생성된 엔진을 이용한 개발 서버 회귀 검사는 `node tests/integration.mjs --dev`로 수행한다. `build`만으로 배포 검증 완료를 의미하지 않는다.

자동 저장 검사는 실제 브라우저 OPFS 핸들로 OS 선택기를 대체한다. 실제 디스크 선택기·한컴/Word 재열기·IME 입력은 배포 대상 OS에서 추가 수동 확인해야 한다. 가져온 한글 원본 덮어쓰기와 한글 자동 복구는 아직 제공하지 않으며, 미지원 변환 요소는 저장을 거절한다.

## 기존 작업 보존

분리 전 수정된 EdenText 저장소 전체는 `backups/edentext-custom-worktree/`, Git 이력은 `backups/edentext-custom-ff938e6e.bundle`, 커밋되지 않은 변경은 `backups/edentext-working-tree.patch`에 보존했다. 백업과 원본 클론은 루트 커밋에 포함하지 않는다.

EdenText와 파생 변경은 AGPL-3.0 라이선스를 따른다. 배포 엔진에 각 원본 라이선스를 포함한다. 배포 시 대응 소스는 이 저장소의 코드·패치와 lock에 고정한 원본으로 재현할 수 있어야 한다.

병원 내부 배포·로그인과 HOP/rhwp 라이선스 검토 및 배포 전 남은 고지 작업은 [라이선스 검토 기록](docs/validation/2026-10-11-licenses.md)을 참조한다. 현재 기능 검사 통과가 라이선스 배포 준비 완료를 의미하지 않는다.
