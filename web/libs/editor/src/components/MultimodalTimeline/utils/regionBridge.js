/**
 * MultimodalTimeline lane clip aggregation from LSF annotation store and fork Controls.
 *
 * 오디오 lane:
 * - `stt` → 오디오 구간 (`audio_segments` + transcript TextArea, 수동·STT 동일 textarea)
 */

import { isAlive } from "mobx-state-tree";

import {
  collectVideoObjectRegions,
  normalizeRegionSequence,
  objectLifespanClips,
  regionMatchesVideoObjectControls,
  videoRegionColor,
  videoRegionControlName,
  videoRegionLabel,
} from "./objectLifespan";
import { readDurationSec } from "./mediaSync";

/** deleteRegion/destroy 중 MST reaction 이 죽은 노드의 results 를 읽지 않도록. */
function regionIsUsable(region) {
  if (!region) return false;
  try {
    return isAlive(region);
  } catch (e) {
    return false;
  }
}

function safeRegionResults(region) {
  if (!regionIsUsable(region)) return [];
  try {
    return region.results || [];
  } catch (e) {
    return [];
  }
}

function isAudioRegion(region) {
  if (!regionIsUsable(region)) return false;
  try {
    if (region.type === "audioregion") return true;
    if (region.object && region.object.name === "audio") return true;
    if (region.parent && region.parent.name === "audio") return true;
    if (
      typeof region.start === "number" &&
      typeof region.end === "number" &&
      (!region.object || region.object.name !== "video")
    ) {
      return true;
    }
  } catch (e) {
    /* noop */
  }
  return false;
}

function controlNameOf(control) {
  if (!control) return "";
  try {
    return String(control.name || "").trim();
  } catch (e) {
    return "";
  }
}

function controlRefName(ref) {
  if (!ref) return "";
  if (typeof ref === "string") return String(ref).trim();
  try {
    return String(ref.name || "").trim();
  } catch (e) {
    return "";
  }
}

/** region 이 특정 Labels control 결과를 갖는지 (`audio_segments` 등). */
export function regionBelongsToLabelsControl(region, control) {
  const cname = controlNameOf(control);
  if (!cname || !regionIsUsable(region)) return false;
  try {
    if (region.labeling?.from_name === control) return true;
    const labelingName = controlRefName(region.labeling?.from_name);
    if (labelingName === cname) return true;
  } catch (e) {
    /* noop */
  }
  const results = safeRegionResults(region);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.from_name === control) return true;
    const fn = controlRefName(r?.from_name);
    if (fn === cname) return true;
  }
  return false;
}

function regionLabelText(region) {
  if (!regionIsUsable(region)) return "";
  try {
    if (region.labeling?.mainValue?.length) {
      return String(region.labeling.mainValue[0]);
    }
    const results = safeRegionResults(region);
    for (let i = 0; i < results.length; i++) {
      const v = results[i]?.value;
      if (v?.labels?.length) return String(v.labels[0]);
    }
  } catch (e) {
    /* noop */
  }
  return "";
}

/** Labels control 결과에서 region 의 라벨 텍스트를 모은다 (복수 라벨은 ", " 연결). */
function regionLabelsList(region) {
  const out = [];
  const add = (raw) => {
    const text = String(raw || "").trim();
    if (text && !out.includes(text)) out.push(text);
  };
  try {
    const main = region?.labeling?.mainValue;
    if (Array.isArray(main)) main.forEach(add);
    else if (typeof main === "string") add(main);
  } catch (e) {
    /* noop */
  }
  safeRegionResults(region).forEach((r) => {
    const labels = r?.value?.labels ?? r?.mainValue;
    if (Array.isArray(labels)) labels.forEach(add);
    else if (typeof labels === "string") add(labels);
  });
  return out;
}

/**
 * STT transcript 와 동일하게 annotation.results 에서도 Labels 값을 찾는다.
 * deserialize inject 직후 region.labeling 이 비어 있을 때 대비.
 */
