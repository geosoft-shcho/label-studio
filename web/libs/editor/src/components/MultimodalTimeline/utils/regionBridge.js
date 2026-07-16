/**
 * MultimodalTimeline lane clip aggregation from LSF annotation store and fork Controls.
 */

import {
  collectVideoObjectRegions,
  objectLifespanClips,
  regionMatchesVideoObjectControls,
  videoRegionColor,
  videoRegionControlName,
  videoRegionLabel,
} from "./objectLifespan";
import { readDurationSec } from "./mediaSync";

function isAudioRegion(region) {
  if (!region) return false;
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

function regionLabelText(region) {
  try {
    if (region.labeling?.mainValue?.length) {
      return String(region.labeling.mainValue[0]);
    }
    const results = region.results || [];
    for (let i = 0; i < results.length; i++) {
      const v = results[i]?.value;
      if (v?.labels?.length) return String(v.labels[0]);
    }
  } catch (e) {
    /* noop */
  }
  return "";
}

function timeKey(start, end) {
  if (typeof start !== "number" || typeof end !== "number") return null;
  return `${start.toFixed(2)}_${end.toFixed(2)}`;
}

function transcriptTextForRegion(annotation, transcriptControl, region) {
  if (!annotation || !transcriptControl || !region) return "";
  const results = annotation.results || [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.from_name !== transcriptControl) continue;
    if (r.area !== region) continue;
    const v = r.mainValue ?? r.value?.text ?? r.value;
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.length) return String(v[0]);
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

export function collectAudioLaneClips(annotation, audioSegmentsControl) {
  const clips = [];
  if (!annotation?.regionStore) return clips;

  (annotation.regionStore.regions || []).forEach((region) => {
    if (!isAudioRegion(region)) return;
    if (typeof region.start !== "number" || typeof region.end !== "number") return;
    clips.push({
      id: region.id,
      lane: "audio",
      start: region.start,
      end: region.end,
      label: regionLabelText(region) || "segment",
      region,
    });
  });

  clips.sort((a, b) => a.start - b.start);
  return clips;
}

export function collectSubtitleLaneClips(annotation, transcriptControl, audioClips) {
  const clips = [];
  if (!annotation || !transcriptControl) return clips;

  const byId = new Map();
  audioClips.forEach((c) => byId.set(c.id, c));

  (annotation.regionStore?.regions || []).forEach((region) => {
    if (!isAudioRegion(region)) return;
    const text = transcriptTextForRegion(annotation, transcriptControl, region).trim();
    if (!text) return;
    clips.push({
      id: region.id,
      lane: "subtitle",
      start: region.start,
      end: region.end,
      label: text.length > 48 ? `${text.slice(0, 48)}…` : text,
      meta: { subtitlePreview: text },
      region,
    });
  });

  clips.sort((a, b) => a.start - b.start);
  return clips;
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
        },
        region,
      });
    });
  });

  clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return clips;
}

function videoObjectLaneEntries(clips, laneKind, sourceLabel) {
  const byRegion = new Map();
  clips.forEach((clip) => {
    const regionId = String(clip.regionId || clip.region?.id || clip.id);
    const current = byRegion.get(regionId) || [];
    current.push(clip);
    byRegion.set(regionId, current);
  });

  const rows = [...byRegion.entries()].map(([regionId, regionClips]) => {
    regionClips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    return {
      regionId,
      clips: regionClips,
      objectLabel: regionClips[0]?.meta?.objectLabel || "Object",
      start: regionClips[0]?.start ?? 0,
    };
  });
  rows.sort((a, b) => a.start - b.start || a.regionId.localeCompare(b.regionId));

  const labelCounts = new Map();
  rows.forEach((row) => {
    labelCounts.set(row.objectLabel, (labelCounts.get(row.objectLabel) || 0) + 1);
  });

  return rows.map((row) => {
    const duplicateSuffix =
      labelCounts.get(row.objectLabel) > 1 ? ` · ${row.regionId.slice(0, 4)}` : "";
    const laneLabel = `${sourceLabel} · ${row.objectLabel}${duplicateSuffix}`;
    row.clips.forEach((clip) => {
      clip.meta = {
        ...clip.meta,
        laneKind,
        laneLabel,
      };
    });
    return [`${laneKind}:${row.regionId}`, row.clips];
  });
}

export function collectAllLaneClips(item) {
  const annotation = item.annotation;
  const audioClips = collectAudioLaneClips(annotation, item.audioSegmentsControl);
  const manualObjectClips = collectVideoObjectLaneClips(
    annotation,
    item.videoObject,
    item.videoobjectsfrom,
    {
      lane: "object",
      sourcePrefix: "수동",
      sourceKind: "manual",
    },
  );
  const poseObjectClips = collectVideoObjectLaneClips(
    annotation,
    item.videoObject,
    item.poseobjectsfrom || "pose_box",
    {
      lane: "pose_object",
      sourcePrefix: "포즈",
      sourceKind: "pose",
    },
  );
  const lanes = {
    audio: audioClips,
    subtitle: collectSubtitleLaneClips(annotation, item.transcriptControl, audioClips),
    attachment: collectAttachmentLaneClips(item.attachmentsControl),
    saved_attachment: collectSavedAttachmentLaneClips(item.savedAttachmentsControl),
  };

  const enabled = (item.showlanes || "audio,subtitle,object,pose_object,saved_attachment")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const laneClips = {};
  enabled.forEach((key) => {
    if (key === "object") {
      videoObjectLaneEntries(manualObjectClips, "object", "수동").forEach(([laneKey, clips]) => {
        laneClips[laneKey] = clips;
      });
    } else if (key === "pose_object") {
      videoObjectLaneEntries(poseObjectClips, "pose_object", "포즈").forEach(([laneKey, clips]) => {
        laneClips[laneKey] = clips;
      });
    } else if (lanes[key]) {
      laneClips[key] = lanes[key];
    }
  });

  return laneClips;
}

export { isAudioRegion, regionLabelText, timeKey };
