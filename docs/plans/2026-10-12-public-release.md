# 공개 저장소·GitHub 소스 링크·upstream 회귀 시험·Cloudflare 배포 (2026-10-12)

## 사용자 결정 (2026-10-12)

- 서비스 주소: `docs.sketchps.app` (도메인 `sketchps.app`은 Cloudflare에서 구매함).
- 공개 저장소: `HWJskt/sketch-docs`. 현재 Git 이력을 그대로 올린다. EdenText·HOP·rhwp 코드는 올리지 않는다(`source/`는 gitignore).
- 원본 보존: 세 원본을 HWJskt 계정에 fork하고, lock에 고정한 커밋을 fork에 태그로 남긴다.
- 소스 제공: Cloudflare에서 소스 묶음을 내려받지 않는다. 앱의 저작권 안내에서 GitHub 링크로 제공한다.
  - 우리 코드: 빌드한 커밋의 GitHub 링크
  - 원본: 원래 저장소와 fork의 고정 커밋 링크
- upstream 시험: 로컬 `upstream:check`가 최신 원본을 fetch해 전체 검사를 돌린다. GitHub Actions는 push마다 고정 버전을 검사하고, 매주 최신 원본을 검사해 실패하면 이슈를 연다.
- 배포: 로컬 `npm run verify`로 검증한 `dist/`만 wrangler로 Cloudflare Pages에 직접 올린다. 명시 요청이 있을 때만 배포하고, push만으로는 배포하지 않는다.

## 완료 기준 (DoD)

1. 리뷰에서 수용한 결함 7건을 고치고, 고친 각 결함에 재현 시험을 둔다.
   - SW 설치 실패 시 Word 멈춤
   - 모던 메뉴의 HWP 저장 노출
   - ignored 파일 덮어쓰기
   - 단독 엔진에서 빠져나갈 수 없음
   - 저장 형식 누수
   - `cache.put` 실패 시 응답 손실
   - rhwp 체크아웃 미복원
2. 배포 시 문제를 막는다: Cloudflare의 확장자 없는 URL 대응, SW 캐시 누적, `exact()`의 `$` 패턴, 쓰이지 않는 `?new=1`.
3. `dist/`에 소스 tar가 없다.
   - `release.json`과 About 화면에는 GitHub 커밋 링크와 원본·fork 고정 커밋 링크가 있다.
   - `dist/`에 25MiB를 넘는 파일이 하나도 없다(verify가 검사한다).
4. `upstream:check`는 기본으로 최신 원본을 fetch해 검사한다. 원본 체크아웃 복원과 ignored 파일 보존은 시험으로 고정한다.
5. GitHub Actions 워크플로를 실제 GitHub에서 한 번 이상 실행한다. 고정 버전 검사가 끝까지 성공해야 한다.
6. 공개용 README.md를 쓴다: 소개, 실행·빌드, 원본 복원, 업데이트 절차, 라이선스.
7. Codex 리뷰를 2회 돌리고 판정한다. 수용한 지적은 수정한다.
8. Cloudflare Pages에 배포하고 `docs.sketchps.app`을 연결한다. 실제 URL에서 확인할 항목:
   - 루트, Word, 한글
   - 직접 경로 새로고침
   - 오프라인 Word
   - 소스 링크
9. CLAUDE.md에 배포 정책을 적는다.

## 범위 밖

- 한글 원본 덮어쓰기
- 한글 자동 복구
- 폰트 라이선스 최종 확인. 인계 문서에 남은 작업으로 유지한다.
- Cloudflare Access
- 사용자 계정 기능

## 진행

| 단계 | 상태 | 커밋 |
|---|---|---|
| 1. 결함 수정·시험 | 완료 | acccfb7 499a926 ee4e353 93cfdd4 d7a5e79 |
| 2. GitHub 소스 링크·README | 완료 | e79f7cd |
| 3. upstream 최신 검사·Actions·배포 스크립트 | 완료 | f65569e 8dfcd28 |
| 4. Codex 리뷰·반영 | 완료 (지적 7건: 수용 6, 배포 때 확인 1) | d3fb04c |
| 5. 저장소·fork 생성, push, Actions 실행 | 완료 — Actions verify·upstream-watch 성공 | 3cba22d |
| 6. Cloudflare 배포·실 URL 확인 | 완료: `docs.sketchps.app` 연결, live 시험 3회 각 4개 통과 | 3cba22d 배포 |

## 기록

- 수정 전 코드에서 새 시험이 실패하는지 확인했다(형식 누수, SW 설치 실패, `/hwp` 뒤로 가기, git 변이 2건).
  - 모던 메뉴·단독 엔진은 수정 전 배포본을 재현 스크립트로 확인했다.
- Cloudflare 리다이렉트 가설은 일부만 맞았다. 브라우저가 308을 캐시해서 오프라인 Word는 옛 코드로도 동작했다. 틀린 것은 `/hwp`로 들어온 뒤 뒤로 가기 하는 경우 하나였다.
- 기존 `product.patch`는 줄 번호가 어긋난 채 offset으로 적용되고 있었다. 고정 커밋 기준으로 다시 생성했다(내용 변경은 메뉴 두 줄 삭제뿐).
- npm 11이 wrangler 의존성(esbuild·workerd·fsevents)의 install script를 막는다. Pages 직접 업로드에 필요한지는 배포 때 확인한다.
- 최신 원본 실측(2026-10-12): EdenText `4c4c94c` → `62241e0`이 우리 오버레이로 전체 게이트를 통과했다. HOP·rhwp는 변화가 없었다. 채택(promote)은 사용자 결정으로 남겼다.
- 백그라운드 보안 검사 지적: upstream-watch가 원본 코드를 쓰기 권한 토큰과 함께 실행했다. job을 분리하고 자격증명 저장을 껐다(8dfcd28).
- 배포(2026-10-12): Pages 프로젝트 `sketch-docs`를 만들고 `3cba22d`를 배포했다.
  - 실측: `.html` 308 리다이렉트, `_headers` 적용, WASM MIME, `release.json` 커밋 일치
  - 같은 URL에서 live 시험 4개 통과(서버 조작 시나리오 2개는 건너뜀)
  - GitHub 소스·fork 링크 4개 모두 익명 200
- wrangler의 막힌 install script는 `pages deploy`를 막지 않았다(리뷰 지적 E 확인).
- `docs.sketchps.app` 연결(2026-10-13): CNAME `docs` → `sketch-docs.pages.dev`.
  - 프록시(주황 구름)를 켰을 때 KT(KORNET) 회선에서 zone 무료 플랜 IP(104.21.x·172.67.x)가 AMS·LHR·SEA·BOS로 갔다. rhwp WASM 11.8MB가 2.4~3.7초, 나쁠 때는 90초에 4MB였다. live 시험 6회 중 4회가 한글 편집기 로딩 대기 한도를 넘었다.
  - 같은 호스트를 Pages IP(172.66.x)로 붙이면 ICN, 0.29~0.33초였다.
  - 그래서 프록시를 껐다(DNS only, 사용자 결정). 프록시는 레코드 단위라 다른 하위 도메인에는 영향이 없다.
  - 끈 뒤 실측: colo ICN, Pages 도메인 상태 active, 인증서 Google Trust Services(2027-01-10 만료), `http://` → 301 `https://`, `.html` 308, `_headers` 적용. `npm run test:live` 3회 각 PASS 4·SKIP 2.