function labelsTextForRegion(annotation, labelsControl, region) {
  const local = regionLabelsList(region);
  if (local.length) return local.join(", ");

  if (!annotation || !region) return "";
  const want = controlNameOf(labelsControl);
  if (!want) return "";

  const matchesControl = (r) => {
    if (!r) return false;
    if (labelsControl && r.from_name === labelsControl) return true;
    return controlRefName(r.from_name) === want;
  };

  const matchesRegion = (r) => {
    if (!r) return false;
    if (r.area === region) return true;
    try {
      const rid = String(region.cleanId || region.id || "");
      const aid = String(r.id || r.area?.cleanId || r.area?.id || "");
      if (rid && aid && (rid === aid || rid.startsWith(`${aid}#`) || aid.startsWith(`${rid}#`))) {
        return true;
      }
    } catch (e) {
      /* noop */
    }
    return false;
  };

  const collected = [];
  const add = (raw) => {
    const text = String(raw || "").trim();
    if (text && !collected.includes(text)) collected.push(text);
  };

  (annotation.results || []).forEach((r) => {
    if (!matchesControl(r) || !matchesRegion(r)) return;
    const labels = r?.value?.labels ?? r?.mainValue;
    if (Array.isArray(labels)) labels.forEach(add);
    else if (typeof labels === "string") add(labels);
  });

  return collected.join(", ");
}

function truncateClipLabel(text, max = 48) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 타임라인 clip 에 찍을 **자막 본문**.
 * Labels(`audio_segments`) 이름은 쓰지 않는다.
 *
 * 우선순위:
 * 1. TextArea `transcript` (perRegion)
 * 2. region._faivvCaptionText (apply-transcript inject 캐시)
 * 3. window.__faivvRegionCaptions[cleanId] (MST 할당 실패·id drift 대비)
 */
function resolveClipCaptionText(annotation, transcriptControl, region) {
  if (!regionIsUsable(region)) return "";
  const fromTranscript = transcriptControl
    ? transcriptTextForRegion(annotation, transcriptControl, region).trim()
    : "";
  if (fromTranscript) return fromTranscript;
  try {
    if (typeof region._faivvCaptionText === "string") {
      const cached = region._faivvCaptionText.trim();
      if (cached) return cached;
    }
  } catch (e) {
    /* noop — dead MST node */
  }
  try {
    const map =
      typeof window !== "undefined" ? window.__faivvRegionCaptions : null;
    if (map && typeof map === "object") {
      const clean = String(region.cleanId || "").trim();
      if (clean && map[clean]) return String(map[clean]).trim();
      const full = String(region.id || "");
      const hash = full.lastIndexOf("#");
      const id = (hash > 0 ? full.slice(0, hash) : full).trim();
      if (id && map[id]) return String(map[id]).trim();
    }
  } catch (e2) {
    /* noop */
  }
  return "";
}

function timeKey(start, end) {
  if (typeof start !== "number" || typeof end !== "number") return null;
  return `${start.toFixed(2)}_${end.toFixed(2)}`;
}

function transcriptTextForRegion(annotation, transcriptControl, region) {
  if (!annotation || !region) return "";
  const want = controlNameOf(transcriptControl) || "transcript";

  const readText = (r) => {
    if (!r) return "";
    const v = r.mainValue ?? r.value?.text ?? r.value;
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v) && v.length) return String(v[0]).trim();
    return "";
  };

  const matchesControl = (r) => {
    if (!r) return false;
    if (transcriptControl && r.from_name === transcriptControl) return true;
    return controlRefName(r.from_name) === want;
  };

  const matchesRegion = (r) => {
    if (!r) return false;
    if (r.area === region) return true;
    try {
      const rid = String(region.cleanId || region.id || "");
      const aid = String(r.id || r.area?.cleanId || r.area?.id || "");
      const parent = String(r.parentID || r.parent_id || "");
      if (rid && aid && (rid === aid || rid.startsWith(`${aid}#`) || aid.startsWith(`${rid}#`))) {
        return true;
      }
      // perRegion transcript: parentID → audio region cleanId
      if (
        rid &&
        parent &&
        (rid === parent || rid.startsWith(`${parent}#`) || parent.startsWith(`${rid}#`))
      ) {
        return true;
      }
    } catch (e) {
      /* noop */
    }
    return false;
  };

  const results = annotation.results || [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!matchesControl(r) || !matchesRegion(r)) continue;
    const text = readText(r);
    if (text) return text;
  }

  const local = safeRegionResults(region);
  for (let i = 0; i < local.length; i++) {
    const r = local[i];
    if (!matchesControl(r)) continue;
    const text = readText(r);
    if (text) return text;
  }

  return "";
}

