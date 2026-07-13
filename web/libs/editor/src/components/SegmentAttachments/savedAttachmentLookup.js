/**
 * SavedSegmentAttachments → 선택 오디오 구간 매칭 (regionId 우선, start/end fallback).
 * 같은 구간에 여러 첨부 레이어(여러 번 저장)가 있으면 전부 수집한다.
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

/** @deprecated 단일 segment만 필요하면 [0]; UI는 findSavedSegmentsForSelection 사용 */
export function findSavedSegmentForSelection(savedControl, selection) {
  const all = findSavedSegmentsForSelection(savedControl, selection);
  return all.length ? all[0] : null;
}

/**
 * 선택 구간에 매칭되는 Saved segment 전부.
 * - regionId 일치
 * - 또는 start/end ± TIME_TOLERANCE
 */
export function findSavedSegmentsForSelection(savedControl, { regionId, start, end }) {
  if (!savedControl?.segments?.length) return [];

  const rid = (regionId || "").trim();
  const segments = savedControl.segments;
  const matched = [];
  const seen = new Set();

  const push = (seg) => {
    if (!seg || !(seg.attachments || []).length) return;
    const key = seg.regionId || `${seg.start}_${seg.end}_${seg.layerId || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    matched.push(seg);
  };

  if (rid) {
    segments.forEach((s) => {
      if ((s.regionId || "").toString().trim() === rid) push(s);
    });
  }

  if (typeof start === "number" && typeof end === "number") {
    segments.forEach((s) => {
      if (spansMatch(start, end, s.start, s.end)) push(s);
    });
  }

  return matched;
}

function mapAttachment(a, savedRegionId) {
  return {
    assetId: (a.assetId || "").toString().trim(),
    fileName: (a.fileName || a.displayName || a.assetId || "").toString(),
    mimeType: (a.mimeType || "").toString(),
    size: typeof a.size === "number" ? a.size : 0,
    contentUrl: (a.contentUrl || "").toString(),
    isNew: false,
    savedRegionId: (savedRegionId || "").toString().trim(),
  };
}

/** bucket에 이미 있는 assetId 는 제외 — 첨부 전용 레이어 항목만 반환 */
export function savedAttachmentsExcludingBucket(savedSegment, bucketAttachments) {
  if (!savedSegment) return [];
  return savedAttachmentsExcludingBucketFromSegments([savedSegment], bucketAttachments);
}

/**
 * 여러 Saved segment attachments 병합 (assetId 중복 제거).
 * 삭제 시 올바른 segment를 찾기 위해 각 항목에 savedRegionId 를 붙인다.
 */
export function savedAttachmentsExcludingBucketFromSegments(savedSegments, bucketAttachments) {
  if (!savedSegments?.length) return [];

  const bucketIds = new Set();
  (bucketAttachments || []).forEach((a) => {
    const id = (a?.assetId || "").trim();
    if (id) bucketIds.add(id);
  });

  const out = [];
  const seenAsset = new Set();

  savedSegments.forEach((seg) => {
    const savedRegionId = (seg.regionId || "").toString().trim();
    (seg.attachments || []).forEach((raw) => {
      const mapped = mapAttachment(raw, savedRegionId);
      if (!mapped.assetId || bucketIds.has(mapped.assetId) || seenAsset.has(mapped.assetId)) {
        return;
      }
      seenAsset.add(mapped.assetId);
      out.push(mapped);
    });
  });

  return out;
}
