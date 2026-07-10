/**
 * 통합 타임라인 오디오 lane — 구간 생성·리사이즈 (AudioUltra 위임).
 */

const MIN_REGION_SEC = 0.1;
export const RESIZE_HANDLE_PX = 6;

export function pxToSec(px, pxPerSec) {
  if (!Number.isFinite(px) || pxPerSec <= 0) return 0;
  return px / pxPerSec;
}

export function secToPx(sec, pxPerSec) {
  if (!Number.isFinite(sec) || pxPerSec <= 0) return 0;
  return sec * pxPerSec;
}

export function trackXFromEvent(e, trackEl, scrollEl) {
  if (!trackEl || !e) return 0;
  const rect = trackEl.getBoundingClientRect();
  const scrollLeft = scrollEl?.scrollLeft || 0;
  return Math.max(0, e.clientX - rect.left + scrollLeft);
}

export function clampSpan(start, end, durationSec) {
  let s = Math.min(start, end);
  let e = Math.max(start, end);

  if (typeof durationSec === "number" && durationSec > 0) {
    s = Math.max(0, s);
    e = Math.min(durationSec, e);
  }

  return { start: s, end: e };
}

export function getAudioSegmentLabels(audioSegmentsControl) {
  if (!audioSegmentsControl) {
    return { labels: [], color: null, ready: false };
  }

  try {
    const labels = audioSegmentsControl.selectedValues?.() || [];
    const color = audioSegmentsControl.selectedColor || null;
    return { labels, color, ready: labels.length > 0 };
  } catch (err) {
    return { labels: [], color: null, ready: false };
  }
}

export function createAudioRegionFromSpan(audioObject, audioSegmentsControl, start, end) {
  if (!audioObject?._ws?.regions) {
    return { ok: false, reason: "no_audio" };
  }

  const { labels, color, ready } = getAudioSegmentLabels(audioSegmentsControl);
  if (!ready) {
    return { ok: false, reason: "no_label" };
  }

  const durationSec = audioObject._ws.duration || 0;
  const span = clampSpan(start, end, durationSec);

  if (span.end - span.start < MIN_REGION_SEC) {
    return { ok: false, reason: "too_short" };
  }

  const resolvedColor = color || audioObject.getRegionColor?.() || "rgba(22, 119, 255, 0.3)";

  let wsRegion;
  try {
    wsRegion = audioObject._ws.regions.addRegion(
      {
        start: span.start,
        end: span.end,
        color: resolvedColor,
        labels,
      },
      true,
    );
  } catch (err) {
    return { ok: false, reason: "create_failed" };
  }

  if (!wsRegion) {
    return { ok: false, reason: "create_failed" };
  }

  const region = audioObject.addRegion(wsRegion);
  return { ok: true, region, wsRegion, start: span.start, end: span.end };
}

export function resizeAudioRegionSpan(region, start, end) {
  if (!region) return false;

  const durationSec = region.object?._ws?.duration || 0;
  const span = clampSpan(start, end, durationSec);

  if (span.end - span.start < MIN_REGION_SEC) {
    return false;
  }

  try {
    if (region._ws_region) {
      region._ws_region.updatePosition(span.start, span.end);
      region.onUpdateEnd?.();
      region.object?.updateWsRegion?.(region);
    } else if (typeof region.setProperty === "function") {
      region.setProperty("start", span.start);
      region.setProperty("end", span.end);
    } else {
      return false;
    }
  } catch (err) {
    return false;
  }

  return true;
}

export function bindDocumentDrag({ onMove, onEnd }) {
  const handleMove = (e) => onMove(e);
  const handleUp = (e) => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
    onEnd(e);
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);

  return () => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
  };
}

export function resizeHandleAt(clientX, clipEl) {
  if (!clipEl) return null;
  const rect = clipEl.getBoundingClientRect();
  const offset = clientX - rect.left;

  if (offset <= RESIZE_HANDLE_PX) return "start";
  if (offset >= rect.width - RESIZE_HANDLE_PX) return "end";
  return null;
}
