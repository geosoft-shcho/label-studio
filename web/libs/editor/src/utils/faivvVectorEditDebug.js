/**
 * 영상 vector / keypoint 편집 디버그.
 *
 * Soft-split config (faivv-flow label_studio_v2_config.dart):
 *   box            → VideoRectangle (AI + manual bbox; tip/grip도 sequence에 실림)
 *   video_vector   → VideoVectorLabels (수동 tip/grip)
 *   pose           → VideoPoseLabels 통합 UI 제거됨 (레거시 from_name만)
 *
 * 실제 적용 region (video):
 *   - VideoPoseRegion / VideoRectangleRegion ← from_name=box (AI Soft-split)
 *   - VideoVectorRegion ← from_name=video_vector
 *   - VectorRegion.jsx 는 Image 전용 — 영상 경로 아님
 *
 * 활성화:
 *   localStorage.setItem('FAIVV_VECTOR_EDIT_DEBUG', '1')
 *   // 또는
 *   window.FAIVV_VECTOR_EDIT_DEBUG = true
 *
 * 참고 envelope (AI torch tip/grip):
 *   /assets/ast_01KZADC2DVW4ZP7P9KAT37ZYN2/content
 *   → data.lsfResult.value.sequence[].keypoints|vertices
 */

export function isFaivvVectorEditDebugEnabled() {
  try {
    if (typeof window !== "undefined") {
      if (window.FAIVV_VECTOR_EDIT_DEBUG === true) return true;
      if (window.FAIVV_VECTOR_EDIT_DEBUG === false) return false;
      if (window.localStorage?.getItem("FAIVV_VECTOR_EDIT_DEBUG") === "1") {
        return true;
      }
    }
  } catch (e) {
    /* noop */
  }
  return false;
}

function round3(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : n;
}

const EPS = 1e-3;

function pointKey(p) {
  return String(p?.name ?? p?.id ?? "");
}

