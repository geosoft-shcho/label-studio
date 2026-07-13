# SavedSegmentAttachments — Agent / 개발 가이드

## 한 줄 목적

**첨부 전용 TAG 레이어**(서버에 이미 저장된 구간 첨부)를 목록으로 보여 주고, 항목 삭제를 지원하는 Control UI다.

세션 중 새로 올리는 파일은 `SegmentAttachments`가 담당한다. 이 컴포넌트는 **재오픈·저장 후 하이드레이션된 읽기/삭제** 중심이다.

## 태그 종류

| 구분 | 값 |
|------|-----|
| XML 태그 | `<SavedSegmentAttachments>` |
| MST type | `savedsegmentattachments` |
| 분류 | **Control** (`tags/control/SavedSegmentAttachments.jsx`) |
| React UI | 이 폴더 |

Control인 이유: `savedsegmentattachments` result / `exportPayload`(segments + removedAssetIds)를 다루하고 Object media를 소유하지 않는다.

## 파일 맵

| 파일 | 역할 |
|------|------|
| `SavedSegmentAttachmentsList.jsx` | 구간 그룹별 첨부 목록·다운로드·삭제 |
| `SavedSegmentAttachmentsList.module.scss` | 목록 스타일 |

관련 Control: `../../tags/control/SavedSegmentAttachments.jsx`

## 데이터 흐름

```
Flutter hydrateSavedSegmentAttachments(list)
  → Control.loadFromServer(list)
  → segments[] (regionId, start, end, label, layerId, attachments)
  → SavedSegmentAttachmentsList 렌더
```

payload 예 (재오픈):

```json
{
  "regionId": "seg_...",
  "start": 12.34,
  "end": 56.78,
  "label": "화자1",
  "layerId": "lyr_...",
  "attachments": [{ "assetId", "fileName", "mimeType", "size", "contentUrl" }]
}
```

## MultimodalTimeline과의 관계

| 경로 | 역할 |
|------|------|
| Collapse 「저장된 구간 첨부」 | 전 구간 목록 (이 폴더 UI) |
| MultimodalTimeline `saved_attachment` lane | 동일 `segments`로 clip 표시 |
| SegmentAttachments 「저장된 첨부」 | `savedAttachmentLookup`으로 **선택 구간만** 조회 |

삭제는 `removeAttachment(regionId, assetId)` 한곳. SegmentAttachments에서 위임 호출 가능.

## 저장 계약

`exportPayload()` → `{ segments, removedAssetIds }`  
faivv-flow `requestSave`의 `savedSegmentAttachments` / removed merge와 연동.

스키마·persist 루프 변경 금지.

## 수정 시 체크리스트

1. `loadFromServer`는 attachments 없는 segment skip (빈 그룹 미표시)
2. regionId 불일치 시 SegmentAttachments 쪽 time fallback은 lookup에서 처리
3. readOnly면 삭제 버튼 비활성
4. 빌드 후 faivv-flow `ls/` sync

## 관련 문서

- [SegmentAttachments/AGENTS.md](../SegmentAttachments/AGENTS.md)
- [MultimodalTimeline/AGENTS.md](../MultimodalTimeline/AGENTS.md)
- [docs/AGENTS_FAIVV_NEW_TAG.md](../../../../../../docs/AGENTS_FAIVV_NEW_TAG.md)
