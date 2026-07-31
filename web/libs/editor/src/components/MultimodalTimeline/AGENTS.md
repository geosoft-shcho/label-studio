# MultimodalTimeline — Agent / 개발 가이드

## 한 줄 목적

영상편집기 스타일로 **오디오 구간(textarea)·비디오 객체·저장 첨부**를 한 strip에 표시하고, 같은 화면에서 구간 선택·생성·첨부까지 조작하는 **오케스트레이터 UI**다.

저장 포맷·mapper·`layer_persist`는 건드리지 않는다. 데이터는 기존 Control/Object에 **위임**한다.

## 태그 종류

| 구분 | 값 |
|------|-----|
| XML 태그 | `<MultimodalTimeline>` |
| MST type | `multimodaltimeline` |
| 분류 | **Control** (`tags/control/MultimodalTimeline.jsx`) |
| React UI | 이 폴더 (`MultimodalTimelineView`) |

Control인 이유: task media를 직접 로드하지 않고, `toName`/`*From`으로 기존 태그를 참조·오케스트레이션한다.

## 파일 맵

| 파일 | 역할 |
|------|------|
| `MultimodalTimelineView.jsx` | 레인·눈금자·playhead·드래그·첨부 embed |
| `PoseKeypointsRow.jsx` | object/pose 레인 lifespan+키프레임 점 (초×pxPerSec, Frames Keypoints 대응) |
| `MultimodalTimelineView.module.scss` | 라벨 고정열 + 스크롤 트랙 레이아웃 |
| `utils/regionBridge.js` | annotation/Control → lane clip 집계 |
| `utils/mediaSync.js` | AudioUltra + Video playhead/duration 구독 |
| `utils/laneInteraction.js` | STT lane 드래그 생성·리사이즈 (AudioUltra 위임) |
| `utils/objectLifespan.js` | VideoRectangle lifespan → 초 단위 clip; pose는 last-span 영상끝 연장 안 함 |

관련 Control 태그: `../../tags/control/MultimodalTimeline.jsx`

## Lane 구성 (기본)

`showLanes="stt,object,pose_object,saved_attachment,relation"`

| lane 키 | UI 라벨 | 데이터 출처 | 비고 |
|---------|---------|-------------|------|
| `stt` | STT 자동 | `audioSegmentsFrom` + transcript + **confidence set** | AI 전사 |
| `audio_manual` | 수동 자막 | 동일 캐리어 + **confidence unset** | 사람 편집·검수 clear |
| `object` | 수동 객체 | `videoObjectsFrom` (`box`) + **confidence unset** | 수동 VideoRectangle |
| `pose_object` | 자동(POSE) | `poseObjectsFrom` (`pose_box`) + **confidence set** | 추론 VideoRectangle |
| `saved_attachment` | 저장 첨부 | `SavedSegmentAttachments` | 서버 첨부 전용 |
| `relation` | 관계 | `annotation.relationStore` 파생 clip | endpoint 시간 **합집합**. video endpoint는 **keyframe 실구간**만 (VideoPose `isInLifespan` 전체 연장 금지). 표시용 최소 duration `max(1/fps,1s)`·min-width 32px. mapper/proto·store 불변 |

레인 분기는 control 이름이 아니라 **설계-20 `LayerSegment.confidence` 유무**다.
unset(검수 clear 포함) → `audio_manual` / `object`, set(0 포함) → `stt` / `pose_object`.
`kind`/`displayName`만으로 분기하지 않는다.

Audio region은 `AudioUltraRegionModel.confidence`(및 Result.value.confidence)에
hydrate 시 반영한다. MST에 필드가 없으면 inject 값이 버려져 전부 수동 레인으로 간다.

`attachment` lane(세션 bucket 요약)은 embed `SegmentAttachmentsPanel`로 대체되어 **기본 showLanes에서 제외**.

