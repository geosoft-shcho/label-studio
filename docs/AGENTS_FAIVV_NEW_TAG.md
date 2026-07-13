# Faivv LSF — 새 태그 추가 Agent 가이드 (object / control / view)

Label Studio Frontend(fork)에 **새 XML 태그**를 추가할 때, 구현 전에 **태그 종류를 먼저 선택**한다.  
종류를 잘못 고르면 Registry·View children·저장 계약이 전부 어긋난다.

대상: `web/libs/editor/src/tags/{object,control,visual}/` 및 연동 `components/`.

관련 커스텀 목록: [FAIVV_CUSTOMIZATIONS.md](./FAIVV_CUSTOMIZATIONS.md)

---

## 1. 작업 시작 체크리스트 (필수)

코드 작성 **전에** 아래를 순서대로 결정한다.

1. **사용 목적 한 줄로 적기** (예: “선택 오디오 구간에 파일 첨부”)
2. **object / control / view 중 하나 선택** (아래 §2 결정 트리)
3. **기존 태그 재사용·위임 가능 여부** 확인 (새 태그 없이 MultimodalTimeline처럼 오케스트레이션만으로 충분한지)
4. **저장 계약** — result `from_name` / payload가 faivv-flow `saveFromLsfResults`와 충돌하지 않는지
5. **이름 동기** — Dart `label_studio_v2_config.dart` ↔ `faivv-lsf-config.js` ↔ fork TagAttrs
6. 해당 폴더 `components/*/AGENTS.md`가 있으면 **먼저 읽고** 수정

---

## 2. 결정 트리: object vs control vs view

```
무엇을 하나?
│
├─ task.data의 미디어·텍스트를 화면에 보여 주고
│  그 위에서 region을 그리거나 선택하는가?
│     → Object  (Audio, Video, Image, Text, Paragraphs…)
│
├─ Object(toName)에 붙어 라벨·분류·도구·부가 결과(result)를
│  만들거나, 선택 상태를 다루는가?
│     → Control (Labels, VideoRectangle, TextArea, SegmentAttachments,
│                MultimodalTimeline…)
│
└─ 레이아웃·헤더·스타일·가시성만 담당하고
   annotation result의 from_name이 되지 않는가?
      → Visual (View, Header, Style, Collapse/Panel…)
```

### Object (`tags/object/`)

| 맞는 경우 | 맞지 않는 경우 |
|-----------|----------------|
| `$video`, `$audio`, `$frames` 등 task 값을 로드 | 다른 태그를 모아 “보여 주기만” (→ Control 오케스트레이터 또는 Visual) |
| region 타입이 Object에 등록됨 (`Registry.addRegionType`) | 파일 첨부 payload만 export (→ Control) |
| `ObjectBase` + syncManager 등 media 수명주기 | |

**예:** `Audio`, `Video`, `Image`, `Paragraphs`

**구현 힌트:** `tags/object/<Name>/`, `ObjectBase`, View children에 type 추가, 필요 시 `regions/` 신규.

### Control (`tags/control/`)

| 맞는 경우 | 맞지 않는 경우 |
|-----------|----------------|
| `toName`으로 Object를 가리킴 | task media URL을 직접 소유·재생 엔진을 새로 짬 (→ Object) |
| `ControlBase`, `isControlTag: true` | 순수 레이아웃 (→ Visual) |
| `createResult` / `exportPayload` / labeling | |
| 기존 Object·region을 **읽기·조작·오케스트레이션** | |

**Faivv 예:**

| 태그 | 역할 |
|------|------|
| `SegmentAttachments` | 선택 구간 첨부 result |
| `SavedSegmentAttachments` | 저장된 첨부 목록 |
| `MultimodalTimeline` | 여러 Control/Object를 한 UI로 오케스트레이션 |

**구현 힌트:** `ControlBase` + `AnnotationMixin` + `ReadOnlyControlMixin`, `Registry.addTag`, `tags/control/index.js` export, `View.jsx` `children` union에 type 문자열 추가.

### Visual (`tags/visual/`)