function frameRateFromVideo(videoObject) {
  if (!videoObject) return 24;
  const raw = videoObject.framerate ?? videoObject.frameRate ?? 24;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function objectSpanSec(region, fps) {
  const seq = region.sequence || [];
  if (!seq.length) return null;
  let minF = Infinity;
  let maxF = -Infinity;
  seq.forEach((k) => {
    if (typeof k.frame !== "number") return;
    minF = Math.min(minF, k.frame);
    maxF = Math.max(maxF, k.frame);
  });
  if (!Number.isFinite(minF) || !Number.isFinite(maxF)) return null;
  const start = minF / fps;
  const end = (maxF + 1) / fps;
  return { start, end, frameRange: [minF, maxF] };
}

/** @deprecated use objectLifespanClips */

/**
 * STT / 수동 자막 레인 — transcript / audio_segments.
 * 설계-20: LayerSegment.confidence set → stt(자동), unset → audio_manual(수동).
 * clip 글자는 **자막 본문**만 표시 (Labels speaker 이름은 쓰지 않음).
 */
export function collectSubtitleLaneClips(annotation, transcriptControl, audioSegmentsControl) {
  const autoClips = [];
  const manualClips = [];
  if (!annotation) {
    return { stt: autoClips, audio_manual: manualClips };
  }

  (annotation.regionStore?.regions || []).forEach((region) => {
    if (!regionIsUsable(region) || !isAudioRegion(region)) return;
    if (typeof region.start !== "number" || typeof region.end !== "number") return;

    const displayText = resolveClipCaptionText(annotation, transcriptControl, region);
    const isSttCarrier =
      audioSegmentsControl && regionBelongsToLabelsControl(region, audioSegmentsControl);

    if (!displayText && !isSttCarrier) return;

    const conf = regionConfidenceValue(region);
    const isAuto = conf != null;
    const label = truncateClipLabel(displayText);
    const lane = isAuto ? "stt" : "audio_manual";

    const clip = {
      id: region.id,
      lane,
      start: region.start,
      end: region.end,
      label,
      meta: {
        subtitlePreview: displayText || label,
        laneKind: lane,
        sourceKind: isAuto ? "stt" : "manual",
        hasConfidence: isAuto,
        confidence: conf,
      },
      region,
    };

    if (isAuto) autoClips.push(clip);
    else manualClips.push(clip);
  });

  autoClips.sort((a, b) => a.start - b.start);
  manualClips.sort((a, b) => a.start - b.start);
  return { stt: autoClips, audio_manual: manualClips };
}

export function collectAttachmentLaneClips(attachmentsControl) {
  const clips = [];
  if (!attachmentsControl?.regions) return clips;

  attachmentsControl.regions.forEach((bucket) => {
    const count = (bucket.attachments?.length || 0) + (bucket.pendings?.length || 0);
    if (!count) return;
    if (bucket.start == null || bucket.end == null) return;
    clips.push({
      id: bucket.regionId,
      lane: "attachment",
      start: bucket.start,
      end: bucket.end,
      label: bucket.label || "첨부",
      meta: { attachmentCount: count },
    });
  });

  clips.sort((a, b) => a.start - b.start);
  return clips;
}

export function collectSavedAttachmentLaneClips(savedControl) {
  const clips = [];
  if (!savedControl?.segments) return clips;

  savedControl.segments.forEach((seg) => {
    const count = seg.attachments?.length || 0;
    if (!count) return;
    if (seg.start == null || seg.end == null) return;
    clips.push({
      id: seg.regionId,
      lane: "saved_attachment",
      start: seg.start,
      end: seg.end,
      label: seg.label || "저장된 첨부",
      meta: { attachmentCount: count, layerId: seg.layerId },
    });
  });

  clips.sort((a, b) => a.start - b.start);
  return clips;
}

/**
 * Video endpoint → keyframe first..last (enabled) 초 구간.
 * VideoPose `isInLifespan` 스캔은 단일 KF를 영상 끝까지 연장하므로 relation lane에 쓰지 않는다.
 */
function videoKeyframeSpanSec(region, fps) {
  if (!(fps > 0)) return null;
  const seq = normalizeRegionSequence(region);
  if (!Array.isArray(seq) || !seq.length) return null;

  let minF = Infinity;
  let maxF = -Infinity;
  let enabledCount = 0;
  seq.forEach((k) => {
    if (typeof k?.frame !== "number") return;
    if (k.enabled === false) return;
    enabledCount += 1;
    minF = Math.min(minF, k.frame);
    maxF = Math.max(maxF, k.frame);
  });
  if (!enabledCount) {
    seq.forEach((k) => {
      if (typeof k?.frame !== "number") return;
      minF = Math.min(minF, k.frame);
      maxF = Math.max(maxF, k.frame);
    });
  }
  if (!Number.isFinite(minF) || !Number.isFinite(maxF)) return null;
  return {
    start: minF / fps,
    end: Math.max(minF / fps + 0.05, (maxF + 1) / fps),
    path: "keyframes",
    seqLen: seq.length,
    spanCount: 1,
  };
}

/**
 * relation endpoint → 초 구간.
 * audio: start/end. video: **keyframe 실구간 우선** (isInLifespan 전체 스캔 금지).
 * @returns {{ start: number, end: number, path?: string } | null}
 */
function regionTimeSpanSec(region, videoObject, fps, durationSec) {
  if (!regionIsUsable(region)) return null;

  if (isAudioRegion(region)) {
    try {
      const start = region.start;
      const end = region.end;
      if (typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end)) {
        return { start, end: Math.max(start + 0.05, end), path: "audio" };
      }
    } catch (e) {
      /* noop */
    }
    return null;
  }

  // pose/box: keyframe first~last only (relation lane). object/pose_object 레인은 lifespan 유지.
  const keyframes = videoKeyframeSpanSec(region, fps);
  if (keyframes) return keyframes;

  const fallback = objectSpanSec(region, fps);
  if (fallback) {
    return {
      start: fallback.start,
      end: Math.max(fallback.start + 0.05, fallback.end),
      path: "objectSpanSec",
    };
  }

  // sequence 없을 때만 lifespan 폴백 (드묾).
  const spans = objectLifespanClips(region, videoObject, fps, durationSec, {
    extendLastToVideoEnd: false,
  });
  if (spans.length) {
    return {
      start: Math.min(...spans.map((s) => s.start)),
      end: Math.max(...spans.map((s) => s.end)),
      path: "lifespan_fallback",
      spanCount: spans.length,
    };
  }
  return null;
}

