# Faivv LSF customizations (fork: geosoft-shcho/label-studio)

Base upstream tag: **1.15.0** (`feature/custom-ui` branch).

These changes support faivv-flow iframe embed (`faivv-flow/web/tools/label-studio-v2/`).

| File | Purpose |
|------|---------|
| `web/libs/editor/src/components/Waveform/Waveform.jsx` | Honor `splitchannels` XML attribute (legacy WaveSurfer path) |
| `web/libs/editor/src/components/VideoCanvas/VideoCanvas.tsx` | `zoomRatio` contain-fit; `preload="metadata"`; 로드 후 seek 킥으로 첫 프레임 canvas paint (흰 화면 방지) |
| `web/libs/editor/src/components/VideoCanvas/VirtualVideo.tsx` | 실제 `<video>` 생성 시 `preload` 기본값 `metadata` (`auto` 하드코딩 제거, props 우선) |
| `web/libs/editor/src/lib/AudioUltra/Media/WaveformAudio.ts` | html5 `<audio preload="metadata">`; ready는 `canplay`/`loadedmetadata` (canplaythrough 의존 제거). 파형 decode용 XHR은 별도 |
| `web/libs/editor/src/tags/object/Video/HtxVideo.jsx` | stageRef; 기본 zoom to fit; FAIVV VideoDebug 오버레이 (`FAIVV_VIDEO_DEBUG=0` 로 끔) |
| `web/libs/editor/src/tags/object/Video/mediaToCanvas.js` | Media % → canvas px (zoom/pan); shared by bbox & keypoints |
| `web/libs/editor/src/regions/videoKeypoints.js` | Keypoint interpolation on VideoRectangle `sequence` |
| `web/libs/editor/src/regions/VideoRectangleRegion.js` | `bboxCoords` / `bboxCoordsCanvas`; `keypointsCoordsCanvas` |
| `web/libs/editor/src/regions/VideoRegion.js` | 설계-20 `confidence` (pose/object 레인) |
| `web/libs/editor/src/regions/AudioRegion/AudioUltraRegionModel.js` | 설계-20 `confidence` (stt/audio_manual 레인) |
| `web/libs/editor/src/regions/AudioRegion/AudioRegionModel.js` | 동일 (레거시 WaveSurfer) |
| `web/libs/editor/src/regions/Result.js` | `value.confidence` MST 필드 (Audio/Video hydrate) |
| `web/libs/editor/src/components/InteractiveOverlays/BoundingBox.js` | `videorectangleregion` hit-test bbox |
| `web/libs/editor/src/components/InteractiveOverlays/NodesConnector.js` | Reactive watcher for video rectangle regions |
| `web/libs/editor/src/tags/control/SegmentAttachments.jsx` | 선택 구간 첨부 Control (`SegmentAttachments`, 업로드·삭제) |
| `web/libs/editor/src/components/SegmentAttachments/` | 선택 구간 첨부 React UI — [AGENTS.md](../web/libs/editor/src/components/SegmentAttachments/AGENTS.md) |
| `web/libs/editor/src/tags/control/SavedSegmentAttachments.jsx` | 저장된 구간 첨부 Control (`SavedSegmentAttachments`, 삭제) |
| `web/libs/editor/src/components/SavedSegmentAttachments/` | 저장된 구간 첨부 React UI — [AGENTS.md](../web/libs/editor/src/components/SavedSegmentAttachments/AGENTS.md) |
| `web/libs/editor/src/tags/control/MultimodalTimeline.jsx` | 멀티모달 통합 타임라인 Control (`MultimodalTimeline`, 구간 생성·선택·첨부 embed) |
| `web/libs/editor/src/components/MultimodalTimeline/` | 통합 타임라인 React UI — [AGENTS.md](../web/libs/editor/src/components/MultimodalTimeline/AGENTS.md) |
| `web/libs/editor/src/assets/styles/faivv-theme.scss` | Flutter `data-theme` dark 토큰 + ant-collapse·Header(Typography) 테마 |
| `web/libs/editor/src/tags/visual/Header.jsx` | `lsf-config-header` 클래스 — 테마 토큰으로 색 적용 |
| `web/libs/editor/src/components/Timeline/Views/Frames/Frames.scss` | Video `lsf-timeline-frames` — overlay·`__background` 스트라이프를 sand/black 토큰 |
| `web/libs/editor/src/components/Timeline/Views/Frames/Frames.tsx` | `__background` 인라인 `#fff`/`#FAFAFA` 제거 → SCSS CSS 변수 |
| `web/libs/editor/src/components/Timeline/Views/Frames/Keypoints.scss` | 프레임 키포인트 라벨/hover — hex·rgba → sand/black 토큰 |
| `web/libs/editor/src/tags/object/Paragraphs/Paragraphs.module.scss` | dialogue `dialoguename` 등 — white/hex → sand 토큰 |
| `web/libs/editor/src/tags/object/Paragraphs/model.js` | newUI phrase `--background-color` → `var(--sand_*)` |
| `web/libs/editor/src/components/Timeline/Controls.scss` | `main-controls` 버튼·SVG `currentColor` 테마 대응 |
| `web/libs/editor/src/assets/icons/timeline/*.svg` | `fill="black"` → `currentColor` (다크 모드 아이콘) |
| `web/libs/editor/src/regions/VideoPoseRegion.jsx` | Soft-split AI `box` MST (`videoposeregion`) — **KEEP** (VideoPoseLabels UI와 별개) |
| `web/libs/editor/src/tags/object/Video/VideoRegions.jsx` | Soft-split: Rectangle + VideoVectorShape; VideoVectorTool 제스처 |
| ~~`VideoPose.js` / `VideoPoseLabels.jsx` / `tools/VideoPose.js`~~ | **Removed** — bbox+keypoint 통합 Labels UI. Soft-split은 box + video_vector |

## Theme (Flutter ↔ LSF)

faivv-flow `ThemeProvider` → `FaivvLabelStudio.setTheme('dark'|'light')` →
`document.documentElement[data-theme]` (+ `faivv-theme-change` 이벤트).

| 규칙 | 내용 |
|------|------|
| 토큰 | `--sand_*` / `--grape_*` 등 CSS 변수 사용 |
| 금지 | 컴포넌트 SCSS에 hex 하드코딩 (`#fff`, `#fafafa` …) |
| dark | `[data-theme='dark']` 에서 토큰 재정의 (`faivv-theme.scss`) |
| embed | flow `faivv-ls-theme.css` 가 light 토큰·레이아웃 보정 담당 |

## Agent 문서

| 문서 | 용도 |
|------|------|
| [AGENTS_FAIVV_NEW_TAG.md](./AGENTS_FAIVV_NEW_TAG.md) | 새 태그 추가 시 **object / control / view** 선택·구현 순서 |
| faivv-flow `docs/구현설명-VideoPoseLabels.md` | VideoPoseLabels UI **제거됨**; Soft-split KEEP = VideoPoseRegion |

| `.cursor/rules/faivv-lsf-new-tag.mdc` | 태그·관련 컴포넌트 편집 시 agent 규칙 |
| `.cursor/rules/faivv-multimodal-attachments.mdc` | MultimodalTimeline·첨부 폴더 편집 시 agent 규칙 |

Build (standalone):

```bash
cd web
yarn install
MODE=standalone npx nx run editor:build:production
```

Output: `web/dist/libs/editor/` → sync to faivv-flow `web/tools/label-studio-v2/ls/`.
