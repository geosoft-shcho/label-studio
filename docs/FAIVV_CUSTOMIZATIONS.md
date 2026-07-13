# Faivv LSF customizations (fork: geosoft-shcho/label-studio)

Base upstream tag: **1.15.0** (`feature/custom-ui` branch).

These changes support faivv-flow iframe embed (`faivv-flow/web/tools/label-studio-v2/`).

| File | Purpose |
|------|---------|
| `web/libs/editor/src/components/Waveform/Waveform.jsx` | Honor `splitchannels` XML attribute (legacy WaveSurfer path) |
| `web/libs/editor/src/components/VideoCanvas/VideoCanvas.tsx` | `zoomRatio` contain-fit 확대 허용 (기본 zoom to fit용) |
| `web/libs/editor/src/tags/object/Video/HtxVideo.jsx` | stageRef; 기본 zoom to fit; FAIVV VideoDebug 오버레이 (`FAIVV_VIDEO_DEBUG=0` 로 끔) |
| `web/libs/editor/src/tags/object/Video/mediaToCanvas.js` | Media % → canvas px (zoom/pan); shared by bbox & keypoints |
| `web/libs/editor/src/regions/videoKeypoints.js` | Keypoint interpolation on VideoRectangle `sequence` |
| `web/libs/editor/src/regions/VideoRectangleRegion.js` | `bboxCoords` / `bboxCoordsCanvas`; `keypointsCoordsCanvas` |
| `web/libs/editor/src/components/InteractiveOverlays/BoundingBox.js` | `videorectangleregion` hit-test bbox |
| `web/libs/editor/src/components/InteractiveOverlays/NodesConnector.js` | Reactive watcher for video rectangle regions |
| `web/libs/editor/src/tags/control/SegmentAttachments.jsx` | 선택 구간 첨부 Control (`SegmentAttachments`, 업로드·삭제) |
| `web/libs/editor/src/components/SegmentAttachments/` | 선택 구간 첨부 React UI — [AGENTS.md](../web/libs/editor/src/components/SegmentAttachments/AGENTS.md) |
| `web/libs/editor/src/tags/control/SavedSegmentAttachments.jsx` | 저장된 구간 첨부 Control (`SavedSegmentAttachments`, 삭제) |
| `web/libs/editor/src/components/SavedSegmentAttachments/` | 저장된 구간 첨부 React UI — [AGENTS.md](../web/libs/editor/src/components/SavedSegmentAttachments/AGENTS.md) |
| `web/libs/editor/src/tags/control/MultimodalTimeline.jsx` | 멀티모달 통합 타임라인 Control (`MultimodalTimeline`, 구간 생성·선택·첨부 embed) |
| `web/libs/editor/src/components/MultimodalTimeline/` | 통합 타임라인 React UI — [AGENTS.md](../web/libs/editor/src/components/MultimodalTimeline/AGENTS.md) |

## Agent 문서

| 문서 | 용도 |
|------|------|
| [AGENTS_FAIVV_NEW_TAG.md](./AGENTS_FAIVV_NEW_TAG.md) | 새 태그 추가 시 **object / control / view** 선택·구현 순서 |
| `.cursor/rules/faivv-lsf-new-tag.mdc` | 태그·관련 컴포넌트 편집 시 agent 규칙 |
| `.cursor/rules/faivv-multimodal-attachments.mdc` | MultimodalTimeline·첨부 폴더 편집 시 agent 규칙 |

Build (standalone):

```bash
cd web
yarn install
MODE=standalone npx nx run editor:build:production
```

Output: `web/dist/libs/editor/` → sync to faivv-flow `web/tools/label-studio-v2/ls/`.