/**
 * relationStore → 파생 clip (시간 = endpoint 합집합). mapper/proto 변경 없음.
 *
 * LSF 공식 Relations/Video linking 과 별개: lane UI 만 relationStore 파생.
 * 표시용 최소 duration: pose–pose 등 초단 합집합이 긴 타임라인에서 안 보이는 문제 방지.
 * relationStore / serialize 값은 변경하지 않는다.
 */
/** UI-only — serialize/store 불변. */
const MIN_RELATION_CLIP_SEC = 1;

export function collectRelationLaneClips(annotation, videoObject) {
  const clips = [];
  if (!annotation) {
    return clips;
  }

  let relations = [];
  try {
    relations = annotation.relationStore?.relations || [];
  } catch (e) {
    return clips;
  }
  if (!relations.length) {
    return clips;
  }

  const fps = frameRateFromVideo(videoObject);
  const durationSec = readDurationSec(null, videoObject);
  const minClipSec = Math.max(1 / Math.max(fps, 1), MIN_RELATION_CLIP_SEC);

  relations.forEach((rel) => {
    if (!rel) return;
    let node1;
    let node2;
    try {
      node1 = rel.node1;
      node2 = rel.node2;
    } catch (e) {
      return;
    }

    const spanA = regionTimeSpanSec(node1, videoObject, fps, durationSec);
    const spanB = regionTimeSpanSec(node2, videoObject, fps, durationSec);
    if (!spanA && !spanB) return;

    let start;
    let end;
    if (spanA && spanB) {
      start = Math.min(spanA.start, spanB.start);
      end = Math.max(spanA.end, spanB.end);
    } else {
      const only = spanA || spanB;
      start = only.start;
      end = only.end;
    }
    if (!(typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end))) {
      return;
    }
    if (!(end > start)) end = start + 0.05;

    const rawStart = start;
    const rawEnd = end;
    let displayPadded = false;
    // video.length===1 / duration≈1frame 이면 아직 미디어 미준비 — duration clamp 금지.
    const videoLength = Number(videoObject?.length);
    const mediaReady =
      typeof durationSec === "number" &&
      Number.isFinite(durationSec) &&
      durationSec >= minClipSec &&
      (!Number.isFinite(videoLength) || videoLength > 1);
    if (end - start < minClipSec) {
      end = start + minClipSec;
      if (mediaReady && end > durationSec) {
        end = durationSec;
        start = Math.max(0, end - minClipSec);
      }
      displayPadded = true;
    }

    let labels = [];
    try {
      labels = Array.isArray(rel.labels) ? rel.labels.filter(Boolean).map(String) : [];
    } catch (e) {
      labels = [];
    }
    const labelText = labels[0] || "관계";
    const fromId = node1?.cleanId || node1?.id || "";
    const toId = node2?.cleanId || node2?.id || "";
    let direction = "right";
    try {
      direction = rel.direction || "right";
    } catch (e) {
      direction = "right";
    }
    const arrow = direction === "bi" ? "↔" : direction === "left" ? "←" : "→";

    clips.push({
      id: `relation:${rel.id}`,
      lane: "relation",
      start,
      end,
      label: `${labelText} · ${shortSegmentId(fromId)} ${arrow} ${shortSegmentId(toId)}`,
      region: null,
      relation: rel,
      meta: {
        relationId: rel.id,
        fromId,
        toId,
        direction,
        labels,
        laneLabel: "관계",
        node1Id: node1?.id ?? null,
        node2Id: node2?.id ?? null,
        color: "#CC6FBE",
        rawStart,
        rawEnd,
        displayPadded,
        displayStart: start,
        displayEnd: end,
      },
    });
  });

  clips.sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
  return clips;
}

