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
| 1. 결함 수정·시험 | 진행 중 | |
| 2. GitHub 소스 링크·README | | |
| 3. upstream 최신 검사·Actions | | |
| 4. Codex 리뷰·반영 | | |
| 5. 저장소·fork 생성, push, Actions 실행 | | |
| 6. Cloudflare 배포·실 URL 확인 | | |
