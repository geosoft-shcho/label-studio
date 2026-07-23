/**
 * MultimodalTimeline lane clip aggregation from LSF annotation store and fork Controls.
 *
 * 오디오 lane:
 * - `stt` → 오디오 구간 (`audio_segments` + transcript TextArea, 수동·STT 동일 textarea)
 */

import { isAlive } from "mobx-state-tree";

import {
  collectVideoObjectRegions,
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
  if (!region) return "";
  const fromRegion = String(region.segmentId || "").trim();
  if (fromRegion) return fromRegion;
  try {
    for (const r of region.results || []) {
      const sid = String(r?.value?.segmentId || "").trim();
      if (sid) return sid;
    }
  } catch (e) {
    /* noop */
  }
  // CreateLayerSegment 응답 id가 아직 없으면 LSF cleanId 폴백.
  const clean = String(region.cleanId || region.id || "").trim();
  return clean;
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

/** LayerSegment.confidence → region (설계-20). 있으면 자동 태깅. */
function regionConfidenceValue(region) {
  if (!region) return null;
  try {
    const c = region.confidence;
    if (c != null && c !== "" && Number.isFinite(Number(c))) return Number(c);
  } catch (e) {
    /* noop */
  }
  try {
    for (const r of region.results || []) {
      const c = r?.value?.confidence;
      if (c != null && c !== "" && Number.isFinite(Number(c))) return Number(c);
    }
  } catch (e2) {
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

let _lastConfidenceLaneDebugKey = "";

function isConfidenceDebugEnabled() {
  try {
    if (typeof window === "undefined") return false;
    if (window.__faivvDebugConfidence === false) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function logConfidenceLaneSplit(rows) {
  if (!isConfidenceDebugEnabled()) return;
  const summary = {
    rule: "LayerSegment.confidence → MultimodalTimeline lanes",
    withConfidence: rows.filter((r) => r.hasConfidence).length,
    withoutConfidence: rows.filter((r) => !r.hasConfidence).length,
    autoLane: rows.filter((r) => r.lane === "pose_object").length,
    manualLane: rows.filter((r) => r.lane === "object").length,
    rows,
  };
  const key = JSON.stringify(summary);
  if (key === _lastConfidenceLaneDebugKey) return;
  _lastConfidenceLaneDebugKey = key;
  try {
    // eslint-disable-next-line no-console
    console.info("[faivv-confidence] mmTimeline.lanes", summary);
  } catch (e) {
    /* noop */
  }
}

export function collectAllLaneClips(item) {
  const annotation = item.annotation;
  // box + pose_box 를 한 풀로 모은 뒤 confidence 로 수동/자동 레인 분기 (설계-20).
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
  const debugRows = [];
  allVideoClips.forEach((clip) => {
    const isAuto = isAutoTaggedVideoRegion(clip.region);
    const conf = regionConfidenceValue(clip.region);
    const hasConf = conf != null;
    debugRows.push({
      regionId: String(clip.regionId || clip.region?.id || ""),
      segmentId: clip.meta?.segmentId || "",
      control: clip.meta?.controlName || "",
      hasConfidence: hasConf,
      confidence: conf,
      poseBoxFallback: !hasConf && videoRegionControlName(clip.region) === "pose_box",
      lane: isAuto ? "pose_object" : "object",
      laneHint: isAuto ? "pose_object(AI)" : "object(human)",
    });
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
  logConfidenceLaneSplit(debugRows);

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
  };

  const enabled = (item.showlanes || "stt,audio_manual,object,pose_object,saved_attachment")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const laneClips = {};
  enabled.forEach((rawKey) => {
    const lower = rawKey.toLowerCase();
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