export function collectVideoObjectLaneClips(
  annotation,
  videoObject,
  videoObjectsFromName,
  options = {},
) {
  const clips = [];
  if (!annotation || !videoObject) return clips;

  const lane = options.lane || "object";
  const sourcePrefix = options.sourcePrefix || "";
  const sourceKind = options.sourceKind || (lane === "pose_object" ? "pose" : "manual");
  // 포즈는 실구간만 (영상 끝 연장 금지). 수동 box 는 기존 LSF Frames UX 유지.
  // 설계-20: 자동(confidence) → last span 영상끝 연장 금지.
  const extendLastToVideoEnd = options.extendLastToVideoEnd ?? sourceKind !== "pose";
  const fps = frameRateFromVideo(videoObject);
  const durationSec = readDurationSec(null, videoObject);
  const regions = collectVideoObjectRegions(videoObject, annotation);

  regions.forEach((region) => {
    if (!regionMatchesVideoObjectControls(region, videoObjectsFromName)) return;

    const label = videoRegionLabel(region);
    const color = videoRegionColor(region);
    const spans = objectLifespanClips(region, videoObject, fps, durationSec, {
      extendLastToVideoEnd,
    });

    if (!spans.length) {
      const fallback = objectSpanSec(region, fps);
      if (!fallback) return;
      spans.push({
        start: fallback.start,
        end: fallback.end,
        startFrame: fallback.frameRange[0],
        endFrame: fallback.frameRange[1],
        spanIndex: 0,
        extendsToEnd: false,
      });
    }

    spans.forEach((span) => {
      const clipLabel =
        spans.length > 1 ? `${label} (${span.spanIndex + 1})` : label;
      const displayLabel = sourcePrefix ? `${sourcePrefix} · ${clipLabel}` : clipLabel;
      const segmentId = videoRegionSegmentId(region);
      clips.push({
        id: `${region.id}::${lane}::span${span.spanIndex}`,
        regionId: region.id,
        lane,
        start: span.start,
        end: span.end,
        label: displayLabel,
        meta: {
          objectLabel: label,
          color,
          frameRange: [span.startFrame, span.endFrame],
          spanIndex: span.spanIndex,
          extendsToEnd: span.extendsToEnd,
          sourceKind,
          controlName: videoRegionControlName(region),
          fps,
          segmentId,
        },
        region,
      });
    });
  });

  clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return clips;
}