`object`와 `pose_object`는 고정 단일 행이 아니다. `collectAllLaneClips`가
`object:<segmentId>` / `pose_object:<segmentId>` 키로 전개하며, 한 segment의
multi-span clip은 같은 행에 유지한다. 같은 Labels 값(예: Person)이 여러 개면
행 라벨에 **LayerSegment.id**(`seg_*` 짧은 표기, 예: `seg_a7a16f9b`)를 붙여
구분한다. MST `region.id`로 레인을 키잉하지 않는다.

표시는 박스 clip이 아니라 `PoseKeypointsRow`(Frames `lsf-keypoints`와 동일 개념):
lifespan 막대 + `sequence.frame/fps` 키프레임 점. `time` 필드는 쓰지 않는다.
자동 레인은 점선 lifespan + `AI`/`confidence` 뱃지, 수동은 solid.
pose는 `extendLastToVideoEnd=false`로 실구간만 그린다. 점은 뷰포트 컬링·간격 샘플링.

팔레트 Labels는 클래스명만(`Person`). 인스턴스 구분은 segment id(region id)다.
`Person p1` 같은 instance 라벨을 Labels에 넣지 않는다.
Video bbox는 confidence set 시 점선 + `AI` 라벨 접두 + score 뱃지.

STT/수동 구분 없이 `textarea` 레이어 apply도 동일: `faivv-apply-transcript.js`가 inject 전
`audio_segments`에 `ensureLabelValue`로 팔레트를 병합하고,
`MultimodalTimeline.bumpClips()`로 `stt` 레인을 갱신한다.
clip 글자는 TextArea `transcript`(+ `_faivvCaptionText`)만 쓴다.
Labels(`audio_segments`) 값은 레인 분류·저장에만 쓰고 clip 텍스트로는 쓰지 않는다.
clip 자막은 TextArea / `_faivvCaptionText` / `window.__faivvRegionCaptions` 순으로 읽는다.

## XML 계약 (faivv-flow와 동기)

```xml
<MultimodalTimeline name="mm_timeline" toName="audio" videoToName="video"
  audioSegmentsFrom="audio_segments"
  transcriptFrom="transcript"
  attachmentsFrom="audio_evidence"
  savedAttachmentsFrom="saved_segment_attachments"
  videoObjectsFrom="box"
  poseObjectsFrom="pose_box"
  height="280" embedAttachments="true"
  showLanes="stt,object,pose_object,saved_attachment,relation" />
```

name/속성 문자열은 다음 세 곳과 **동일**해야 한다.

- `faivv-flow/lib/.../label_studio_v2_config.dart`
- `faivv-flow/web/tools/label-studio-v2/faivv-lsf-config.js`
- 이 Control의 TagAttrs

## UI vs 위임

| 새로 만든 UI | 기존 태그 위임 |
|--------------|----------------|
| strip, lane 라벨 열, playhead | Audio / Video seek·재생 |
| STT clip 렌더·드래그 | Labels(`audio_segments`) 선택값 — `stt` lane 생성 |
| STT clip 표시 | Labels(`audio_segments`) + TextArea(`transcript`) |
| 첨부 패널 embed | SegmentAttachments / SavedSegmentAttachments |

## 수정 시 체크리스트

1. lane/clip 로직 → `regionBridge` / `objectLifespan` 우선
2. 미디어 시각 → `mediaSync`만 수정 (DOM 직접 폴링 추가 금지 권장)
3. STT 구간 생성 → `laneInteraction` → `audioObject.addRegion` + **`audio_segments`** (Labels 미선택 시 생성 실패가 정상)
4. XML `true`/`false` attr → MST는 `types.boolean` (Tree가 boolean으로 파싱)
5. 빌드: `MODE=standalone npx nx run editor:build:production` → faivv-flow `ls/` sync
6. **스타일**: `MultimodalTimelineView.module.scss`는 CSS 변수만 사용 (hex 금지).
   테마는 Flutter `data-theme` / `faivv-theme.scss` 토큰을 따름