function pointsEqual(a, b) {
  if (!Array.isArray(a) && !Array.isArray(b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const byKey = new Map();
  for (const p of b) {
    byKey.set(pointKey(p), p);
  }
  for (const p of a) {
    const o = byKey.get(pointKey(p));
    if (!o) return false;
    if (Math.abs(Number(p.x) - Number(o.x)) > EPS) return false;
    if (Math.abs(Number(p.y) - Number(o.y)) > EPS) return false;
  }
  return true;
}

/** keypoints(name) ↔ vertices(id) 좌표가 같은지. */
export function keypointsMatchVertices(keypoints, vertices) {
  if (!Array.isArray(keypoints) || !keypoints.length) return null;
  if (!Array.isArray(vertices) || !vertices.length) return null;
  if (keypoints.length !== vertices.length) return false;
  const byId = new Map();
  for (const v of vertices) {
    byId.set(String(v?.id ?? v?.name ?? ""), v);
  }
  for (const k of keypoints) {
    const id = String(k?.name ?? k?.id ?? "");
    const v = byId.get(id);
    if (!v) return false;
    if (Math.abs(Number(k.x) - Number(v.x)) > EPS) return false;
    if (Math.abs(Number(k.y) - Number(v.y)) > EPS) return false;
  }
  return true;
}

export function summarizeVertices(vertices) {
  if (!Array.isArray(vertices)) return null;
  return vertices.map((v) => ({
    id: v?.id ?? v?.name ?? null,
    x: round3(v?.x),
    y: round3(v?.y),
    prev: v?.prevPointId ?? null,
  }));
}

export function summarizeKeypoints(keypoints) {
  if (!Array.isArray(keypoints)) return null;
  return keypoints.map((k) => ({
    name: k?.name ?? k?.id ?? null,
    x: round3(k?.x),
    y: round3(k?.y),
    conf: k?.confidence != null ? round3(k.confidence) : undefined,
  }));
}

export function summarizeBbox(shape) {
  if (!shape) return null;
  if (
    shape.x == null &&
    shape.y == null &&
    shape.width == null &&
    shape.height == null
  ) {
    return null;
  }
  return {
    x: round3(shape.x),
    y: round3(shape.y),
    width: round3(shape.width),
    height: round3(shape.height),
  };
}

export function summarizeKeyframe(kf) {
  if (!kf || typeof kf !== "object") return null;
  const kp = kf.keypoints || kf.pose;
  const vert = kf.vertices;
  return {
    frame: kf.frame,
    enabled: kf.enabled,
    bbox: summarizeBbox(kf),
    keypoints: summarizeKeypoints(kp),
    vertices: summarizeVertices(vert),
    kpMatchVert: keypointsMatchVertices(kp, vert),
  };
}

/**
 * before KF vs after(merged) 에서 keypoints / vertices 각각 바뀌었는지.
 * VideoVector.commit 은 vertices만 넘기고 keypoints는 merge로 잔존 → stale 가능.
 */
export function diffKeypointsVsVertices(beforeKf, afterKf) {
  const beforeKp = beforeKf?.keypoints || beforeKf?.pose || null;
  const afterKp = afterKf?.keypoints || afterKf?.pose || null;
  const beforeVert = beforeKf?.vertices || null;
  const afterVert = afterKf?.vertices || null;

  const keypointsChanged = !pointsEqual(beforeKp, afterKp);
  const verticesChanged = !pointsEqual(beforeVert, afterVert);
  const afterKpMatchVert = keypointsMatchVertices(afterKp, afterVert);

  let verdict = "unchanged";
  if (verticesChanged && !keypointsChanged) {
    verdict = "vertices_only (keypoints stale — Dart dirty가 KP만 보면 false)";
  } else if (keypointsChanged && !verticesChanged) {
    verdict = "keypoints_only";
  } else if (keypointsChanged && verticesChanged) {
    verdict =
      afterKpMatchVert === false
        ? "both_changed_but_diverged"
        : "both_changed";
  } else if (afterKpMatchVert === false) {
    verdict = "coords_diverged_without_edit_signal";
  }

  return {
    keypointsChanged,
    verticesChanged,
    afterKpMatchVert,
    beforeKpMatchVert: keypointsMatchVertices(beforeKp, beforeVert),
    verdict,
    before: {
      keypoints: summarizeKeypoints(beforeKp),
      vertices: summarizeVertices(beforeVert),
    },
    after: {
      keypoints: summarizeKeypoints(afterKp),
      vertices: summarizeVertices(afterVert),
    },
  };
}

/** updateShape merge 미리보기 (MST spread와 동일). */
export function previewMergedKeyframe(beforeKf, data, frame) {
  return {
    ...(beforeKf && typeof beforeKf === "object" ? beforeKf : {}),
    ...(data || {}),
    frame,
    enabled: data?.enabled ?? beforeKf?.enabled ?? true,
  };
}

export function regionDebugMeta(reg) {
  if (!reg) return {};
  let fromName = "";
  try {
    fromName =
      reg.labeling?.name ||
      reg.results?.[0]?.from_name ||
      "";
  } catch (e) {
    /* noop */
  }
  let source = "manual";
  try {
    source = reg.segmentSource || reg.source || "manual";
  } catch (e2) {
    /* noop */
  }
  let conf = null;
  try {
    if (reg.confidence != null && Number.isFinite(Number(reg.confidence))) {
      conf = Number(reg.confidence);
    } else if (reg.inferenceConfidence != null) {
      conf = Number(reg.inferenceConfidence);
    }
  } catch (e3) {
    /* noop */
  }
  return {
    id: String(reg.cleanId || reg.id || ""),
    regionType: String(reg.type || ""),
    softSplitPanel: (() => {
      const fn = String(fromName);
      if (fn === "box") return "VideoRectangle(box)";
      if (fn === "video_vector") return "VideoVectorLabels(video_vector)";
      if (fn === "pose") return "legacy from_name=pose (VideoPoseLabels UI removed)";
      return fn ? `other(${fn})` : "";
    })(),
    segmentId: String(reg.segmentId || reg.videoSegmentId || ""),
    fromName: String(fromName),
    source: String(source),
    confidence: conf,
    type: reg.type || reg.annotation?.type || "",
  };
}

/**
 * @param {string} phase e.g. 'VideoVector.commit' | 'updateShape' | 'save.serialize'
 * @param {object} payload
 */
export function logFaivvVectorEdit(phase, payload) {
  if (!isFaivvVectorEditDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`[faivv-vector-edit] ${phase}`, payload);
  } catch (e) {
    /* noop */
  }
}

/** MST updateShape 전후 — keypoints vs vertices 각각 변경 여부. */
export function logRegionShapeUpdate(reg, frame, data, beforeKf) {
  if (!isFaivvVectorEditDebugEnabled()) return;
  const merged = previewMergedKeyframe(beforeKf, data, frame);
  const kpVsVert = diffKeypointsVsVertices(beforeKf, merged);
  logFaivvVectorEdit("region.updateShape", {
    ...regionDebugMeta(reg),
    frame,
    rawKeys: Object.keys(data || {}),
    kpVsVert,
    before: summarizeKeyframe(beforeKf),
    afterMerged: summarizeKeyframe(merged),
    hint:
      reg?.type === "videoposeregion"
        ? "AI tip/grip → VideoPoseRegion + VideoVectorShape (vertices). VectorRegion(image) 아님"
        : reg?.type === "videovectorregion"
          ? "수동 video_vector → VideoVectorRegion"
          : undefined,
  });
}

/** serialize 직전 sequence 에서 KP↔vertices 불일치 프레임 샘플. */
export function logRegionSerialize(reg, sequence) {
  if (!isFaivvVectorEditDebugEnabled()) return;
  if (!Array.isArray(sequence)) return;

  let withKp = 0;
  let withVert = 0;
  let diverged = 0;
  let bothOk = 0;
  const samples = [];

  for (const kf of sequence) {
    if (!kf || kf.enabled === false) continue;
    const kp = kf.keypoints || kf.pose;
    const vert = kf.vertices;
    const hasKp = Array.isArray(kp) && kp.length > 0;
    const hasVert = Array.isArray(vert) && vert.length > 0;
    if (hasKp) withKp++;
    if (hasVert) withVert++;
    if (!hasKp && !hasVert) continue;
    const match = keypointsMatchVertices(kp, vert);
    if (match === true) bothOk++;
    if (match === false) {
      diverged++;
      if (samples.length < 4) {
        samples.push({
          frame: kf.frame,
          keypoints: summarizeKeypoints(kp),
          vertices: summarizeVertices(vert),
          match,
        });
      }
    }
  }

  logFaivvVectorEdit("region.serialize", {
    ...regionDebugMeta(reg),
    seqLen: sequence.length,
    enabledWithKp: withKp,
    enabledWithVert: withVert,
    kpVertOk: bothOk,
    kpVertDiverged: diverged,
    divergedSamples: samples,
    hint:
      diverged > 0
        ? "vertices만 편집되고 keypoints가 남으면 Dart dirty(KP 비교)가 false"
        : undefined,
  });
}
