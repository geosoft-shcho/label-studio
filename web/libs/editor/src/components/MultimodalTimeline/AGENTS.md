# MultimodalTimeline — Agent / 개발 가이드

## 한 줄 목적

영상편집기 스타일로 **STT 자동 · 비디오 객체 · 저장 첨부**를 한 strip에 표시하고, 같은 화면에서 구간 선택·생성·첨부까지 조작하는 **오케스트레이터 UI**다.

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

`showLanes="stt,object,pose_object,saved_attachment"`

| lane 키 | UI 라벨 | 데이터 출처 | 비고 |
|---------|---------|-------------|------|
| `stt` | STT 자동 | `audioSegmentsFrom` + `transcript` | STT carrier. 드래그 생성·리사이즈 → Labels `audio_segments`. clip 글자는 **자막 본문**만. 저장은 `textarea`(labels 레이어 저장 안 함) |
| `object` | 비디오 수동 태깅 | `videoObjectsFrom` (`box`) | 수동 VideoRectangle |
| `pose_object` | POSE 자동 태깅 | `poseObjectsFrom` (`pose_box`) | 포즈 추론 VideoRectangle |
| `saved_attachment` | | `SavedSegmentAttachments` | 서버 첨부 전용 |

`attachment` lane(세션 bucket 요약)은 embed `SegmentAttachmentsPanel`로 대체되어 **기본 showLanes에서 제외**.

`object`와 `pose_object`는 고정 단일 행이 아니다. `collectAllLaneClips`가
`object:<regionId>` / `pose_object:<regionId>` 키로 전개하며, 한 region의
multi-span clip은 같은 행에 유지한다. 같은 라벨이 여러 개면 행 라벨에 region id
앞 4자를 붙여 구분한다.

표시는 박스 clip이 아니라 `PoseKeypointsRow`(Frames `lsf-keypoints`와 동일 개념):
lifespan 막대 + `sequence.frame/fps` 키프레임 점. `time` 필드는 쓰지 않는다.
pose는 `extendLastToVideoEnd=false`로 실구간만 그린다. 점은 뷰포트 컬링·간격 샘플링.

추론 완료 후 발견되는 `Person p1` 같은 instance 라벨은
`Labels.replaceLabelValues()`/`ensureLabelValue()`로 `pose_labels`에 먼저 동기화한
뒤 region을 hydrate한다. replace 추론에서는 기본 목록을 실제 결과 목록으로
교체하고, append 경로에서는 누락된 정확한 라벨만 추가한다.
등록되지 않은 라벨을 첫 번째 기본 라벨로 대체하면 타임라인 행 구분도 손실되므로
silent fallback을 추가하지 않는다.

STT(`textarea`) 추론도 동일: `faivv-apply-transcript.js`가 inject 전
`audio_segments`에 `replaceLabelValues`/`ensureLabelValue`를 적용하고,
`MultimodalTimeline.bumpClips()`로 STT 자동(`stt`) 레인을 갱신한다.
clip 글자는 TextArea `transcript`(+ `_faivvCaptionText`)만 쓴다.
Labels(`audio_segments`) 값은 레인 분류·저장에만 쓰고 clip 텍스트로는 쓰지 않는다.

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
  showLanes="stt,object,pose_object,saved_attachment" />
```

name/속성 문자열은 다음 세 곳과 **동일**해야 한다.

- `faivv-flow/lib/.../label_studio_v2_config.dart`
- `faivv-flow/web/tools/label-studio-v2/faivv-lsf-config.js`
- 이 Control의 TagAttrs

## UI vs 위임

| 새로 만든 UI | 기존 태그 위임 |
|--------------|----------------|
| strip, lane 라벨 열, playhead | Audio / Video seek·재생 |
| STT clip 렌더·드래그 | Labels(`audio_segments`) 선택값 — STT lane 생성 |
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
