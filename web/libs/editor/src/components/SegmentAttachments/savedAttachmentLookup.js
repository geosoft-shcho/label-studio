/**
 * SavedSegmentAttachments → 선택 오디오 구간 매칭 (regionId 우선, start/end fallback).
 */

const TIME_TOLERANCE = 0.05;

export function timeKey(start, end) {
  if (typeof start !== "number" || typeof end !== "number") return null;
  return `${start.toFixed(2)}_${end.toFixed(2)}`;
}

function spansMatch(aStart, aEnd, bStart, bEnd) {
  if (typeof aStart !== "number" || typeof aEnd !== "number") return false;
  if (typeof bStart !== "number" || typeof bEnd !== "number") return false;
  return Math.abs(aStart - bStart) < TIME_TOLERANCE && Math.abs(aEnd - bEnd) < TIME_TOLERANCE;
}

export function findSavedSegmentForSelection(savedControl, { regionId, start, end }) {
  if (!savedControl?.segments?.length) return null;

  const rid = (regionId || "").trim();
  const segments = savedControl.segments;

  if (rid) {
    const exact = segments.find((s) => (s.regionId || "").toString().trim() === rid);
    if (exact && (exact.attachments || []).length) return exact;
  }

  if (typeof start === "number" && typeof end === "number") {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!(seg.attachments || []).length) continue;
      if (spansMatch(start, end, seg.start, seg.end)) return seg;
    }
  }

  return null;
}

/** bucket에 이미 있는 assetId 는 제외 — 첨부 전용 레이어 항목만 반환 */
export function savedAttachmentsExcludingBucket(savedSegment, bucketAttachments) {
  if (!savedSegment) return [];

  const bucketIds = new Set();
  (bucketAttachments || []).forEach((a) => {
    const id = (a?.assetId || "").trim();
    if (id) bucketIds.add(id);
  });

  return (savedSegment.attachments || [])
    .map((a) => ({
      assetId: (a.assetId || "").toString().trim(),
      fileName: (a.fileName || a.displayName || a.assetId || "").toString(),
      mimeType: (a.mimeType || "").toString(),
      size: typeof a.size === "number" ? a.size : 0,
      contentUrl: (a.contentUrl || "").toString(),
      isNew: false,
    }))
    .filter((a) => a.assetId && !bucketIds.has(a.assetId));
}
