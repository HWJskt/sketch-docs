# 통합 웹 편집기

- 루트가 우리 제품 저장소다. `source/edentext`, `source/hop`와 rhwp 서브모듈은 읽기 전용 upstream 클론이다. 제품 변경은 루트 `src/`, `overlays/`, `scripts/`, `tests/`에 둔다.
- `backups/`는 사용자 작업 보존본이다. 삭제·정리하지 않는다. `.cache/`와 `public/engines`, `public/rhwp`는 우리 빌드 생성물이며 다시 만들 수 있다.
- Node 24.21.0, Svelte 5, Vite 8. 새 의존성·upstream 업데이트는 lock과 회귀 검사로 검증한다.
- `npm run dev`: 원본 검증/엔진 빌드 후 localhost. 원본 폴더에서 제품 서버를 실행하지 않는다.
- `npm run verify`: 양쪽 타입 검사·저장 계약·실제 Chrome 회귀 검사. 배포 전 필수. OS 파일 선택기와 Word/한컴 재열기는 별도 수동 검사다.
- `upstream:check`는 후보만 검증하고 이전 체크아웃으로 돌아온다. 실패를 무시하거나 패치 검사 조건을 느슨하게 만들어 통과시키지 않는다. `upstream:promote`는 검사 당시 소스 해시가 맞을 때만 버전 lock을 바꾼다.
- 어떤 실행도 사용자 편집 파일, upstream 수정 파일, 백업을 덮어쓰거나 삭제하지 않는다. 라이브 배포·push는 명시 요청 때만 한다.
- 브라우저 테스트는 playwright-core와 설치된 Chrome을 사용하고, 자신이 시작한 서버·브라우저는 finally에서 닫는다.
- 구조·실행·업데이트 절차는 README.md, 목표·계획·검증 결과는 docs/에 기록한다.
