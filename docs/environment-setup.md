# 웹에디터 개발 자료와 의존성 준비

> 아래는 초기 환경 준비 기록이다. 원본 클론 분리 이후 실행 위치와 업데이트 절차는 [루트 README](../README.md)를 따른다. 제품 서버는 `source/edentext`가 아닌 프로젝트 루트에서 실행한다.

확인일: 2026-10-11

프로젝트 루트는 `/Users/hwjung/Coding/edentext-word-hwp`다. 아래 항목은 로컬에 내려받거나 설치하고 확인한 결과다.

| 위치 | 준비 상태 |
|---|---|
| `source/edentext` | 기존 소스, `npm ci`로 잠금 파일 기준 패키지 268개 설치, 프로덕션 빌드 성공 |
| `source/hop` | 기존 소스, `pnpm install --frozen-lockfile`로 워크스페이스 패키지 58개 설치, Studio 호스트 빌드 성공 |
| `source/hop/third_party/rhwp` | 재귀 서브모듈 초기화 완료, v0.8.7 / `1a76570e833917d15817415a53c09ad61ab3203f` |
| `source/hop/apps/studio-host/vendor/rhwp-core` | 기존 WASM·JS·타입 파일의 provenance 검사 통과 |
| `source/hwpx-skill` | 검증·템플릿 제작용 소스, `ba90fc5ae15f4aead8dab4f9d69d4830b9569859` |
| `.venv-hwpx` | Python 3.12 격리 환경, python-hwpx·lxml·jsonschema·Pillow 설치 및 import 확인 |

HOP의 `upstream:verify`가 서브모듈 커밋, 버전, WASM 산출물 해시 및 관련 고정 정보를 검사해 통과했다. HOP와 rhwp의 추적 파일에 변경은 없다. edentext의 계획 문서 삭제 상태 3건은 앞서 최상위 `docs`로 이동한 결과이며 이번 의존성 설치로 생긴 변경이 아니다.

## 사용 도구

- 빌드: 기존에 설치된 Node 24.21.0을 `volta run --node 24.21.0`으로 선택했다. 시스템 기본 Node 버전은 변경하지 않았다.
- HOP 패키지 관리자: 저장소 지정 pnpm 10.33.0.
- edentext 패키지 관리자: 기존 package-lock.json에 맞춘 npm.
- Python: `/opt/homebrew/bin/python3.12`로 만든 프로젝트 전용 가상환경. 기본 Python 3.9에서는 python-hwpx를 설치할 수 없어 3.12로 구성했다.
- 설치한 Python 패키지 버전은 [잠금 목록](hwpx-tools-requirements.txt)에 기록했다. Windows 전용 pywin32는 macOS 환경에서 설치하지 않았다.

## 확인한 명령

HOP 디렉터리에서:

```sh
git submodule update --init --recursive --depth 1
pnpm install --frozen-lockfile
volta run --node 24.21.0 pnpm upstream:verify
volta run --node 24.21.0 pnpm run build:studio
```

edentext 디렉터리에서:

```sh
volta run --node 24.21.0 npm ci --no-audit --no-fund
volta run --node 24.21.0 npm run build
```

프로젝트 루트에서 Python 환경 재현:

```sh
/opt/homebrew/bin/python3.12 -m venv .venv-hwpx
.venv-hwpx/bin/python -m pip install -r docs/hwpx-tools-requirements.txt
.venv-hwpx/bin/python -m pip check
```

## 빌드 결과와 남은 검증

edentext와 HOP Studio 호스트는 빌드 오류 없이 산출물을 생성했다. edentext에서는 `::highlight` CSS 처리, 양쪽 빌드에서는 정적·동적 import 혼용과 큰 번들 경고가 발생했다. 이번 준비 작업에서는 제품 코드를 수정하지 않았다.

HOP Studio 호스트 빌드는 독립 rhwp Studio 임베드 통합이나 실제 파일 편집·저장을 검증한 것이 아니다. 독립 Studio 빌드 구성, 브라우저 편집·권한·저장 검증, Word·한컴 호환성 검사는 구현 계획 P0/P1에서 진행한다. 데스크톱 설치물과 Rust 네이티브 빌드용 의존성은 웹앱 준비 범위에 포함하지 않았다. 개발 서버나 백그라운드 테스트 프로세스는 남기지 않았다.

rhwp는 샘플·개발 자료를 포함해 작업 트리 약 5.3GB, 해당 Git 데이터 약 3.3GB를 사용한다. 서브모듈의 잠긴 버전을 유지하고 최신 브랜치로 임의 갱신하지 않는다.
