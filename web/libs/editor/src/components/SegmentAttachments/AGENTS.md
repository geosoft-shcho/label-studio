# SegmentAttachments — Agent / 개발 가이드

## 한 줄 목적

선택된 **오디오 구간(`audioregion`)** 에 근거 파일을 첨부·업로드·삭제하는 Control의 React UI다.

세션 중 편집(pending / isNew)과, 같은 구간의 **서버 저장 첨부**(SavedSegmentAttachments) 조회를 한 패널에서 보여 준다.

## 태그 종류

| 구분 | 값 |
|------|-----|
| XML 태그 | `<SegmentAttachments>` |
| MST type | `segmentattachments` |
| 분류 | **Control** (`tags/control/SegmentAttachments.jsx`) |
| React UI | 이 폴더 |

Control인 이유: `toName` 대상 Object(주로 `audio`)에 묶인 result를 만들고, 저장 payload(`segmentAttachments`)를 export한다. media Object가 아니다.

## 파일 맵

| 파일 | 역할 |
|------|------|
| `SegmentAttachmentsPanel.jsx` | 파일 추가, Explorer 드롭, 목록, 「이 구간 첨부」/「저장된 첨부」 |
| `SegmentAttachmentsPanel.module.scss` | 패널 스타일 |
| `savedAttachmentLookup.js` | SavedSegmentAttachments와 regionId / start·end 매칭 |

관련 Control: `../../tags/control/SegmentAttachments.jsx`

## 데이터 모델 (MST)

- `regions[]` — regionId별 bucket (`attachments`, `pendings`, start/end/label)
- `removedAssetIds[]` — 삭제 큐 (저장 시 Flutter로 전달)
- pending File 객체는 MST 밖 `pendingFilesByTempId` Map

## UI 섹션

1. **이 구간 첨부** — bucket `persisted` + `pending` (편집 가능)
2. **저장된 첨부** — `savedAttachmentLookup`으로 Saved control에서 조회 (assetId 중복 제거). 삭제 → `removeSavedAttachment` → Saved control `removeAttachment`

## XML / embed

```xml
<!-- MultimodalTimeline에 패널 embed 시 단독 패널은 숨김 -->
<SegmentAttachments name="audio_evidence" toName="audio"
  savedAttachmentsFrom="saved_segment_attachments" showPanel="false" />
```

| attr | 의미 |
|------|------|
| `showPanel` | `false`면 Htx가 null 반환 (상태·export는 유지) |
| `savedAttachmentsFrom` | 저장 첨부 Control name |

`true`/`false` → MST `types.boolean`.

## 저장 계약 (변경 금지)

`exportPayload()`:

```js
{
  segmentAttachments: [{ regionId, start, end, evidenceAssetIds, newEvidenceAssetIds, attachments }],
  removedEvidenceAssetIds: [...]
}
```

faivv-flow: `faivv-embed.js` → `uploadPending` → `onResult.segmentAttachments`.

## 외부 API (window)

| API | 용도 |
|-----|------|
| `FaivvAssetUpload` | pending 업로드, contentUrl |
| `FaivvAssetImport` | `fileservice://` / `mongoservice://` 드롭 |
| `faivvFlutterDispatch('onDirty')` | 더티 알림 |

## 수정 시 체크리스트

1. 저장 스키마·mapper 변경 금지
2. region 매칭: `regionId` 우선, fallback `start`/`end` ±0.05s (`savedAttachmentLookup.js`)
3. MultimodalTimeline embed props(`savedOnly` 등)와 Panel props 동기화
4. 재오픈: Flutter `applySegmentAttachments` → `loadFromServer`
5. **스타일**: CSS 변수만 사용 (hex 금지). Flutter `data-theme` 토큰 따름

## 관련 문서

- [SavedSegmentAttachments/AGENTS.md](../SavedSegmentAttachments/AGENTS.md)
- [MultimodalTimeline/AGENTS.md](../MultimodalTimeline/AGENTS.md)
- [docs/AGENTS_FAIVV_NEW_TAG.md](../../../../../../docs/AGENTS_FAIVV_NEW_TAG.md)
