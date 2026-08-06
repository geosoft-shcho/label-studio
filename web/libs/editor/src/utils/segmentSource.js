/**
 * 설계-20 §9: LayerSegment.source / reviewed helpers.
 * - source: auto | manual (기본 manual) — 자동/수동 레인·표시 분기
 * - confidence: UI 점수만 (레인 분기에 쓰지 않음)
 * - reviewed: 검수 완료 여부
 */

/** @returns {"auto"|"manual"} */
export function normalizeSegmentSource(v) {
  if (v == null || v === "") return "manual";
  if (typeof v === "number") return v === 1 ? "auto" : "manual";
  const s = String(v).trim().toLowerCase();
  if (
    s === "auto" ||
    s === "1" ||
    s === "segment_source_auto" ||
    s.endsWith("_auto")
  ) {
    return "auto";
  }
  return "manual";
}

export function isAutoSegmentSource(v) {
  return normalizeSegmentSource(v) === "auto";
}

export function normalizeReviewed(v) {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  return false;
}

/** region / result.value 에서 source 읽기 (기본 manual). */
export function regionSegmentSource(region) {
  if (!region) return "manual";
  try {
    if (region.source != null && region.source !== "") {
      return normalizeSegmentSource(region.source);
    }
  } catch (e) {
    /* noop */
  }
  try {
    const results = region.results || [];
    for (const r of results) {
      const s = r?.value?.source;
      if (s != null && s !== "") return normalizeSegmentSource(s);
    }
  } catch (e2) {
    /* noop */
  }
  return "manual";
}

export function regionIsAutoSource(region) {
  return regionSegmentSource(region) === "auto";
}

export function regionReviewed(region) {
  if (!region) return false;
  try {
    if (region.reviewed === true) return true;
  } catch (e) {
    /* noop */
  }
  try {
    const results = region.results || [];
    for (const r of results) {
      if (normalizeReviewed(r?.value?.reviewed)) return true;
      if (normalizeReviewed(r?.reviewed)) return true;
    }
  } catch (e2) {
    /* noop */
  }
  return false;
}

/**
 * AI(source=auto) geometry 편집 시 검수 플래그.
 * Timeline PoseKeypointsRow / serialize 가 region.reviewed 를 본다.
 */
export function markRegionReviewedOnEdit(region) {
  if (!region || !regionIsAutoSource(region)) return false;
  try {
    region.reviewed = true;
  } catch (e) {
    /* noop */
  }
  try {
    const results = region.results || [];
    for (const r of results) {
      if (!r) continue;
      try {
        if (typeof r.setReviewed === "function") {
          r.setReviewed(true);
        } else if ("reviewed" in r) {
          r.reviewed = true;
        }
      } catch (eR) {
        /* noop */
      }
      try {
        if (r.value && typeof r.value === "object") {
          r.value.reviewed = true;
        }
      } catch (eV) {
        /* noop */
      }
    }
  } catch (e2) {
    /* noop */
  }
  return true;
}
