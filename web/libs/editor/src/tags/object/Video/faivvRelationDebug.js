/**
 * FAIVV relation / linking-mode 디버그.
 *
 * 기본 ON. 끄기: localStorage.FAIVV_RELATION_DEBUG = '0'
 * Flutter 터미널: [faivv-ls-v2] relation.*
 */
export function isFaivvRelationDebugEnabled() {
  try {
    if (typeof window === "undefined") return false;
    if (window.FAIVV_RELATION_DEBUG === false) return false;
    if (window.FAIVV_RELATION_DEBUG === true) return true;
    return localStorage.getItem("FAIVV_RELATION_DEBUG") !== "0";
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
 * @param {string} step e.g. 'outliner.select' | 'action.start' | 'link.add'
 * @param {object} [detail]
 */
export function faivvRelationDebug(step, detail) {
  if (!isFaivvRelationDebugEnabled()) return;
  const name = `relation.${step}`;
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

export function summarizeRegionForRelation(reg) {
  if (!reg) return null;
  try {
    return {
      id: reg.id ?? reg.cleanId ?? null,
      type: reg.type ?? null,
      selected: !!reg.selected,
      readOnly: typeof reg.isReadOnly === "function" ? !!reg.isReadOnly() : null,
      label: Array.isArray(reg.labels) ? reg.labels[0] : null,
    };
  } catch {
    return { id: String(reg?.id ?? "") };
  }
}
