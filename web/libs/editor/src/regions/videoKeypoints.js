function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function interpolateKeypoints(kpA, kpB, t) {
  const mapB = {};

  (kpB || []).forEach((k) => {
    if (k?.name) mapB[k.name] = k;
  });

  const out = [];

  (kpA || []).forEach((ka) => {
    const kb = mapB[ka.name];

    if (!kb) {
      out.push({ ...ka });
      return;
    }

    out.push({
      name: ka.name,
      x: lerp(Number(ka.x), Number(kb.x), t),
      y: lerp(Number(ka.y), Number(kb.y), t),
      confidence: lerp(Number(ka.confidence) || 0, Number(kb.confidence) || 0, t),
    });
  });

  return out;
}

function hasKeypoints(keyframe) {
  return Array.isArray(keyframe?.keypoints) && keyframe.keypoints.length > 0;
}

/** sequence 에서 frame 에 맞는 keypoints[] (미디어 %). 보간 포함. */
export function keypointsAtFrame(sequence, frame) {
  if (!Array.isArray(sequence) || sequence.length === 0) return null;

  let exact = null;
  let prev = null;
  let next = null;

  for (const item of sequence) {
    if (!hasKeypoints(item)) continue;

    if (item.frame === frame) {
      exact = item;
      break;
    }

    if (item.frame < frame) {
      prev = item;
      continue;
    }

    if (item.frame > frame) {
      next = item;
      break;
    }
  }

  if (exact) return exact.keypoints;
  if (!prev) return next?.keypoints ?? null;
  if (!next) return prev.keypoints;

  if (prev.frame === next.frame) return prev.keypoints;

  const t = (frame - prev.frame) / (next.frame - prev.frame);

  return interpolateKeypoints(prev.keypoints, next.keypoints, t);
}
