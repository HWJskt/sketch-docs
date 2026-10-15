# PowerPoint·Excel 열기와 Word 엔진 교체 검토 (2026-10-15)

## 요청 (2026-10-15 사용자)

1. PowerPoint를 여는 기능을 만든다. [storytold/deckcraft](https://github.com/storytold/deckcraft)를 쓴다.
2. Excel을 여는 기능을 만든다. [storytold/gridcraft](https://github.com/storytold/gridcraft)를 쓴다.
3. Word를 여는 기능을 [storytold/wordcraft](https://github.com/storytold/wordcraft)로 바꾸는 방향을 검토한다.
   - 기능이 줄어들면 안 된다.
   - 목적은 라이선스 강도를 줄이는 것이다. 지금 Word 엔진 edentext는 AGPL-3.0-only다.

## 조사 시점 사실 (2026-10-15)

| 리포 | 커밋 | 라이선스 | 구성 |
|---|---|---|---|
| deckcraft | `8d3e4a6` | Apache-2.0 / MIT (LICENSE-APACHE·LICENSE-MIT) | 순수 Rust. `apps/deckcraft-web` 있음 |
| gridcraft | `d9d09f0` | Apache-2.0 / MIT | 순수 Rust. `apps/gridcraft-web` 있음 |
| wordcraft | `a8c1c22` | Apache-2.0 / MIT | 순수 Rust. `apps/wordcraft-web` 있음 |

## 사용자 결정 (2026-10-15)

아래 §11 질문 5개 모두 추천안으로 정했다.

| 질문 | 결정 |
|---|---|
| PowerPoint·Excel 첫 배포 범위 | 열기·보기만. 편집·저장은 저장 계약(§5.2)을 갖춘 뒤 따로 연다 |
| 지원 형식 | `.pptx`·`.xlsx`만 먼저. 다른 형식은 형식별 지원표를 만든 뒤 추가 |
| WordCraft 노출 | 별도 검증만. 기본 Word는 edentext 유지, 사용자에게 실험판을 내놓지 않는다 |
| 새 엔진 미리 받기 | 고를 때 받기. 실측 뒤 "마지막 사용 엔진만" 검토 |
| AGPL 해소 뒤 우리 코드 라이선스 | MIT. 단 저작권·파생 코드 확인(§7.2) 뒤에만 바꾼다 |

## 단계 0a·0b 실측 (2026-10-15)

세 웹 앱을 이 리포 밖 임시 사본에서 따로 빌드하고, 우리 정적 서버(127.0.0.1)와 설치된 Chrome(헤드리스, ko-KR)으로 열어 본 결과다. 제품 코드는 바꾸지 않았다.

**도구.** wasm32 대상, `wasm-bindgen-cli` 0.2.129(세 리포 `Cargo.lock`과 같은 판), `trunk` 0.21.14, `wasm-opt` 133(binaryen).
빌드는 `trunk build --release --offline --locked`로 했다. 도구를 자동으로 내려받지 않는다.
**Rust 1.95 이상이 필요하다.** 세 리포는 `rust-version = "1.90"`이라고 적었지만, egui·eframe 0.36.2와 craft-ui가 1.95를 요구해 1.92로는 빌드가 실패했다.
그래서 upstream CI처럼 1.99.0을 기존 툴체인과 따로 설치해 `RUSTUP_TOOLCHAIN=1.99.0`으로만 썼다(기본 `stable`은 1.92 그대로).
빌드 시간은 gridcraft 134초, deckcraft 276초, wordcraft 248초였다(`CARGO_BUILD_JOBS=5`).

| 항목 | deckcraft `8d3e4a6` | gridcraft `d9d09f0` | wordcraft `a8c1c22` |
|---|---|---|---|
| WASM 원본 크기 | 29.20MB | 17.99MB | 39.38MB |
| gzip -9 / brotli 11 | 10.52MB / 6.73MB | 6.76MB / 4.58MB | 14.95MB / 9.56MB |
| Pages 파일당 25MiB(26.2MB) 한도 | **넘음** | 안 넘음 | **넘음** |
| 외부 출처 요청 | 0 | 0 | 0 |
| 그래픽 백엔드 | WebGPU·`?webgl` 둘 다 시작 | 둘 다 시작 | 둘 다 시작(로그 `BrowserWebGpu`·`Gl`) |
| 시험 문서 열기(끌어놓기) | **실패.** 시작하자마자 panic `no pids on this platform`(std 프로세스 ID를 WASM에서 호출). "Loading DeckCraft..." 화면에서 멈춤 | 열림. 수식 재계산값 맞음(3600·10000·13600, 합계 8) | 열림. 제목·본문·표 구조 표시 |
| 한국어 표시 | 확인 못 함(앱이 안 뜸) | **전부 빈 네모(□)** | **전부 빈 네모(□)** |

이로써 정해진 것:

- **한국어 글꼴은 필수 선행 작업이다.** 웹판은 OS 글꼴을 쓰지 않는다. 빌드에 한국어 글꼴(`CRAFT_FONTS_DIR` 또는 overlay)을 넣지 않으면 한국어 문서를 보여 줄 수 없다.
- **deckcraft는 지금 커밋 그대로는 웹에서 뜨지 않는다.** panic이 나는 곳은 앱의 비시험 코드에서 찾지 못했다(의존성으로 추정, 미확정). upstream 수정을 기다리거나 overlay로 고쳐야 한다.
- **deckcraft·wordcraft는 WASM 한 파일이 Pages 한도를 넘는다.** 분할, 크기 줄이기, 다른 호스팅 중 하나가 필요하다. gridcraft는 한도 안이다.
- 측정하지 않은 것: 실제 시작 시간(4초 고정 대기로만 봤다), 메모리, Safari·Firefox, 큰 문서, PPTX 표시.

## 구현 계획

Codex(codex-cli 0.162.1, `codex exec -s read-only`)가 위 세 커밋의 로컬 클론과 이 리포를 읽고 쓴 초안이다. 빌드·실행 검증은 하지 않았다.
초안의 교체 불합격 근거 4개는 원문과 대조했다(2026-10-15): `wordcraft/crates/formats/src/odt.rs` 1634행 `note`·`annotation`·`text-box` 건너뜀,
`apps/wordcraft-web/src/web.rs` 66행 `app.autosave = false`, `crates/ui-egui/src/i18n/` 에 `ko.tsv` 없음, `deckcraft/NOTICE` 의 symphonia MPL-2.0.

작성 기준: 2026-10-15  
상태: 읽기 전용 조사에 따른 구현 계획. 파일 수정·빌드·시험·네트워크 실행은 수행하지 않았다.

### 1. 권고안

1. **PowerPoint와 Excel은 별도 편집기 경로로 추가한다.** 첫 배포 범위는 `.pptx`·`.xlsx` 열기와 보기로 제안한다. 편집·저장은 별도 완료 조건을 통과한 뒤 연다.
2. **Word의 edentext → wordcraft 교체는 보류한다.** ODT 기능, 한국어 UI, 웹 복구, 파일 저장 방식에 확인된 차이가 있어 현재 상태로는 “기능 저하 없음” 조건을 충족하지 않는다.
3. **라이선스 변경은 Word 교체와 별도 단계로 처리한다.** edentext 실행 파일을 빼는 것만으로 제품의 AGPL 의무가 자동으로 사라지지 않는다. 남은 파생 코드와 우리 코드의 저작권까지 확인해야 한다.

이 계획에서 **확인**은 로컬 코드·설정으로 확인했다는 뜻이다. 브라우저 동작이나 문서 호환성을 실행으로 검증했다는 뜻은 아니다. README·ROADMAP의 성능·호환성 수치는 **upstream 설명**으로 구분한다.

### 2. 조사 기준과 경로

제품 경로는 현재 저장소 기준이다. 아래에서는 사용자 지정 craft 클론을 다음처럼 줄여 쓴다.

| 표기 | 경로 |
|---|---|
| `E/` | 제품의 `source/edentext/` |
| `D/` | 사용자 지정 `deckcraft` 클론 |
| `G/` | 사용자 지정 `gridcraft` 클론 |
| `W/` | 사용자 지정 `wordcraft` 클론 |

로컬 Git 정보에서 확인한 조사 대상은 다음과 같다.

| 프로젝트 | 전체 커밋 | Cargo 버전 | 최상위 라이선스 |
|---|---|---|---|
| deckcraft | `8d3e4a630f3657732fddcb9a4f20001e37c5b847` | 0.7.0 | `MIT OR Apache-2.0` |
| gridcraft | `d9d09f0baa912e88c5111107903fc8c640214b57` | 0.7.0 | `MIT OR Apache-2.0` |
| wordcraft | `a8c1c228d79d6a11745f4147f21e4fa78dc79b26` | 0.7.0 | `MIT OR Apache-2.0` |

세 프로젝트 모두 ROADMAP상 alpha다. 기능 개수나 Microsoft Office 대비 비율은 Sketch Docs의 지원 판정에 사용하지 않는다. 문서와 코드가 다른 항목은 고정 커밋의 코드를 우선한다. 예를 들어 WordCraft ROADMAP의 “차트·SmartArt 소실” 설명과 달리 현재 소스에는 관련 모델·보존 코드가 있으므로, 이를 일괄 미지원으로 판정하지 않는다.

환경도 다시 확인해야 한다. 제품 `package.json`은 Node **24.21.0**을 지정하지만 이번 셸의 `node --version`은 **v22.14.0**이었다. `cargo`·`rustc`·`rustup` 경로는 존재하고 `trunk`·`wasm-opt`는 현재 PATH에서 발견되지 않았다. Rust 버전·설치 target·실제 빌드 가능 여부는 **미확인**이다.

### 3. 각 craft의 웹 통합 경로

#### 3.1 공통 구조

세 `apps/*-web`은 Svelte 컴포넌트나 문서 파서 SDK가 아니라 **egui 편집기 전체를 실행하는 WASM 웹 앱**이다.

확인한 빌드 경로는 다음과 같다.

```text
Rust workspace
  → apps/<craft>-web
  → wasm32-unknown-unknown
  → Trunk + wasm-bindgen + wasm-opt 설정
  → dist/web/index.html + 해시 JS glue + 해시 WASM
  → 정적 호스팅 또는 iframe
```

근거:

- 각 `apps/*-web/Cargo.toml`, `Trunk.toml`, `index.html`, `src/main.rs`
- 각 `packaging/web/README.md`, `packaging/web/package.sh`
- 각 `Cargo.toml`: Rust edition 2024, `rust-version = "1.90"`
- 각 HTML: `data-trunk rel="rust"`, `data-wasm-opt="z"`, `data-weak-refs`
- 각 Trunk 설정: `public_url = "./"`, `filehash = true`

문서에 명시된 빌드 명령은 각 `apps/*-web`에서 `trunk build --release`다. 출력 위치는 각 리포의 `dist/web`이다. `cargo xtask wasm`은 주로 **cargo check**이며, 배포용 JS·WASM 생성이나 브라우저 실행 검사를 대신하지 않는다.

렌더러는 eframe/wgpu이며 WebGPU와 WebGL2 경로가 있다. 세 웹 소스에 `?webgl` 강제 선택 코드가 있다. SharedArrayBuffer를 사용하지 않아 별도 COOP/COEP가 필요 없다는 upstream 호스팅 설명이 있으나, Sketch Docs 헤더와의 실제 조합은 **미확인**이다.

#### 3.2 기능과 산출물 비교

| 항목 | deckcraft | gridcraft | wordcraft |
|---|---|---|---|
| 웹 UI | `SlideApp` 전체 | `SheetApp` 전체 | `WordApp` 전체 |
| 열기 | 비동기 파일 선택·드롭 | 비동기 파일 선택·드롭·부모 브리지 | 비동기 파일 선택·드롭 |
| 편집 | 슬라이드·텍스트·도형 등의 편집 코드 있음 | 셀·수식·서식 등의 편집 코드 있음 | 본문·표·서식·검토 등의 편집 코드 있음 |
| 기본 웹 저장 | Blob·anchor 다운로드 | `showSaveFilePicker` 또는 다운로드 | `showSaveFilePicker` 또는 다운로드 |
| 열린 파일 핸들 유지 | 확인한 웹 경로에 없음 | 확인한 웹 경로에 없음 | 확인한 웹 경로에 없음 |
| 부모 연동 | 별도 제품 브리지 필요 | `?host=parent` 브리지 있음 | 별도 제품 브리지 필요 |
| 웹 문서 복구 | 제품용 구현 필요 여부 실증 | 제품용 구현 필요 여부 실증 | 웹 시작 시 `autosave = false`; 복구는 데스크톱 전용 |
| Sketch Docs에서 실행 검증 | 미확인 | 미확인 | 미확인 |

근거는 각 `apps/*-web/src/web.rs`, gridcraft의 `src/host.rs`, WordCraft의 `crates/engine/src/recovery.rs`다.

**파일 선택기로 저장할 수 있다는 사실은 현재 제품의 “한 번 연결한 원본에 계속 저장” 계약과 다르다.** gridcraft는 비동기 저장 실패 시 다운로드로 우회하는 경로도 있으므로 그대로 제품 저장에 사용하지 않는다.

#### 3.3 형식별 확인 범위

| 엔진 | 코드에서 확인한 형식 경로 | 첫 지원 범위와 제한 |
|---|---|---|
| deckcraft | `crates/pptx/src/lib.rs`: `.pptx/.potx/.ppsx` 읽기, 해당 패키지 쓰기. 웹 선택기도 세 확장자 포함 | `.pptx` 우선. `.potx/.ppsx`는 별도 fixture 통과 후 추가. 구형 `.ppt`, `.odp`, 매크로 형식은 이번 지원으로 약속하지 않음 |
| gridcraft | `crates/xlsx/src/lib.rs`: XLSX 계열 읽기·쓰기, XLS·XLSB·ODS 가져오기. `crates/engine/src/io.rs`: 형식 dispatch | `.xlsx` 우선. `.xls`는 가져오기, `.xlsb/.ods`는 데이터 가져오기 수준을 별도로 표시. 선택기에 있다는 이유로 완전 호환으로 표시하지 않음 |
| wordcraft | `crates/docx/src/lib.rs`: DOCX/DOCM/DOTX/DOTM 및 암호 처리. `crates/formats`: ODT·RTF·HTML 등 | DOCX·ODT 모두 기능별 동등성 평가 대상. 지원 확장자 증가를 기존 기능 보존의 증거로 삼지 않음 |

추가로 확인한 제한은 다음과 같다.

- deckcraft는 암호 PPTX를 감지하고 열기를 거절한다.  
  근거: `D/crates/engine/src/cmd/file.rs`.
- gridcraft는 암호 통합문서를 복호화할 수 있으나 저장은 암호 없이 된다는 경고가 있다.  
  근거: `G/crates/engine/src/io.rs`의 `DECRYPTED_NOTICE`.
- PPTX·DOCX 파서는 알 수 없는 요소를 건너뛰는 경로가 있다. gridcraft에는 `ReadReport::warnings`가 있으나, 경고 0건이 전체 보존을 증명하지는 않는다.  
  근거: 각 형식 crate의 `src/lib.rs`와 패키지 reader.

#### 3.4 번들 크기·로딩·글꼴

| 항목 | 확인 내용 | 실측 상태 |
|---|---|---|
| deckcraft 크기 | 호스팅 문서는 압축으로 약 60% 감소한다고 설명 | 현재 커밋의 WASM·glue·압축 크기 **미확인** |
| gridcraft 크기 | 호스팅 문서는 압축 후 약 1/3이라고 설명 | 현재 커밋의 실제 크기 **미확인** |
| wordcraft 크기 | 호스팅 문서에 WASM 약 13MB, 압축 약 5MB 기재 | 측정 조건·현 커밋 크기 **미확인** |
| 실행 방식 | 생성 glue가 WASM 앱을 시작하고 canvas에 표시 | 시작 시간·메모리·GPU fallback **미확인** |
| 글꼴 | OS 글꼴을 읽는 네이티브 경로는 웹에서 사용할 수 없음 | 한국어 표시 품질 **미확인** |

특히 글꼴은 초기 통합의 선행 조건이다.

- deckcraft의 `crates/fonts/build.rs`는 웹에서 Inter와 BIZ UDPGothic 일부만 선택한다.
- wordcraft의 같은 파일은 웹에서 BIZ UDPGothic Regular만 추가 선택한다.
- gridcraft 웹 소스는 CJK 글꼴이 없어 한국어·일본어·중국어 UI 자동 선택을 피한다고 명시한다.
- wordcraft의 사용자 글꼴 IndexedDB 저장은 **문서 복구 기능이 아니다**.

따라서 브라우저가 시스템 한국어 글꼴을 자동으로 제공한다고 가정하지 않는다. 한국어 글꼴을 명시적인 빌드 입력으로 추가하고, 출처·해시·라이선스·크기를 함께 고정한다. `craft-fonts`는 이번에 제공된 로컬 클론에 없어 내용은 **미확인**이다.

### 4. 제품에 넣는 구조

#### 4.1 화면과 엔진 경계

다음 경로를 제안한다.

```text
/pptx, /pptx.html → 제품 셸 → 자체 호스팅 deckcraft iframe
/xlsx, /xlsx.html → 제품 셸 → 자체 호스팅 gridcraft iframe
/word            → 기존 edentext 유지
```

생성 자산은 `public/engines/deckcraft/`, `public/engines/gridcraft/`에 둔다. WordCraft는 검증 단계에서 별도 출력 폴더를 사용하고, 기본 Word 경로를 바꾸지 않는다.

수정 대상:

| 위치 | 필요한 변경 |
|---|---|
| `pptx.html`, `xlsx.html`, `src/pptx.ts`, `src/xlsx.ts` | 제품 셸 진입 추가 |
| `vite.config.ts` | 두 HTML 입력 추가 |
| `src/routes.ts` | 새 mode와 확장자 없는 URL 판정 추가 |
| `src/EditorShell.svelte` | 엔진별 준비·busy·dirty·문서 상태, 전환·이탈 검사 추가 |
| `src/EditorControls.svelte`, `index.html` | 버튼·카드·지원 범위 문구 추가 |
| `src/editorState.ts` | craft의 상태·열기 결과·오류 연결 |
| `src/engines.ts`, `src/enginePreload.ts`, `src/EngineProgress.svelte` | 엔진 종류와 로딩 진행률 연결 |

기존 셸은 마운트한 엔진을 유지하고 표시를 전환한다. 새 엔진도 같은 원칙을 따른다. egui는 canvas UI이므로 기존 Word의 `.ribbon-tabs`나 한글의 `#menu-bar`처럼 DOM 안에 헤더를 삽입하지 않고 **제품 헤더를 iframe 바깥에 둔다**.

첫 보기 버전에는 편집·저장 명령을 실제로 차단하는 모드가 필요하다. 기본 웹 앱에 완성된 제품용 읽기 전용 모드가 있다는 근거는 확보하지 못했다. 메뉴를 숨기는 것만으로 끝내지 않고 키보드·붙여넣기·드롭·직접 명령도 검사한다. 차단을 보장할 수 없으면 보기 전용 통합을 완료로 처리하지 않는다.

#### 4.2 upstream lock·mirror·overlay

현재 스크립트는 edentext·hop·rhwp 이름을 여러 곳에서 직접 열거한다. lock에 새 항목만 추가해서는 동작하지 않는다.

대상:

- [build-engines.mjs](../../scripts/build-engines.mjs)
- [upstream-git.mjs](../../scripts/upstream-git.mjs)
- [upstreams.mjs](../../scripts/upstreams.mjs)
- [mirrors.mjs](../../scripts/mirrors.mjs)
- [release-info.mjs](../../scripts/release-info.mjs)

적용 원칙:

1. craft도 전체 SHA·원본 URL·보존 mirror·라이선스를 고정한다.
2. 원본 클론에서 빌드하지 않고, 기존처럼 소유 표식이 있는 `.cache/` 복사본에서 빌드한다.
3. 변경은 `overlays/deckcraft/`, `overlays/gridcraft/`, 향후 `overlays/wordcraft/`에 둔다.
4. 패치는 `git apply --check`로 검사하고 치환은 정확한 일치 개수를 확인한다.
5. 후보 검사·실패 시 복귀·promote의 소스 해시 검사를 새 upstream에도 적용한다. HOP/rhwp의 서브모듈 관계는 유지한다.
6. 보존 mirror에 고정 커밋이 없으면 배포를 거절한다.

추가 입력도 관리해야 한다. gridcraft와 wordcraft의 UI crate는 `craft-libs`의 `craft-ui`를 Git revision `d27646a5f7c8b4fc85d9dd3213b8c88b58e0088d`에 고정한다. 해당 소스·라이선스·보존 경로는 이번 조사에서 **미확인**이다. Cargo.lock이 있다는 사실만으로 원본 소실 대비까지 끝났다고 보지 않는다.

Rust toolchain, Trunk, wasm-bindgen, wasm-opt, Cargo.lock, 글꼴 입력과 overlay 해시를 빌드 provenance에 기록한다. 후보와 정식 빌드는 이 입력을 공유하되 출력·캐시는 분리한다.

#### 4.3 엔진 manifest와 캐시

현재 `scripts/engine-manifest.mjs`는 Vite 형태의 외부 JS/CSS 참조와 특정 WASM 파일명 패턴을 찾는다. **Trunk 산출물의 loader·preload·inline module 형태를 그대로 수집할 수 있다고 가정하지 않는다.**

craft 전용 산출물 수집기를 추가해 다음을 검증한다.

- HTML·glue JS·WASM과 실제 필요한 부속 파일의 경로·바이트·해시
- 배포 하위 경로에서의 상대 URL
- 참조 파일 누락 시 빌드 실패
- 브라우저가 실제 받은 필수 파일과 manifest의 일치
- 미리 받기와 실제 시작 사이의 WASM 중복 전송 여부

WASM 전체를 첫 화면에서 무조건 추가 다운로드할지는 별도 결정한다. 권고 기본값은 **새 craft는 선택 시 로딩**이다. 백그라운드 미리 받기를 켜더라도 기존 Save-Data·2G 제외, 마지막 사용 엔진 우선, 진행 중 요청 공유를 유지한다.

`public/_headers`에는 새 해시 자산 캐시 규칙을 추가한다. HTML과 엔진 목록은 갱신 가능해야 한다. 현재 Pages 제한 검사는 파일당 25MiB·전체 20,000개이므로 **압축 전 파일 크기**로 계속 판정한다.

`public/sw.js`는 같은 출처 GET을 폭넓게 캐시한다. 새 경로가 의도 없이 오프라인 캐시에 들어가지 않도록 명시적으로 정책을 정한다. 기존 Word 오프라인 기능은 유지한다.

#### 4.4 부모 브리지

새 브리지는 다음 정보를 주고받아야 한다.

| 방향 | 계약 |
|---|---|
| 엔진 → 호스트 | 준비 완료·시작 실패·문서 이름·busy·dirty·epoch/revision |
| 호스트 → 엔진 | 바이트 열기·문서 상태 조회·활성/비활성 전환 |
| 열기 결과 | 성공/실패, 실제 형식, 표시 누락·복구·미지원 진단 |
| 향후 저장 | 특정 snapshot 내보내기와 그 snapshot에 대한 저장 성공 응답 |

모든 메시지는 `origin`, `event.source`, 프로토콜 버전, 요청 ID와 문서 epoch를 검사한다. 늦게 도착한 열기 결과가 새 문서를 덮어쓰지 않도록 한다.

gridcraft의 기존 브리지는 출발점으로 사용할 수 있지만 저장 계약은 교체해야 한다. `G/apps/gridcraft-web/src/host.rs`는 `gridcraft:save`를 보낸 뒤 다음 `sync()`에서 현재 workbook을 저장 기준으로 만든다. 부모의 디스크 쓰기 성공을 기다리는 ACK나 저장 snapshot revision이 없다. 따라서 단순 연결로 저장 완료를 표시해서는 안 된다.

### 5. 저장·OPFS 복구·탭 잠금

#### 5.1 현재 구현과 목표를 구분한다

| 영역 | 현재 확인한 구현 |
|---|---|
| Word | edentext가 파일 핸들·권한·최근 파일을 소유. 외부 변경은 `lastModified` 비교. 브라우저 자동 저장·snapshot·문서 슬롯 잠금 있음 |
| 한글 | 호스트가 파일 I/O를 소유. export의 epoch/revision·손실 보고·해시 검사를 사용. 가져온 원본 저장 제한 있음 |
| PDF | 저장 요청 직렬화, Web Locks 안 해시 재확인, 첫 덮어쓰기 전 OPFS 원본 보관·검증 |
| 공통 셸 | 엔진별 문서·busy·dirty를 유지하고 전환·이탈 판단 |

근거: `E/src/App.svelte`, `E/src/lib/storage/`, `src/HangulEditor.svelte`, `src/hangulFiles.ts`, [pdf/save.ts](../../src/pdf/save.ts), [pdf/recovery.ts](../../src/pdf/recovery.ts).

PDF의 안전장치가 모든 엔진에 이미 적용돼 있다고 설명하지 않는다. edentext의 복구본 소유권 잠금도 로컬 파일 저장 잠금과 구분한다.

#### 5.2 새 Office 편집·저장을 열 때의 필수 계약

보기 버전에서는 쓰기 API를 호출하지 않는다. 편집·저장 확장 시에는 다음을 순서대로 구현한다.

1. 호스트가 파일 핸들·열 때의 원본 바이트·fingerprint·epoch를 소유한다.
2. 내보내기 대상 revision의 불변 snapshot을 만든다. 후속 편집이 섞이지 않아야 한다.
3. 가져오기 손실과 내보내기 손실을 함께 판정한다. 경고 0건만으로 원본 저장을 허용하지 않는다.
4. 형식·보호 상태·내보내기·보존 검사를 **저장 선택기보다 먼저** 끝낸다.
5. 같은 세션의 저장·다른 이름 저장을 직렬화한다.
6. 탭 간 잠금 안에서 대상 해시를 다시 확인한다.
7. 원본 덮어쓰기 전 OPFS 사본을 저장하고 다시 읽어 해시를 확인한다.
8. `write`·`close` 성공 후 해당 snapshot revision만 저장 완료로 반영한다.
9. 취소·권한 거절·write/close 실패에서는 파일 연결·dirty·undo를 유지한다.
10. 다른 이름 저장 성공 후 다음 일반 저장은 새 대상을 사용한다.

새 Office 엔진끼리는 같은 파일을 서로 다른 엔진에서 열 수도 있으므로 공통 저장 잠금 범위를 설계한다. 외부 프로그램과의 완전한 잠금을 보장하지는 않는다.

**OPFS 원본 사본과 편집 중 복구 snapshot은 별개다.** 편집 복구에는 엔진·모델 버전, 문서 ID·epoch·revision, 이미지·opaque part가 필요하다. lossy DOCX/XLSX/PPTX export를 완전한 복구본으로 취급하지 않는다. PDF 복구 저장소를 일반화한다면 PDF 동작 보존을 먼저 검증하고, 새 엔진이 기존 PDF 사본을 예고 없이 밀어내지 않도록 보존량을 분리한다.

저장 선택기가 기존 파일을 비울 수 있다는 프로젝트의 실측 제약도 남는다. 선택 후 거절하고 되돌리는 방법을 모든 파일에 대한 무손실 보장으로 설명하지 않는다. 안전한 대상 선택 흐름까지 검증하기 전에는 새 엔진의 원본 저장을 열지 않는다.

### 6. edentext와 wordcraft 기능 대조

아래 표는 현재 제품에서 노출되거나 연결된 기능군의 정적 대조다. “코드 있음”은 동일한 품질·상호운용성을 의미하지 않는다. 교체 전에는 기능군을 개별 명령·설정·왕복 요소로 펼친 목록으로 확정한다.

| 기능군 | 현재 edentext 제품 근거 | wordcraft 근거와 차이 | 판정 |
|---|---|---|---|
| DOCX 열기·편집·저장 | `E/src/lib/import/docx.ts`, `export/docx.ts`, `App.svelte` | `W/crates/docx/`, `engine/src/io.rs`에 읽기·쓰기 | 동등성 **미확인** |
| ODT 열기·편집·저장 | `E/src/lib/import/odt.ts`, `export/odt.ts` | `W/crates/formats/src/odt.rs`는 제한된 flow 모델 사용 | 아래 항목에서 저하 확인 |
| ODT 각주·주석·글상자 | `E/.../extensions/notes.ts`, `comment.ts`, `textBox.ts`와 ODT 입출력 | `W/crates/formats/src/odt.rs`가 `note`, `annotation`, `text-box`를 `skip` | **저하 확인** |
| 템플릿 열기·저장 | `E/.../export/template.ts`, `saveFile.ts`, `handleSaveTemplate`: OTT·DOTX | DOCX 계열 template 지원. formats export에 OTT 등록 없음; 웹 선택기에도 OTT 없음 | OTT 동등 경로 없음 |
| 암호 DOCX·ODT | `E/src/lib/crypto/protect.ts`, `odf.ts`, `ooxml.ts` | DOCX 암호 입출력 있음. `save_bytes_with`는 Word 패키지만 암호화 | **암호 ODT 저하** |
| 새 문서·원본 저장·다른 이름 저장 | `E/src/App.svelte`, `saveFile.ts`, 제품 overlay | 웹 저장 선택기 있음. 열린 핸들을 유지하는 제품 계약 없음 | **통합 기능 저하** |
| 최근 파일·권한 재요청 | `E/.../storage/recentFiles.ts`, `saveFile.ts` | 웹에서 동등한 핸들 복원 경로 미확인 | 교체 차단 항목 |
| 자동 저장·복구·보존 설정 | `E/.../storage/autosave.ts`, `snapshots.ts`, `docScope.ts` | 웹은 `autosave = false`, recovery는 데스크톱 전용 | **저하 확인** |
| 한국어 기본 UI | `overlays/edentext/ko.ts`, `product.patch` | `W/crates/ui-egui/src/i18n/`에 한국어 UI 없음 | **저하 확인** |
| 한글 입력·동아시아 글꼴·루비 | `E/.../extensions/ruby.ts`, `fontFamily.ts`, import/export, 브라우저 편집 | IME·동아시아 서식 코드 있음. 웹 기본 글꼴의 한국어 충족 및 입력 실증 없음 | **미확인** |
| 실행 취소·찾기·바꾸기·클립보드 | `E/.../extensions/stateHistory.ts`, `searchReplace.ts`, `paste.ts` | engine 명령 있음. 웹 services에는 데스크톱 rich clipboard 연결과 차이 | 웹 서식 붙여넣기 **미확인** |
| 문자·문단·스타일·목록·탭 | `E/.../editor/extensions.ts`, `styles/` | `W/crates/engine/src/cmd/` 및 doc 모델 | 기능별 동등성 **미확인** |
| 표·병합·크기·스타일·정렬·수식 | `E/.../extensions/table*.ts` | WordCraft 표 명령·layout·DOCX 처리 있음 | 다쪽 표·ODT 왕복 포함 **미확인** |
| 이미지·도형·글상자·배치 | `E/.../extensions/image.ts`, `textBox.ts`, import/export | WordCraft object·layout·DOCX 코드 있음 | 표시·편집·왕복 각각 **미확인** |
| 용지·여백·구역·단·머리말·쪽 번호 | `E/.../storage/`, pagination·header/footer 코드 | WordCraft section·layout·field 코드 있음 | DOCX 동등성 미확인, ODT 별도 결손 |
| 수식·목차·인용·색인·상호참조 | `E/.../extensions/formula.ts`, `tableOfContents.ts`, `bibliographyEntry.ts`, `indexEntry.ts`, `crossReference.ts` | 해당 WordCraft 명령·모델 있음 | 형식별 보존 **미확인** |
| 변경 추적·댓글·검토 출력 | `E/.../extensions/trackChanges.ts`, `comment.ts`, `export/reviewPrint.ts` | DOCX 검토 기능 있음. ODT revisions 코드도 있으나 ODT annotation은 건너뜀 | 완전 동등 아님 |
| 맞춤법·문법·동의어·자동 입력 | `E/.../spell/`, `extensions/spellCheck.ts`, `grammarCheck.ts`, `autoText.ts`, `wordCompletion.ts` | proof crate 있음. 일부 사전은 시스템 설치본 사용, WASM에서는 시스템 사전 탐색 불가 | 기존 언어·사용자 설정 동등성 미확인 |
| 선택적 AI 도우미·변경 검토 | `E/src/lib/ai/`, AI 저장·UI | CLI/MCP 자동화는 있으나 기존 브라우저 AI 도우미의 대체가 아님 | **저하 확인** |
| PDF 내보내기·인쇄 | `E/.../export/pdf.ts`, App의 인쇄 경로 | `W/crates/pdf/`, 웹 PDF 인쇄 경로 있음 | 결과·검토 출력·글꼴 **미확인** |
| 오프라인 Word·셸 전환 | `public/sw.js`, `EditorShell.svelte`, 기존 회귀 시험 | 자체 호스팅 가능하나 제품 오프라인·상태 브리지 없음 | 통합 구현 필요 |

현재 Word의 HWP/HWPX 열기 연결은 유지해야 한다. 다만 저장 메뉴에서 숨긴 Word→한글 변환 코드를 이미 제공 중인 사용자 기능으로 계산하지 않는다. 최종 형식 변환 목표는 `docs/project-goals.md`에 계속 남긴다.

#### 교체 판정

**현재 고정 커밋의 WordCraft를 그대로 교체하는 안은 불합격이다.**

추천 선택은 **edentext 유지 + WordCraft 독립 검증**이다. 실험판을 병행하더라도 기본 Word 기능을 줄이지 않고, 문서를 자동 이동시키지 않는다. 이 기간에는 라이선스 완화 목표가 달성됐다고 표시하지 않는다.

교체를 다시 심사하려면 다음이 모두 필요하다.

- 확인된 기능 결손 해소
- 기존 기능 목록의 미확인 항목 해소
- 기존 DOCX·ODT 문서군에서 내용·서식·편집·저장·복구 회귀 통과
- 기존 브라우저 저장 데이터와 최근 파일의 이행·복귀 경로
- 기존 Word 오프라인 동작 유지
- 실제 Word·LibreOffice와 한국어 IME 수동 확인

새 엔진의 다른 장점으로 필수 기능 결손을 상쇄하지 않는다.

### 7. 라이선스 효과와 전환 조건

이 절은 로컬 라이선스 원문에 따른 검토다. 외부 법률 자료 조회와 저작권 귀속 확인은 수행하지 않았다.

#### 7.1 edentext 제거의 의미

현재 제품 `LICENSE`와 `package.json`은 AGPL-3.0-only다. 라이선스 고지와 정보 창도 AGPL·EdenText를 명시한다.

| 선택 | AGPL 관점의 효과 |
|---|---|
| deckcraft·gridcraft만 추가 | 기존 edentext와 제품 AGPL 상태 유지 |
| WordCraft를 추가하고 edentext도 제공 | edentext 및 그 수정본에 대한 의무 유지 |
| UI만 WordCraft로 바꾸고 AGPL 파서·변환·복구 코드를 재사용 | AGPL 코드가 남으므로 목적 달성으로 볼 수 없음 |
| edentext 실행 코드와 파생 부분 제거, 남은 코드의 권리·라이선스 정리 | 새 배포판의 AGPL 의존성 해소를 검토할 수 있음 |
| 별도 허가·재라이선스 확보 | 대안이지만 현재 그런 허가의 존재는 미확인 |

브라우저에 전달하는 JS/WASM도 배포 대상이다. 정적 사이트이거나 iframe으로 분리했다는 사실만으로 의무 면제를 가정하지 않는다. 로컬 `LICENSE` §5·6·13을 기준으로 현행 소스 제공을 유지한다.

“완전히 뺀다”는 것은 **새 배포판과 그 빌드에 AGPL 대상 코드가 남지 않도록 하는 것**이다. 사용자의 로컬 원본 클론이나 과거 Git 이력을 삭제하라는 뜻이 아니다.

#### 7.2 제품 자체 LICENSE 변경

- 우리 독립 코드의 저작권·재라이선스 권한을 전부 보유한다면 새 버전에 MIT나 Apache-2.0을 제공할 수 있다.
- 과거 AGPL로 공개했다는 사실만으로 저작권자가 자기 코드에 새 허가를 줄 수 없게 되지는 않는다.
- 이미 받은 사람의 과거 AGPL 권리는 회수되지 않는다. 과거 배포판의 고지·대응 소스도 계속 구분해 제공한다.
- 외부 기여 코드나 edentext 파생 부분은 우리 이름으로 일괄 재허가할 수 있다고 가정하지 않는다.
- 커밋 작성자 목록만으로 저작권 귀속이 증명되지는 않는다. 현재 권리 보유 범위는 **미확인**이다.

변경 전 파일별로 독립 작성·upstream 복사·파생 수정·외부 기여를 분류한다. `overlays/edentext/product.patch`처럼 upstream 수정 문맥을 포함하는 자료도 검토한다.

WordCraft로 복구 데이터를 이행하면서 edentext의 AGPL serializer를 새 배포판에 남기는 방식은 피한다. AGPL 유지 기간에 내보내기를 제공하거나, 별도로 확인한 독립 이행 경로를 준비한다.

#### 7.3 허용 라이선스 외에 남는 의무

세 craft의 `MIT OR Apache-2.0`은 선택형이다. 모든 전이 의존성과 자산이 같은 라이선스라는 뜻은 아니다.

- **deckcraft의 Symphonia는 MPL-2.0이다.**  
  근거: `D/crates/media/Cargo.toml`, `D/NOTICE`. AGPL과 다른 범위의 소스·고지 의무가 남을 수 있다. 실제 WASM 의존 집합과 해당 소스 제공을 확인한다.
- **HOP/rhwp는 MIT로 유지할 수 있다.** 최상위 저작권·허가·면책문과 개별 의존성·폰트 고지는 보존한다.
- gridcraft·wordcraft의 `craft-libs` 및 모든 Cargo 전이 의존성은 실제 WASM target 기준으로 고지를 수집한다. 현재 npm 수집기만으로는 처리되지 않는다.
- MIT 선택 시 해당 저작권·허가문을 포함한다. Apache 선택 시 §4의 라이선스·변경 고지·관련 NOTICE 보존 조건도 적용한다.
- `ATTRIBUTION.md`는 자산별 출처 추적에 사용하고, 실제 포함한 폰트·아이콘·사전의 독립 조건을 함께 지킨다.
- ArtCraft 브랜드 파일은 코드와 같은 자유 라이선스가 아니다. 각 README와 `docs/brand/LICENSE-brand.txt`가 수정판의 제거를 요구하므로 제품 overlay에서 해당 사용을 제거하거나 대체한다. 법적 출처 고지는 유지한다.

`release-info.mjs`에 Cargo·자산 고지 수집을 추가하고, 정보 창은 실제 release metadata를 표시하게 한다. 라이선스 변경 때는 루트 `LICENSE`, `package.json`, 고지 생성기의 하드코딩, `AboutProduct.svelte`, README를 함께 바꾼다.

### 8. 완료 조건과 시험 설계

#### 첫 PowerPoint·Excel 보기 배포

| 완료 조건 | 검증 |
|---|---|
| 카드·버튼·직접 URL·뒤로/앞으로·새로고침이 같은 엔진을 가리킴 | 경로 계약 시험·Pages형 정적 서버 회귀 |
| PPTX 슬라이드, XLSX 시트·값·수식 표시·기본 서식을 탐색 | 모델 단언과 canvas 렌더 비교를 함께 사용 |
| 한국어 제목·본문·셀·파일명이 표시됨 | 글꼴을 고정한 한국어 fixture 및 수동 확인 |
| Word·한글·PDF 전환 후 기존 문서·저장 대상·dirty·undo 유지 | 기존 통합 시험 확장 |
| 보기 모드에서 문서 변경·저장 없음 | 편집 명령·키보드·붙여넣기·writable 호출 검사 |
| 실패한 열기가 기존 문서를 보존 | 손상·미지원·시간 초과 fixture |
| 기본 작업 중 외부 출처 요청 0건 | 브라우저 요청 로그 |
| 실제 필수 자산이 manifest에 있고 중복 WASM 전송 없음 | 네트워크·manifest 대조 |
| 일반·후보 검증에 새 시험 포함 | 의도적 실패 fixture로 게이트 등록 확인 |
| 라이선스·크기·배포 해시 검사 통과 | `npm run verify` |

fixture는 개인정보 없는 자체 생성 자료로 만들고 생성기와 기대값을 함께 관리한다. 원본 업무 문서는 저장소에 넣지 않는다.

PPTX는 텍스트·한국어·이미지·그룹·표·차트·마스터·노트·전환을, XLSX는 여러 시트·날짜·숫자 서식·병합·수식·차트·조건부 서식을 분리한다. 미지원 요소가 있는 파일에는 표시 누락 가능성을 안내한다. 암호·매크로·서명·손상·ZIP 팽창 사례는 일반 문서와 구분한다.

렌더 성공은 “canvas가 비어 있지 않음”만으로 판정하지 않는다. 핵심 문자열·시트/슬라이드 수·구조와 기준 이미지의 잘림·겹침·누락을 함께 확인한다. XLSX는 저장된 계산값과 엔진 재계산 결과의 차이도 기록한다.

### 9. 단계별 구현 계획

아래 명령은 **향후 구현 시 실행할 검증 명령**이다. 이번 조사에서는 실행하지 않았다. 새 시험·스크립트 이름은 제안이며, 만드는 단계에서 실제 CLI와 함께 확정한다.

공통 규칙:

- 단계마다 검증 후 독립 커밋한다.
- 새 단위 시험은 `package.json`과 `verify.mjs`에 함께 등록한다.
- 산출물 검사는 빌드 뒤, `.vite` 검사 자료를 제거하기 전에 실행한다.
- 브라우저 러너는 전달된 `TEST_DIST`를 사용하고 스스로 재빌드하지 않는다.
- 테스트 서버·브라우저는 `finally`에서 닫는다.
- 아래 단계에서 upstream 명령은 원본이 아닌 **빌드 복사본**에서 실행한다.

| 단계 | 작업·완료 조건 | 검증 명령 |
|---|---|---|
| 0a. 환경·기준선 | Node 24.21.0과 고정 Rust/Trunk 도구 조합 준비. 기존 제품 시험 결과·전송량·문서군 기록 | `node --version`, `rustc --version`, `cargo --version`, `trunk --version`, `wasm-opt --version`, `npm run verify` |
| 0b. 독립 웹 실증 | 세 웹 앱을 별도 복사본에서 빌드·실행. 크기, 한국어, WebGPU/WebGL2, 입력·저장·외부 요청 기록 | 각 웹 디렉터리의 `trunk build --release`; 제안 러너 `node scripts/office-probe/run.mjs --dir <scratch>` |
| 1. upstream 관리 확장 | 새 엔진을 빌드하기 전에 sync·candidate·restore·mirror 대상 확장. 기존 보호 동작 유지 | `npm run test:contracts`, `npm run verify` |
| 2a. deckcraft 재현 빌드 | 고정 입력·overlay로 일반/후보 출력 생성. 원본 클론 변경 없음 | `npm run prepare:engines`, `npm run verify` |
| 2b. deckcraft 고지 | Cargo·자산·MPL 고지와 source 경로 포함. 누락 시 실패 | `npm run test:contracts`, `npm run verify` |
| 2c. deckcraft 자산 목록 | Trunk 자산 수집기, MIME·경로·캐시 검사 통과 | `npm run build`, 신규 manifest 시험, `node tests/regressions.mjs` |
| 3a. deckcraft 보기 브리지 | 열기·진단·상태·읽기 전용 차단·실패 보존 구현 | 제안 `TEST_DIST=dist node tests/deckcraft.integration.mjs` |
| 3b. PowerPoint 제품 진입 | 카드·헤더·URL·전환 연결. 기존 3개 엔진 회귀 없음 | `npm run verify` |
| 4a~4c. gridcraft 추가 | 빌드·고지/manifest·보기 브리지를 각각 별도 단계로 수행. 기존 부모 브리지의 무응답 저장 완료 경로 비활성화 | 각 단계 `npm run test:contracts`; 제안 `TEST_DIST=dist node tests/gridcraft.integration.mjs` |
| 4d. Excel 제품 진입 | 시트 탐색·전환·URL·한국어·기존 엔진 상태 유지 | `npm run verify` |
| 5. 보기 배포 준비 | 성능·한도·문서군·미지원 표 확정. CI에 Rust 도구와 새 러너 등록 | `npm run verify`, `npm run upstream:check -- --current`, `npm run build` |
| W1. Word 동등성 기준선 | 위 대조표를 개별 기능·fixture로 확장하고 현재 edentext 결과 고정 | 기존 verify + 제안 Word 동등성 러너 |
| W2. WordCraft 결손 해소 | ODT·OTT·암호 ODT·한국어·AI·복구·파일 계약을 기능군별 구현 | 복사본의 `cargo test --locked -p wordcraft-docx`, `-p wordcraft-formats`, `-p wordcraft-engine` 및 웹 동등성 러너 |
| W3. 이행·복귀 검증 | 기존 복구 데이터·최근 파일·오프라인·파일 연결 이행. 실패 시 기존 자료 유지 | 신규 이행 장애 시험, 기존·신규 Word 브라우저 시험 |
| W4. 기본 Word 교체 | 모든 필수 기능 동등성 통과 후 `/word` 전환. 기존 시험을 삭제해 통과시키지 않음 | `npm run verify`, 후보 검증, 실제 Word·LibreOffice·IME 확인 |
| L. 라이선스 전환 | 권리 확인, 남은 AGPL 코드·산출물 조사, 고지·metadata 갱신 | 새 배포판 의존성/파일 목록 검사와 `npm run verify` |

새 편집·저장 기능을 선택하면 보기 배포 뒤 **브리지 snapshot → 편집 복구 → 사본 저장 → 원본 저장** 순서로 별도 단계를 추가한다. 각 단계는 취소·실패·늦은 응답·두 탭 저장을 검증한다. OOXML 보존 검사는 PDF 비교기를 그대로 쓰지 않고, 패키지 part·관계·내용·미편집 요소를 형식별로 비교한다.

배포는 기존 게이트를 유지한다.

- `productHash`에 새 HTML·도구/글꼴 lock 등 빌드 입력 포함
- 새 브라우저 시험을 일반·후보 verify와 CI에 등록
- `dist` 해시, 공개 커밋, mirror pin, 파일 제한 검사 유지
- push·배포는 명시 요청 시에만 수행
- 배포 뒤 새 경로를 포함한 `npm run test:live` 실행

### 10. 주요 리스크

| 리스크 | 대응·중단 기준 |
|---|---|
| alpha 파서의 누락을 정상 문서로 오인 | 가져오기 진단 표시. 원본 쓰기는 독립 보존 검증 전 차단 |
| 한국어 글리프 누락 | 웹 글꼴을 명시적으로 포함하고 fixture 검증. 설치된 OS 글꼴에 기대지 않음 |
| 큰 WASM·여러 GPU context | 크기·시작 시간·메모리 기록. 선택 로딩 우선, 비활성 엔진의 실행 부하 측정 |
| 큰 ZIP·수식·이미지로 UI 정지 | 제품 입력·팽창·시간 한도 설정. 같은 메인 스레드의 타이머만으로 중단 가능하다고 가정하지 않음 |
| 숨겨진 craft가 계속 실행 | 활성 상태를 브리지로 전달. 해제는 snapshot 복구 검증 후 도입 |
| 저장 바이트 전송을 저장 완료로 오인 | 호스트 디스크 성공 ACK와 snapshot revision을 연결 |
| Word 기준선을 새 엔진에 맞춰 낮춤 | 기존 fixture·기능 목록 유지. 의도적 기능 축소는 현재 요청의 교체 성공으로 인정하지 않음 |
| 최상위 MIT만 보고 라이선스 완료 선언 | 실제 WASM 의존 집합·MPL·폰트·Git 의존성까지 수집 |
| AGPL 제거 후 과거 소스도 정리 | 과거 릴리스·소스 링크와 새 배포판을 분리해 유지 |

### 11. 사용자 결정이 필요한 질문

| 질문 | 선택지 | 추천 |
|---|---|---|
| PowerPoint·Excel 첫 배포 범위는? | ① 열기·보기 ② 편집·사본 저장 ③ 원본 저장까지 | **①**. 현재 요청을 먼저 독립 검증하고 저장 위험을 분리 |
| “등”에 포함할 형식은? | ① PPTX·XLSX 우선 ② POTX/PPSX·XLS/XLSB/ODS 추가 ③ 매크로·암호까지 | **①**, 이후 형식별 지원표로 추가 |
| WordCraft 평가를 사용자에게 노출할까? | ① 별도 검증만 ② 실험판 병행 ③ 즉시 기본 교체 | **①**. 현재는 확인된 기능 저하가 있어 ③ 불가 |
| 새 craft를 첫 화면에서 미리 받을까? | ① 선택 시 로딩 ② 마지막 사용 craft만 ③ 전부 | **①**, 실측 뒤 ② 검토 |
| AGPL 의존성 해소 후 우리 코드 라이선스는? | ① MIT ② Apache-2.0 ③ 현행 AGPL 유지 | 단순한 허가가 목적이면 **①**. 특허 허가 조항을 중시하면 ②. 권리 확인 후 결정 |

### 12. 점검하지 못한 영역

- 세 craft의 실제 빌드 성공, 현 커밋의 산출물 크기·시작 시간·메모리
- WebGPU/WebGL2 fallback, 한국어 글꼴·IME·접근성·웹 클립보드
- 실제 Office 문서의 표시·왕복과 PowerPoint·Excel·Word·LibreOffice 재열기
- OS 파일 선택기·권한 창·프린터·Safari
- `craft-fonts`, `craft-libs` 원문과 전체 WASM 전이 의존성의 라이선스
- 우리 코드·외부 기여의 저작권 귀속과 재라이선스 권한
- 변경 후 일반·후보·CI·실배포 회귀

이 항목들은 구현 단계의 검증 과제다. 현재 계획에서 실행 검증 완료나 무손실 호환성을 주장하지 않는다.
