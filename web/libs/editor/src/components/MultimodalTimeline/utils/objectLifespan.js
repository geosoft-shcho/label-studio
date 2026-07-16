/**
 * VideoRectangle 타임라인 lifespan — LSF `Timeline/Views/Frames/Utils.visualizeLifespans` 와 동일 규칙.
 * enabled 구간은 끊기지 않게 표시하고, 마지막 enabled span 은 영상 끝까지 연장한다.
 */

export function normalizeRegionSequence(region) {
  if (!region) return [];
  const direct = region.sequence;
  if (Array.isArray(direct) && direct.length) return direct;

  try {
    const results = region.results || [];
    for (let i = 0; i < results.length; i++) {
      const seq = results[i]?.value?.sequence;
      if (Array.isArray(seq) && seq.length) return seq;
    }
  } catch (e) {
    /* noop */
  }

  return [];
}

/** LSF Frames/Utils.ts — step 은 프레임 간격(1) 으로 환산 */
export function visualizeLifespans(keyframes, step = 1) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return [];

  const lifespans = [];
  const start = keyframes[0].frame - 1;

  for (let i = 0; i < keyframes.length; i++) {
    const lastSpan = lifespans[lifespans.length - 1];
    const point = keyframes[i];
    const prevPoint = keyframes[i - 1];
    const offset = (point.frame - start - 1) * step;

    if (!lastSpan || !lastSpan.enabled) {
      lifespans.push({
        offset,
        width: 0,
        length: 0,
        enabled: point.enabled !== false,
        start: point.frame,
        points: [point],
      });
    } else if (prevPoint?.enabled !== false) {
      lastSpan.width = (point.frame - lastSpan.points[0].frame) * step;
      lastSpan.length = point.frame - lastSpan.start;
      lastSpan.enabled = point.enabled !== false;
      lastSpan.points.push(point);
    }
  }

  return lifespans;
}

function frameToSec(frame, fps) {
  if (typeof frame !== "number" || !Number.isFinite(frame) || fps <= 0) return 0;
  return frame / fps;
}

export function videoTotalFrames(videoObject, fps, durationSec) {
  const len = videoObject?.length;
  if (typeof len === "number" && Number.isFinite(len) && len > 0) return Math.max(1, Math.round(len));

  if (typeof durationSec === "number" && durationSec > 0 && fps > 0) {
    return Math.max(1, Math.ceil(durationSec * fps));
  }

  try {
    const refDur = videoObject?.ref?.current?.duration;
    if (typeof refDur === "number" && refDur > 0 && fps > 0) {
      return Math.max(1, Math.ceil(refDur * fps));
    }
  } catch (e) {
    /* noop */
  }

  return 1;
}

/**
 * `region.isInLifespan(frame)` 스캔 — 비디오 캔버스 표시와 동일한 visible 구간.
 */
export function lifespanRangesByFrame(region, totalFrames) {
  if (!region || typeof region.isInLifespan !== "function" || totalFrames < 1) return [];

  const ranges = [];
  let open = null;

  for (let frame = 1; frame <= totalFrames; frame++) {
    let visible = false;
    try {
      visible = !!region.isInLifespan(frame);
    } catch (e) {
      visible = false;
    }

    if (visible && open === null) {
      open = frame;
    } else if (!visible && open !== null) {
      ranges.push({ startFrame: open, endFrame: frame - 1 });
      open = null;
    }
  }

  if (open !== null) {
    ranges.push({ startFrame: open, endFrame: totalFrames });
  }

  return ranges;
}

function lifespansFromKeyframes(sequence, totalFrames, { extendLastToVideoEnd = true } = {}) {
  const sorted = [...sequence]
    .filter((k) => typeof k?.frame === "number")
    .sort((a, b) => a.frame - b.frame);

  if (!sorted.length) return [];

  const spans = visualizeLifespans(sorted, 1).filter((s) => s.enabled !== false);
  if (!spans.length) return [];

  return spans.map((span, index) => {
    const isLast = index === spans.length - 1;
    const startFrame = span.start;
    let endFrame = span.points[span.points.length - 1]?.frame ?? startFrame;

    // 수동 VideoRectangle UX: 마지막 enabled span 을 영상 끝까지 연장.
    // 포즈 추론은 실구간(first~last keyframe)만 유지.
    if (extendLastToVideoEnd && isLast && span.enabled !== false) {
      endFrame = totalFrames;
    }

    return {
      startFrame,
      endFrame: Math.max(startFrame, endFrame),
      isLast,
    };
  });
}

