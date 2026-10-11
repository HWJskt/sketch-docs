# Word와 한글 웹에디터 기술 스택 제안

기준일: 2026-10-11

이 문서의 소스·테스트 경로는 별도 표기가 없으면 `source/edentext/`를 기준으로 한다. 계획 문서는 프로젝트 최상위 `docs/`에서 관리한다.

[개발 목표](../project-goals.md)를 달성하기 위해 기존 edentext의 Svelte·TipTap 구조를 유지하고, HWP·HWPX 편집에는 rhwp의 브라우저 엔진을 연결하는 구성을 권장한다. 아래 선택은 기술 제안이며 의존성 설치나 채택 완료를 의미하지 않는다.

착수 작업과 단계별 통과 기준은 [구현 계획](../implementation-roadmap.md)을 따른다. 새 문서의 DOCX/HWPX 저장을 확인하기 위한 최소 양방향 변환은 초기 실증에 포함한다.

## 권장 구성

| 영역 | 기술 | 선택 이유 |
|---|---|---|
| 앱과 공통 UI | Svelte 5, TypeScript, Vite, 기존 CSS | 현재 코드와 UI를 재사용한다. 서버 렌더링 요구가 없어 프레임워크 교체 없이 정적 웹앱으로 배포한다. |
| DOCX·ODT 편집 | 기존 TipTap 3 / ProseMirror | 현재 편집 명령·확장·문서 모델과 실행 취소를 유지한다. |
| DOCX 입출력 | 기존 DOCX importer와 `docx` 기반 exporter | 서식·표·이미지·구역 처리를 포함한 기존 구현과 회귀 검사를 재사용한다. |
| HWP·HWPX 편집 | rhwp Studio, `@rhwp/editor`, rhwp Rust/WASM | 브라우저에서 파싱·조판·입력·HWP/HWPX 저장을 처리한다. |
| 엔진 연결 | TypeScript 어댑터와 rhwp MessageChannel API | 앱의 파일 관리와 엔진별 문서 상태를 분리한다. |
| 로컬 파일 | File System Access API | 파일 핸들로 원본 저장과 저장 위치·이름 선택을 구현한다. |
| 복구와 최근 문서 | IndexedDB, 기존 저장 모듈 | 문서 스냅샷·파일 핸들·메타데이터를 보관한다. localStorage는 작은 설정 위주로 유지한다. |
| 형식 간 변환 | TypeScript 변환 계층, DOCX 모델 ↔ HWPX 지원 요소 매핑 | 일반 편집 중 변환을 피하고 명시적 형식 변환 시에만 적용한다. 이 계층은 새로 구현해야 한다. |
| 테스트 | Vitest, 기존 `playwright-core`, Word·한컴오피스 호환성 검사 | 로직·브라우저 동작·실제 파일 호환성을 따로 검증한다. |
| 배포 | HTTPS 정적 호스팅, 버전 고정한 Studio·WASM·글꼴 자산 | 문서 처리 서버 없이 배포한다. 초기에는 특정 호스팅 업체에 종속시키지 않는다. |
| 보조 검증 | hwpx-skill의 고정 버전 Python 도구 | 테스트 문서·템플릿 생성과 구조 검증에 사용한다. 사용자 브라우저의 실행 의존성으로 넣지 않는다. |

Node.js와 npm은 기존 앱의 개발·빌드 도구로 사용한다. Rust·wasm-pack은 rhwp 엔진을 수정하거나 WASM을 재생성할 때 필요한 개발 도구이며 사용자 설치 요건이 아니다. 기존 lockfile을 유지하고, rhwp SDK·Studio·WASM은 서로 맞는 릴리스와 커밋으로 고정한다.

## 엔진과 UI 경계

DOCX·ODT는 TipTap 문서로, HWP·HWPX는 rhwp 문서로 유지한다. 한글 문서를 여는 즉시 TipTap으로 바꾸면 표현할 수 없는 한글 요소가 사라질 수 있으므로 기본 편집 경로에 이 변환을 넣지 않는다.

공통 어댑터는 열기, 새 문서, 내보내기, 명령 실행, 상태 조회, 변경 구독, 종료를 담당한다. 파일 선택기·저장·최근 문서·복구는 상위 앱이 소유한다. 내보내기 결과에는 파일 바이트, 형식, 문서 버전과 보존 손실 보고를 함께 연결한다. 저장 직렬화 중 새 변경이 생기면 해당 변경까지 저장된 것으로 처리하지 않는다.

우선 rhwp iframe을 자체 호스팅하고 기본 명령부터 공통 UI로 연결한다. 공개 명령 API로 처리할 수 없는 기능은 제한된 어댑터 확장으로 추가한다. 공개 API를 우선 사용하고 엔진 내부 DOM이나 개발용 전역 변수에 의존하지 않는다. iframe을 DOM의 다른 부모로 옮기지 않고 컨테이너를 유지해 문서 재로드를 방지한다.

초기 렌더러는 rhwp의 Canvas2D 경로를 사용한다. CanvasKit 전환은 문서별 표시 품질과 성능을 측정한 뒤 판단한다. Worker 분리는 초기 전제에 넣지 않는다. rhwp의 글꼴 측정·Canvas·DOM 의존성을 확인하고 실제로 분리 가능한 무거운 작업에만 도입한다.

## 로컬 저장 설계

완전 지원의 첫 검증 대상은 데스크톱 Chrome·Edge다. 실제 사용 가능 여부는 브라우저 이름뿐 아니라 `showOpenFilePicker`, `showSaveFilePicker`와 쓰기 권한 기능을 검사한다. HTTPS 또는 개발용 신뢰 가능한 로컬 환경에서 동작하도록 한다.

