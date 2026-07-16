/**
 * Frames `lsf-keypoints` 와 동일한 lifespan+point UI를 초 좌표(pxPerSec)로 그린다.
 * TimelineContext(step/frame)에 의존하지 않는다.
 */
import { useMemo } from "react";
import PropTypes from "prop-types";

import { keyframesSecInSpan } from "./utils/objectLifespan";
import styles from "./MultimodalTimelineView.module.scss";

/** 뷰포트 밖 여유(초). */
const VIEW_MARGIN_SEC = 2;
/** 점 최소 간격(px) — 밀집 키프레임 샘플링. */
const MIN_POINT_GAP_PX = 3;

function cullAndSamplePoints(timesSec, visibleMin, visibleMax, pxPerSec) {
  if (!timesSec?.length) return [];
  const minGapSec = MIN_POINT_GAP_PX / Math.max(pxPerSec, 1);
  const out = [];
  let last = -Infinity;

  for (let i = 0; i < timesSec.length; i++) {
    const t = timesSec[i];
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    if (t < visibleMin || t > visibleMax) continue;
    if (t - last < minGapSec && out.length) continue;
    out.push(t);
    last = t;
  }

  // 구간의 첫·끝 점이 샘플에서 빠지지 않게 보정
  const firstInView = timesSec.find((t) => t >= visibleMin && t <= visibleMax);
  const lastInView = [...timesSec].reverse().find((t) => t >= visibleMin && t <= visibleMax);
  if (firstInView != null && out[0] !== firstInView) out.unshift(firstInView);
  if (lastInView != null && out[out.length - 1] !== lastInView) out.push(lastInView);

  return out;
}

function PoseKeypointsRow({
  clips,
  pxPerSec,
  scrollLeft = 0,
  viewportWidth = 0,
  selectedId,
  onClipClick,
}) {
  const visibleMin =
    viewportWidth > 0 ? Math.max(0, scrollLeft / pxPerSec - VIEW_MARGIN_SEC) : 0;
  const visibleMax =
    viewportWidth > 0
      ? (scrollLeft + viewportWidth) / pxPerSec + VIEW_MARGIN_SEC
      : Number.POSITIVE_INFINITY;

  const spans = useMemo(() => {
    return (clips || []).map((clip) => {
      const fps = Number(clip.meta?.fps) || 24;
      const range = clip.meta?.frameRange || [];
      const startFrame = range[0];
      const endFrame = range[1];
      const keyframesSec = keyframesSecInSpan(clip.region, startFrame, endFrame, fps);
      const points = cullAndSamplePoints(keyframesSec, visibleMin, visibleMax, pxPerSec);
      const selected = !!(
        clip.region?.selected ||
        clip.region?.highlighted ||
        clip.region?.inSelection ||
        (selectedId && (clip.regionId === selectedId || clip.id === selectedId))
      );
      return { clip, points, selected };
    });
  }, [clips, visibleMin, visibleMax, pxPerSec, selectedId]);

  return (
    <div className={styles.keypointsTrack}>
      {spans.map(({ clip, points, selected }) => {
        const width = Math.max((clip.end - clip.start) * pxPerSec, 4);
        const left = clip.start * pxPerSec;
        const color = clip.meta?.color || "var(--grape_500)";
        const lifespanStyle = {
          left,
          width,
          "--lifespan-color": color,
          "--point-color": color,
        };

        return (
          <div
            key={clip.id}
            className={[styles.keypointsLifespan, selected ? styles.keypointsLifespanSelected : ""]
              .filter(Boolean)
              .join(" ")}
            style={lifespanStyle}
            title={clip.label}
            role="button"
            tabIndex={0}
            onClick={() => onClipClick?.(clip)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onClipClick?.(clip);
            }}
          >
            {points.map((t) => {
              const pointLeft = (t - clip.start) * pxPerSec;
              return (
                <span
                  key={`${clip.id}-${t}`}
                  className={styles.keypointsPoint}
                  style={{ left: pointLeft }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

PoseKeypointsRow.propTypes = {
  clips: PropTypes.array.isRequired,
  pxPerSec: PropTypes.number.isRequired,
  scrollLeft: PropTypes.number,
  viewportWidth: PropTypes.number,
  selectedId: PropTypes.string,
  onClipClick: PropTypes.func,
};

export default PoseKeypointsRow;
