# 통합 웹 편집기

- 루트가 우리 제품 저장소다. `source/edentext`, `source/hop`와 rhwp 서브모듈은 읽기 전용 upstream 클론이다. 제품 변경은 루트 `src/`, `overlays/`, `scripts/`, `tests/`에 둔다.
- `backups/`는 사용자 작업 보존본이다. 삭제·정리하지 않는다. `.cache/`와 `public/engines`, `public/rhwp`는 우리 빌드 생성물이며 다시 만들 수 있다.
- Node 24.21.0, Svelte 5, Vite 8. 새 의존성·upstream 업데이트는 lock과 회귀 검사로 검증한다.
- `npm run dev`: 원본 검증/엔진 빌드 후 localhost. 원본 폴더에서 제품 서버를 실행하지 않는다.
- `npm run verify`: 양쪽 타입 검사·저장 계약·실제 Chrome 회귀 검사. 배포 전 필수. OS 파일 선택기와 Word/한컴 재열기는 별도 수동 검사다.
- `upstream:check`는 후보만 검증하고 이전 체크아웃으로 돌아온다. 실패를 무시하거나 패치 검사 조건을 느슨하게 만들어 통과시키지 않는다. `upstream:promote`는 검사 당시 소스 해시가 맞을 때만 버전 lock을 바꾼다.
- 어떤 실행도 사용자 편집 파일, upstream 수정 파일, 백업을 덮어쓰거나 삭제하지 않는다.
- 공개 저장소 `HWJskt/sketch-docs`(public). push하면 바로 공개된다. 원본 코드·`backups/`·비밀값은 올리지 않는다. push는 명시 요청 때만 한다.
- 브라우저 테스트는 playwright-core와 설치된 Chrome을 사용하고, 자신이 시작한 서버·브라우저는 finally에서 닫는다.
- 구조·실행·업데이트 절차는 README.md, 목표·계획·검증 결과는 docs/에 기록한다.

## 배포 (배포)

- 정책: **명시 요청 때만 배포한다.** push만으로는 배포되지 않는다(Git 연동 자동 배포 없음). 2026-10-12 사용자 결정.
- 대상: Cloudflare Pages 프로젝트 `sketch-docs` → `docs.sketchps.app`.
- 절차: `npm run verify` → 커밋을 `origin/main`에 push → `npm run mirrors:check`(필요하면 `mirrors:pin`) → `npm run deploy`.
  - `deploy`는 다음을 모두 확인한 뒤에만 wrangler로 `dist/`를 올린다: 검증 보고와 커밋·코드·`dist` 해시 일치, 깨끗한 작업 트리, push된 커밋, 보존 fork의 고정 커밋 태그.
- 배포 뒤 `npm run test:live`(기본 `https://docs.sketchps.app`, `LIVE_ORIGIN`으로 바꿈)로 실제 URL에서 브라우저 회귀 시험을 돌린다.
- 프로젝트는 기존 Pages 방식이다. wrangler 4.142의 `pages project create`는 Workers로 넘기려다 실패해서 `--force`로 한 번 만들었다(2026-10-12). 이후 명령에는 `--force`를 쓰지 않는다. 첫 배포는 `Failed to publish your Function. Unknown internal error`로 실패했고, 같은 명령을 한 번 다시 실행해 성공했다.
- `docs.sketchps.app` DNS는 대시보드에서 관리한다. wrangler OAuth 토큰에는 DNS 쓰기 권한이 없다.
- 소스 제공: 배포판 정보 창이 빌드 커밋의 GitHub 링크를 건다. 그래서 push되지 않은 커밋은 배포하지 않는다.
- GitHub Actions: push마다 `verify`, 매주 `upstream-watch`(최신 원본 검사, 실패 시 이슈). 배포 권한은 주지 않는다.