export function objectLifespanRanges(region, videoObject, fps, durationSec, options = {}) {
  const extendLastToVideoEnd = options.extendLastToVideoEnd !== false;
  const totalFrames = videoTotalFrames(videoObject, fps, durationSec);

  if (typeof region.isInLifespan === "function") {
    const fromScan = lifespanRangesByFrame(region, totalFrames);
    if (fromScan.length) {
      return fromScan.map((range, index) => ({
        startFrame: range.startFrame,
        endFrame: range.endFrame,
        isLast: index === fromScan.length - 1,
      }));
    }
  }

  const sequence = normalizeRegionSequence(region);

  if (sequence.length) {
    const fromKeyframes = lifespansFromKeyframes(sequence, totalFrames, {
      extendLastToVideoEnd,
    });
    if (fromKeyframes.length) return fromKeyframes;
  }

  return [];
}

export function objectLifespanClips(region, videoObject, fps, durationSec, options = {}) {
  const ranges = objectLifespanRanges(region, videoObject, fps, durationSec, options);
  const duration =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : null;

  return ranges.map((range, index) => {
    let start = frameToSec(range.startFrame, fps);
    let end = frameToSec(range.endFrame + 1, fps);
    if (duration != null) {
      start = Math.max(0, Math.min(start, duration));
      end = Math.max(start + 0.04, Math.min(end, duration));
    } else {
      end = Math.max(start + 0.04, end);
    }
    return {
      start,
      end,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      spanIndex: index,
      extendsToEnd: options.extendLastToVideoEnd !== false && range.isLast === true,
    };
  });
}

/** sequence keyframes → 초 좌표 (time 필드 무시, frame/fps만 사용). */
export function keyframesSecInSpan(region, startFrame, endFrame, fps) {
  if (!region || !(fps > 0)) return [];
  const sequence = normalizeRegionSequence(region);
  if (!sequence.length) return [];

  const minF = typeof startFrame === "number" ? startFrame : -Infinity;
  const maxF = typeof endFrame === "number" ? endFrame : Infinity;
  const out = [];
  const seen = new Set();

  for (let i = 0; i < sequence.length; i++) {
    const kf = sequence[i];
    if (!kf || typeof kf.frame !== "number") continue;
    if (kf.enabled === false) continue;
    if (kf.frame < minF || kf.frame > maxF) continue;
    if (seen.has(kf.frame)) continue;
    seen.add(kf.frame);
    out.push(kf.frame / fps);
  }

  out.sort((a, b) => a - b);
  return out;
}

export function videoRegionLabel(region) {
  try {
    if (Array.isArray(region.labels) && region.labels.length) {
      return region.labels.filter(Boolean).join(", ");
    }
  } catch (e) {
    /* noop */
  }

  try {
    if (region.labeling?.mainValue?.length) {
      return String(region.labeling.mainValue[0]);
    }
    const results = region.results || [];
    for (let i = 0; i < results.length; i++) {
      const labels = results[i]?.value?.labels;
      if (Array.isArray(labels) && labels.length) return labels.join(", ");
    }
  } catch (e) {
    /* noop */
  }

  return "Object";
}

export function videoRegionColor(region) {
  try {
    return region.style?.fillcolor ?? region.tag?.fillcolor ?? null;
  } catch (e) {
    return null;
  }
}

/** LSF Result.from_name 은 MST reference — 문자열 비교 시 `.name` 사용. */
export function controlNameOf(fromName) {
  if (!fromName) return "";
  if (typeof fromName === "string") return fromName.trim();
  try {
    if (typeof fromName.name === "string" && fromName.name.trim()) {
      return fromName.name.trim();
    }
  } catch (e) {
    /* noop */
  }
  return "";
}

export function videoRegionControlName(region) {
  try {
    const results = region.results || [];
    for (let i = 0; i < results.length; i++) {
      const name = controlNameOf(results[i]?.from_name);
      if (name) return name;
    }
    if (region.parent?.name) return String(region.parent.name);
    if (region.tag?.name) return String(region.tag.name);
  } catch (e) {
    /* noop */
  }
  return "";
}

export function parseVideoObjectControlNames(raw) {
  if (Array.isArray(raw)) {
    return raw.map((name) => String(name).trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function regionMatchesVideoObjectControls(region, controlNames) {
  const filters = parseVideoObjectControlNames(controlNames);
  if (!filters.length) return true;
  return filters.includes(videoRegionControlName(region));
}

export function collectVideoObjectRegions(videoObject, annotation) {
  const out = [];
  const seen = new Set();

  const push = (region) => {
    if (!region?.id || seen.has(region.id)) return;
    const type = (region.type || "").toLowerCase();
    if (!type.includes("videorectangle")) return;
    seen.add(region.id);
    out.push(region);
  };

  try {
    (videoObject?.regs || []).forEach(push);
  } catch (e) {
    /* noop */
  }

  try {
    (annotation?.regionStore?.regions || []).forEach((region) => {
      if (region.object === videoObject) push(region);
    });
  } catch (e) {
    /* noop */
  }

  return out;
}
