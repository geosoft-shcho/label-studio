/**
 * FAIVV Video 수동 라벨링 디버그 (bbox / keypoint).
 *
 * 기본 ON. 끄기:
 *   localStorage.FAIVV_VIDEO_DEBUG = '0'
 *   또는 window.FAIVV_VIDEO_DEBUG = false
 *
 * Flutter 터미널: embed faivvLog → [faivv-ls-v2] videoManual.*
 */
export function isFaivvVideoManualDebugEnabled() {
  try {
    if (typeof window === "undefined") return false;
    if (window.FAIVV_VIDEO_DEBUG === false) return false;
    if (window.FAIVV_VIDEO_DEBUG === true) return true;
    return localStorage.getItem("FAIVV_VIDEO_DEBUG") !== "0";
  } catch {
    return true;
  }
}

function safeJson(detail) {
  try {
    return JSON.stringify(detail, (_k, v) => {
      if (typeof v === "function") return undefined;
      if (v && typeof v === "object" && v.nodeType) return undefined;
      return v;
    });
  } catch {
    try {
      return String(detail);
    } catch {
      return "";
    }
  }
}

/**
 * @param {string} step e.g. 'bbox.gesture' | 'keypoint.commit'
 * @param {object} [detail]
 */
export function faivvVideoManualDebug(step, detail) {
  if (!isFaivvVideoManualDebugEnabled()) return;
  const name = `videoManual.${step}`;
  let line = name;
  if (detail !== undefined) {
    const text = typeof detail === "string" ? detail : safeJson(detail);
    if (text) line = `${name}: ${text}`;
  }
  if (line.length > 4000) {
    line = `${line.slice(0, 4000)}… (truncated, ${line.length} chars)`;
  }
  try {
    console.log(`[faivv-ls-v2] ${line}`);
  } catch {
    /* noop */
  }
  try {
    const log = typeof window !== "undefined" ? window.__faivvLog : null;
    if (typeof log === "function") log(name, detail);
  } catch {
    /* noop */
  }
}

/** region shape 요약 (로그용) */
export function summarizePoseShape(shape) {
  if (!shape) return null;
  const verts = Array.isArray(shape.vertices) ? shape.vertices : [];
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    vertexCount: verts.length,
    vertex0: verts[0]
      ? { id: verts[0].id, x: verts[0].x, y: verts[0].y, prevPointId: verts[0].prevPointId ?? null }
      : null,
    closed: shape.closed ?? false,
  };
}
