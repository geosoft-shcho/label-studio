# Phase 0 — VideoVector 소스 확보 / 가능성 게이트

**날짜:** 2026-07-24  
**브랜치 기준:** `feature/custom-ui` @ `5cd42a1bf`  
**upstream:** `https://github.com/HumanSignal/label-studio.git` → `upstream/develop`

## 1. 조사 결과

| 항목 | 결과 |
|------|------|
| 현재 fork `feature/custom-ui` | `VideoVector*` **없음** |
| fork `origin/develop` | VideoVectorRegion **없음** (HumanSignal develop 동기화 시점 이전) |
| `upstream/develop` | VideoVector **소스 존재** (OSS) |
| 도입 커밋 | `e8d826e12` — `feat: BROS-833: Video vectors (#9504)` |
| 문서 | [VideoVector](https://labelstud.io/tags/videovector) / [VideoVectorLabels](https://labelstud.io/tags/videovectorlabels) — *“Enterprise / Starter Cloud only”* 표기 |
| 런타임 EE 게이트 | VideoVector control/region/tool 파일에서 **edition/LSE feature-flag 검사 없음** (문서 표기와 코드 불일치) |

### upstream에 있는 핵심 파일 (신규)

- `web/libs/editor/src/tags/control/VideoVector.js`
- `web/libs/editor/src/tags/control/VideoVectorLabels.jsx`
- `web/libs/editor/src/tags/object/Video/VideoVector.jsx`
- `web/libs/editor/src/tools/VideoVector.js`
- `web/libs/editor/src/regions/VideoVectorRegion.jsx`
- `web/libs/editor/src/regions/__tests__/VideoVectorRegion.test.js`
- docs includes: `videovector.md`, `videovectorlabels.md`

### 함께 필요한 선행 의존 (custom-ui에 없음)

VideoVector는 Image용 Vector 스택을 재사용한다. `feature/custom-ui`에는 아래가 **통째로 없음**:

- `web/libs/editor/src/components/KonvaVector/**` (~27 files)
- `web/libs/editor/src/tags/control/Vector.js`
- `web/libs/editor/src/tags/control/VectorLabels.jsx`
- `web/libs/editor/src/regions/VectorRegion.jsx`

추가로 wiring 수정이 들어가는 공유 파일:

- `regions/Area.js`, `regions/Result.js`, `regions/index.js`
- `tags/control/index.js`, `tools/index.js`
- `tags/object/Video/Video.js`, `VideoRegions.jsx`, `HtxVideo.jsx`
- `components/Node/Node.tsx`, `LabelOnRegion.jsx`, schema.json 등

## 2. pull / cherry-pick 실험

- `git fetch upstream` 완료 (`upstream/develop` 최신 반영).
- `feature/custom-ui...upstream/develop` ≈ **ahead 28 / behind 2354**.
- `e8d826e12` 단독 cherry-pick → **다수 conflict**  
  (modify/delete: KonvaVector·Vector.js 등 custom-ui에 없는 경로,  
   content: `VideoRegions.jsx`, `Area.js`, `Result.js`, `Node.tsx` 등 FAIVV 커스텀과 충돌).

→ **full `upstream/develop` merge는 Phase 0 범위에서 비권장** (충돌·회귀 규모 과다).  
→ **단일 커밋 cherry-pick만으로도 의존 미비로 실패**.

## 3. 결정 (A / B / C)

| 옵션 | 내용 | 판정 |
|------|------|------|
| **A. upstream OSS에서 포팅** | HumanSignal `develop`의 VideoVector(+KonvaVector/Vector) 소스를 `feature/custom-ui`에 이식 | **채택** |
| B. CE에서 동등 기능 재구현 | keyframe+lerp를 처음부터 작성 | 기각 (이미 OSS에 구현 있음) |
| C. overlay lifespan만 수정 | 공식 태그 전환 보류 | 임시 완화용만. VideoVector 전환 목표와 별개 |

**채택 사유**

1. VideoVector는 “비공개 Enterprise 바이너리”가 아니라 **공개 `label-studio` develop에 이미 존재**.
2. 문서의 Enterprise-only는 제품 표기이며, 포크에 소스를 가져와 쓰는 경로가 성립한다.
3. 재구현(B)보다 포팅(A)이 schema/`sequence`/`skeleton` 정합에 유리하다.

## 4. Phase 1 이식 전략 (확보 방법)

`feature/custom-ui`에 대해:

1. 작업 브랜치 예: `feature/videovector-port`
2. **의존 먼저:** upstream에서 KonvaVector + Vector/VectorLabels/VectorRegion 체크아웃·최소 wiring
3. **그다음** VideoVector* 파일 체크아웃
4. FAIVV가 손댄 공유 파일(`VideoRegions.jsx`, `Area.js`, `Result.js` 등)은 **수동 병합** (자동 merge 금지에 가깝게)
5. 전체 `upstream/develop` merge는 하지 않음

소스 참조용 로컬 브랜치(머지 아님):

```bash
git fetch upstream
git branch -f chore/upstream-videovector-ref upstream/develop
# 예: git show chore/upstream-videovector-ref:web/libs/editor/src/regions/VideoVectorRegion.jsx
```

## 5. Phase 0 완료 조건

- [x] upstream fetch 및 VideoVector 소스 위치 확인
- [x] custom-ui 부재 / 의존(KonvaVector) 부재 확인
- [x] cherry-pick 실패 원인 기록
- [x] A/B/C 결정 = **A**
- [ ] (후속 Phase 1) 실제 파일 이식·빌드 통과 — **본 Phase 범위 밖**

## 7. 소스 이식 상태 (`feature/videovector-port`)

**완료 (2026-07-24):** `upstream/develop`에서 아래를 가져와 wiring 반영.

- KonvaVector/**, VectorRegion, Vector/VectorLabels (파일)
- VideoVector* (control/tool/region/object/docs)
- `web/libs/core/.../tags.json` (upstream 전체 — custom-ui에 없었음)
- Area/Result/regions index, control/tools index, Video.js, VideoRegions, HtxVideo, Node, Label, View

**의도적 미포함:** Image용 `Vector`/`VectorLabels` control index 등록(포즈 전환에 불필요). 파일은 존재.

**다음:** keypoints↔vertices 스키마 매핑, faivv-flow config/apply, 빌드·런타임 검증.