1. 열기에서 얻은 `FileSystemFileHandle`을 문서에 연결한다. 파일 형식은 확장자와 내부 구조를 함께 검사한다.
2. 저장 시 연결된 핸들의 쓰기 권한과 외부 변경 여부를 확인하고, 선택한 형식으로 직렬화한 결과를 기록한다.
3. 최초 저장과 다른 이름으로 저장은 앱에서 형식을 먼저 선택한 뒤 사용자 클릭에 이어 저장 선택기를 연다. 긴 비동기 내보내기 뒤 선택기를 호출해 사용자 활성화가 만료되는 경로를 피한다.
4. 쓰기와 스트림 닫기가 성공한 뒤에만 파일 연결·이름·저장된 버전을 갱신한다. 실패 시 미저장 상태를 유지하고 스트림을 정리한다.
5. 손실 보고가 있으면 원본에 쓰기 전에 안내하고 별도 저장 또는 취소를 선택하게 한다. 현재 rhwp의 byte-only embed export는 손실 보고를 전달하지 않으므로 reported export와 연결하는 API 확장을 실증한다.
6. 브라우저 재시작 후 핸들이 남아 있어도 쓰기 권한은 재확인한다. 일반 파일 드롭은 원본 쓰기 핸들을 주지 않을 수 있으므로 지원 API로 핸들을 얻거나 첫 저장에서 대상을 명시적으로 선택하게 한다.
7. 다운로드 방식은 제한 지원이다. 다운로드 시작을 디스크 기록 완료나 원본 갱신으로 표시하지 않는다. 복구본 유지 정책도 직접 저장 경로와 구분한다.

브라우저 내부 IndexedDB 또는 OPFS에 저장된 데이터는 사용자가 지정한 로컬 파일을 대신하지 않는다. 파일 핸들의 크기·수정 시각·필요 시 해시로 외부 변경을 감지하되 완전한 운영체제 파일 잠금을 보장한다고 설명하지 않는다.

## 자체 호스팅과 데이터

SDK 기본 외부 데모 주소 대신 제품이 관리하는 `studioUrl`을 지정한다. Studio·WASM·글꼴을 고정 버전으로 배포하고 HWP 문서 진입 시 지연 로딩한다. 문서 바이트를 보내는 메시지의 origin·세션과 capability를 확인한다. 같은 버전의 배포 자산만 조합되도록 경로와 캐시를 관리한다.

기본 작업에는 백엔드 API나 계정 DB를 추가하지 않는다. AI는 기존 클라이언트 구조를 검토해 선택적으로 연결하되 기본 문서 저장과 분리한다. PWA 설치와 오프라인 캐싱은 후속 개선이며 로컬 파일 저장의 필수 조건이 아니다.

글꼴은 재배포 가능한 한국어 웹폰트를 제품에 포함하고 사용 가능한 로컬 글꼴을 선택적으로 활용한다. 대체 글꼴로 인한 배치 차이를 검사한다. 기존 edentext의 라이선스 표기는 AGPL-3.0-only이며, HOP와 rhwp의 MIT 표기만으로 전체 제품의 라이선스를 MIT로 변경하지 않는다. 채택한 코드·글꼴·템플릿의 고지와 배포 조건을 각각 관리한다.

## 단계와 검증

| 순서 | 산출물 | 판단 기준 |
|---|---|---|
| 1 | 자체 호스팅 rhwp 실증 | HWP/HWPX 본문·표 수정, 원래 형식 저장, 실제 한컴 재열기 |
| 2 | 엔진 어댑터와 로컬 파일 저장 | DOCX·HWP·HWPX 원본 저장 및 다른 이름으로 저장, 새 DOCX/HWPX 생성 |
| 3 | 공통 UI와 복구 | 단축키·메뉴·변경 상태·문서 전환·새로고침 복구 |
| 4 | 보존 품질과 형식 변환 | 표·이미지·글상자·수식·구역의 기능별 검사와 손실 안내 |
| 5 | AI와 최종 호환성 | 엔진별 AI 변경 검토·취소, 브라우저·Word·한컴 문서군 검사 |

선택기와 실제 디스크 쓰기, 한글 IME는 모의 API 검사만으로 통과 처리하지 않는다. 실제 브라우저·운영체제에서 검사한다. Word·한컴은 제품 실행 의존성이 아니라 호환성 검증 환경으로 사용한다. 현재 추천의 채택 여부는 1단계 실행 결과와 지원 문서군의 보존 품질로 판단한다.

## 근거

- 현재 프로젝트: `package.json`, `src/App.svelte`, `src/lib/export/saveFile.ts`, `docs/architecture/import.md`, `docs/architecture/export.md`.
- [HOP 엔진 경계](https://github.com/golbin/hop/blob/80888af2b8c8a18aea16f824d2d92309a290b1ad/docs/architecture/UPSTREAM.md).
- [HOP의 rhwp 고정 버전](https://github.com/golbin/hop/blob/80888af2b8c8a18aea16f824d2d92309a290b1ad/config/rhwp-upstream.json): v0.8.7, 커밋 `1a76570e833917d15817415a53c09ad61ab3203f`. 도입 검증 기준 후보이며 최신 버전이라는 의미는 아니다.
- [rhwp 임베드 API와 자체 호스팅](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/npm/editor/README.md).
- [rhwp 저장 결과와 손실 보고 계약](https://github.com/edwardkim/rhwp/blob/1a76570e833917d15817415a53c09ad61ab3203f/rhwp-studio/src/command/save-document-format.ts).
- [저장 선택기 조건과 브라우저 제한](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker).
- [파일 쓰기 스트림](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable).
- [hwpx-skill](https://github.com/jkf87/hwpx-skill/tree/ba90fc5ae15f4aead8dab4f9d69d4830b9569859).