function videoRegionSegmentId(region) {
  if (!regionIsUsable(region)) return "";
  try {
    const fromRegion = String(region.segmentId || "").trim();
    if (fromRegion) return fromRegion;
  } catch (e) {
    /* noop */
  }
  try {
    for (const r of safeRegionResults(region)) {
      const sid = String(r?.value?.segmentId || "").trim();
      if (sid) return sid;
    }
  } catch (e) {
    /* noop */
  }
  // CreateLayerSegment 응답 id가 아직 없으면 LSF cleanId 폴백.
  try {
    const clean = String(region.cleanId || region.id || "").trim();
    return clean;
  } catch (e2) {
    return "";
  }
}

function videoObjectLaneEntries(clips, laneKind, sourceLabel) {
  // 행 키·그룹은 LayerSegment.id(`seg_*`). region MST id 로 조회하지 않는다.
  const bySegment = new Map();
  clips.forEach((clip) => {
    const segmentId =
      String(clip.meta?.segmentId || "").trim() ||
      videoRegionSegmentId(clip.region) ||
      String(clip.regionId || clip.region?.id || clip.id);
    const current = bySegment.get(segmentId) || [];
    current.push(clip);
    bySegment.set(segmentId, current);
  });

  const rows = [...bySegment.entries()].map(([segmentId, segmentClips]) => {
    segmentClips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    const regionId = String(segmentClips[0]?.regionId || segmentClips[0]?.region?.id || "");
    return {
      segmentId,
      regionId,
      clips: segmentClips,
      objectLabel: segmentClips[0]?.meta?.objectLabel || "Object",
      start: segmentClips[0]?.start ?? 0,
    };
  });
  rows.sort((a, b) => a.start - b.start || a.segmentId.localeCompare(b.segmentId));

  const labelCounts = new Map();
  rows.forEach((row) => {
    labelCounts.set(row.objectLabel, (labelCounts.get(row.objectLabel) || 0) + 1);
  });

  return rows.map((row) => {
    // 동일 Labels(Person)는 segment id로 행을 구분한다.
    const idSuffix =
      labelCounts.get(row.objectLabel) > 1 ? ` · ${shortSegmentId(row.segmentId)}` : "";
    const laneLabel = `${sourceLabel} · ${row.objectLabel}${idSuffix}`;
    row.clips.forEach((clip) => {
      clip.meta = {
        ...clip.meta,
        laneKind,
        laneLabel,
        segmentId: row.segmentId,
      };
    });
    return [`${laneKind}:${row.segmentId}`, row.clips];
  });
}

/** 타임라인/비디오 라벨용 짧은 segment id (`seg_a7a16f9b…`). */
function shortSegmentId(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (s.startsWith("seg_") && s.length > 4) {
    const rest = s.slice(4);
    return rest.length <= 8 ? `seg_${rest}` : `seg_${rest.slice(0, 8)}`;
  }
  return s.length <= 10 ? s : s.slice(0, 10);
}