| 맞는 경우 | 맞지 않는 경우 |
|-----------|----------------|
| `View`, `Header`, 스타일, 접기 패널 | result / region / 업로드 상태 |
| `visibleWhen` 등 표시 조건 | `toName`으로 labeling |

**주의:** Faivv에서 한때 첨부를 Visual로 두었다가 **Control로 전환**한 이력이 있다. 상태가 annotation에 남고 저장에 포함되면 Control이 맞다.

---

## 3. 선택 후 구현 순서

### 공통

1. MST model (`TagAttrs` + `Model`) — XML attr은 **소문자** 키 (`videoToName` → `videotoname`)
2. React view (`observer` / `inject("store")`)
3. `Registry.addTag("tagname", Model, View)` — tagname은 **소문자**
4. Control이면 `tags/control/index.js`에 export
5. `tags/visual/View.jsx`의 `children` unionArray에 type 추가 (부모 View 안에 넣으려면 필수)
6. JSDoc `@name` / `@example` XML 샘플
7. UI가 크면 `components/<Feature>/`로 분리 + **AGENTS.md** 작성
8. `docs/FAIVV_CUSTOMIZATIONS.md` 표에 행 추가
9. 빌드·sync (아래 §5)

### boolean XML 속성

`Tree.attrsToProps`가 `"true"`/`"false"`를 **boolean**으로 변환한다.

→ MST는 `types.optional(types.boolean, true)` 사용.  
`types.string`으로 두면 `No matching type for union (string | null?)`로 초기화 실패.

### faivv-flow 연동이 필요하면

1. `label_studio_v2_config.dart`에 XML 조각 추가
2. `faivv-lsf-config.js`에 name 상수 추가
3. 필요 시 `faivv-embed.js` hydrate/save bridge
4. fork 빌드 → `web/tools/label-studio-v2/ls/` sync

---

## 4. 안티패턴

| 하지 말 것 | 대신 |
|------------|------|
| media Object를 Control에 재구현 | 기존 Audio/Video `toName` 위임 |
| 저장용 상태를 Visual에만 둠 | Control + result/exportPayload |
| MultimodalTimeline에 첨부 MST 복제 | SegmentAttachments / Saved에 위임 |
| `connect/generated` 식 수동 편집 (해당 없음) | — |
| name을 Dart만 변경 | JS + fork TagAttrs 동시 변경 |
| standalone 빌드 없이 flow만 실행 | sync 후 hot restart |

---

## 5. 빌드 · flow 반영

```bash
# fork
cd /Users/geosoft/Documents/label-studio/web
MODE=standalone npx nx run editor:build:production

# 또는 faivv-flow에서
cd /Users/geosoft/Documents/faivv-flow
./tool/sync_lsf_from_fork.sh

# 앱
flutter run -d chrome   # 번들 반영 후 hot restart
```

상세: faivv-flow `docs/구현설명-label-studio-lsf-fork.md`

---

## 6. 컴포넌트별 가이드 (신규 Faivv)

| 폴더 | 문서 |
|------|------|
| MultimodalTimeline | [components/MultimodalTimeline/AGENTS.md](../web/libs/editor/src/components/MultimodalTimeline/AGENTS.md) |
| SegmentAttachments | [components/SegmentAttachments/AGENTS.md](../web/libs/editor/src/components/SegmentAttachments/AGENTS.md) |
| SavedSegmentAttachments | [components/SavedSegmentAttachments/AGENTS.md](../web/libs/editor/src/components/SavedSegmentAttachments/AGENTS.md) |

---

## 7. Agent용 짧은 프롬프트 템플릿

새 태그 요청을 받으면 아래를 **먼저** 사용자에게 확인·기록한 뒤 구현한다.

```
목적: …
선택한 종류: object | control | view
이유: …
위임할 기존 태그: … (없으면 none)
저장/result 영향: 있음/없음 — 스키마: …
XML name / toName: …
faivv-flow config 동기 필요: 예/아니오
```

종류가 control이고 UI가 비대하면 `components/<Name>/` + `AGENTS.md`를 함께 추가한다.
