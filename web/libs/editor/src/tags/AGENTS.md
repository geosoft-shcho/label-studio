# tags/ — Agent 인덱스

새 XML 태그를 추가하거나 `object` / `control` / `visual` 아래를 수정하기 **전에**:

→ **[docs/AGENTS_FAIVV_NEW_TAG.md](../../../../../docs/AGENTS_FAIVV_NEW_TAG.md)**  
  object / control / view 선택 트리 · 구현 순서 · boolean attr · 빌드/sync

| 폴더 | 용도 |
|------|------|
| `object/` | task media·텍스트 표시 + region 호스트 (`ObjectBase`) |
| `control/` | `toName` 대상에 labeling/result/오케스트레이션 (`ControlBase`) |
| `visual/` | 레이아웃·표시만 (`View`, `Header`…) |

Faivv Control UI 가이드:

- [../components/MultimodalTimeline/AGENTS.md](../components/MultimodalTimeline/AGENTS.md)
- [../components/SegmentAttachments/AGENTS.md](../components/SegmentAttachments/AGENTS.md)
- [../components/SavedSegmentAttachments/AGENTS.md](../components/SavedSegmentAttachments/AGENTS.md)