/** LayerSegment.confidence → region (설계-20). 있으면 자동 라벨링. */
function regionConfidenceValue(region) {
  if (!regionIsUsable(region)) return null;
  try {
    const c = region.confidence;
    if (c != null && c !== "" && Number.isFinite(Number(c))) return Number(c);
  } catch (e) {
    /* noop */
  }
  try {
    for (const r of safeRegionResults(region)) {
      const c = r?.value?.confidence;
      if (c != null && c !== "" && Number.isFinite(Number(c))) return Number(c);
    }
  } catch (e2) {
    /* noop */
  }
  // AudioRegion: assignRegionConfidence 가 score 에도 기록 (RegionsMixin).
  try {
    const s = region.score;
    if (s != null && s !== "" && Number.isFinite(Number(s))) return Number(s);
  } catch (e3) {
    /* noop */
  }
  return null;
}

/**
 * 설계-20: LayerSegment.confidence set(0 포함) → 자동.
 * unset(검수/사람 편집 후 clear) → 수동. pose_box 폴백 없음.
 */
function isAutoTaggedVideoRegion(region) {
  return regionConfidenceValue(region) != null;
}

export function collectAllLaneClips(item) {
  const annotation = item.annotation;
  // box + video_vector(수동) + pose 를 한 풀로 모은 뒤 confidence 로 수동/자동 레인 분기 (설계-20).
  // 수동 video_vector는 object 레인 (pose_object 금지).
  const boxFrom = item.videoobjectsfrom || "box";
  const poseFrom = item.poseobjectsfrom || "pose_box";
  const allVideoClips = collectVideoObjectLaneClips(
    annotation,
    item.videoObject,
    `${boxFrom},${poseFrom}`,
    {
      lane: "object",
      sourcePrefix: "",
      // confidence 분기 후 pose는 연장 금지. 수동 last-span 연장은 후처리하지 않음.
      extendLastToVideoEnd: false,
    },
  );
  const manualObjectClips = [];
  const poseObjectClips = [];
  allVideoClips.forEach((clip) => {
    const isAuto = isAutoTaggedVideoRegion(clip.region);
    const conf = regionConfidenceValue(clip.region);
    const hasConf = conf != null;
    if (isAuto) {
      poseObjectClips.push({
        ...clip,
        lane: "pose_object",
        meta: {
          ...clip.meta,
          sourceKind: "pose",
          hasConfidence: hasConf,
          confidence: conf,
        },
      });
    } else {
      manualObjectClips.push({
        ...clip,
        lane: "object",
        meta: {
          ...clip.meta,
          sourceKind: "manual",
          hasConfidence: false,
          confidence: null,
        },
      });
    }
  });

  const subtitleLanes = collectSubtitleLaneClips(
    annotation,
    item.transcriptControl,
    item.audioSegmentsControl,
  );

  const lanes = {
    stt: subtitleLanes.stt || [],
    audio_manual: subtitleLanes.audio_manual || [],
    attachment: collectAttachmentLaneClips(item.attachmentsControl),
    saved_attachment: collectSavedAttachmentLaneClips(item.savedAttachmentsControl),
    relation: collectRelationLaneClips(annotation, item.videoObject),
  };

  const enabled = (item.showlanes || "stt,audio_manual,object,pose_object,saved_attachment,relation")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const laneClips = {};
  enabled.forEach((rawKey) => {
    const lower = rawKey.toLowerCase();
    // source만 전달 — instance title: `{source} · {class}` (View kind 폴백과 축 일치)
    if (lower === "object") {
      videoObjectLaneEntries(manualObjectClips, "object", "수동").forEach(([laneKey, clips]) => {
        laneClips[laneKey] = clips;
      });
    } else if (lower === "pose_object") {
      videoObjectLaneEntries(poseObjectClips, "pose_object", "자동").forEach(([laneKey, clips]) => {
        laneClips[laneKey] = clips;
      });
    } else {
      const match =
        lanes[rawKey] != null
          ? rawKey
          : Object.keys(lanes).find((k) => k.toLowerCase() === lower);
      if (match && lanes[match]) {
        laneClips[match] = lanes[match];
      }
    }
  });

  return laneClips;
}

export { isAudioRegion, regionLabelText, timeKey };
