# Faivv LSF customizations (fork: geosoft-shcho/label-studio)

Base upstream tag: **1.15.0** (`feature/custom-ui` branch).

These changes support faivv-flow iframe embed (`faivv-flow/web/tools/label-studio-v2/`).

| File | Purpose |
|------|---------|
| `web/libs/editor/src/components/Waveform/Waveform.jsx` | Honor `splitchannels` XML attribute (legacy WaveSurfer path) |
| `web/libs/editor/src/tags/object/Video/Video.js` | Add `stageRef` on video model for pose overlay sync |
| `web/libs/editor/src/tags/object/Video/HtxVideo.jsx` | Use `item.stageRef` instead of local ref |
| `web/libs/editor/src/tags/object/Video/mediaToCanvas.js` | Media % → canvas px (zoom/pan); shared by bbox & keypoints |
| `web/libs/editor/src/regions/videoKeypoints.js` | Keypoint interpolation on VideoRectangle `sequence` |
| `web/libs/editor/src/regions/VideoRectangleRegion.js` | `bboxCoords` / `bboxCoordsCanvas`; `keypointsCoordsCanvas` |
| `web/libs/editor/src/components/InteractiveOverlays/BoundingBox.js` | `videorectangleregion` hit-test bbox |
| `web/libs/editor/src/components/InteractiveOverlays/NodesConnector.js` | Reactive watcher for video rectangle regions |
| `web/libs/editor/src/tags/control/SegmentAttachments.jsx` | 선택 구간 첨부 Control (`SegmentAttachments`, 업로드·삭제) |
| `web/libs/editor/src/components/SegmentAttachments/` | 선택 구간 첨부 React UI |
| `web/libs/editor/src/tags/control/SavedSegmentAttachments.jsx` | 저장된 구간 첨부 Control (`SavedSegmentAttachments`, 삭제) |

Build (standalone):

```bash
cd web
yarn install
MODE=standalone npx nx run editor:build:production
```

Output: `web/dist/libs/editor/` → sync to faivv-flow `web/tools/label-studio-v2/ls/`.
