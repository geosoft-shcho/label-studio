/**
 * Frames `lsf-keypoints` 와 동일한 lifespan+point UI를 초 좌표(pxPerSec)로 그린다.
 * TimelineContext(step/frame)에 의존하지 않는다.
 * 설계-20 §9: laneKind(source) / clip.meta.confidence(UI 점수) /
 * clip.meta.reviewed(검수) 로 시각 구분.
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

function formatConfidence(conf) {
  if (conf == null || !Number.isFinite(Number(conf))) return "";
  return Number(conf).toFixed(2);
}

function PoseKeypointsRow({
  clips,
  laneKind,
  pxPerSec,
  scrollLeft = 0,
  viewportWidth = 0,
  selectedId,
  onClipClick,
}) {
  const isAutoLane = laneKind === "pose_object";
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
      const conf =
        clip.meta?.confidence != null && Number.isFinite(Number(clip.meta.confidence))
          ? Number(clip.meta.confidence)
          : null;
      const reviewed = clip.meta?.reviewed === true;
      return { clip, points, selected, conf, reviewed };
    });
  }, [clips, visibleMin, visibleMax, pxPerSec, selectedId]);

  return (
    <div className={styles.keypointsTrack}>
      {spans.map(({ clip, points, selected, conf, reviewed }) => {
        const width = Math.max((clip.end - clip.start) * pxPerSec, 4);
        const left = clip.start * pxPerSec;
        const color =
          clip.meta?.color || (isAutoLane ? "var(--grape_500)" : "var(--plum_500)");
        const lifespanStyle = {
          left,
          width,
          "--lifespan-color": color,
          "--point-color": color,
        };
        const confText = formatConfidence(conf);
        const titleParts = [clip.label || clip.meta?.laneLabel || ""];
        if (isAutoLane) titleParts.unshift("AI");
        if (confText) titleParts.push(`conf ${confText}`);
        if (reviewed) titleParts.push("검수");
        const title = titleParts.filter(Boolean).join(" · ");

        return (
          <div
            key={clip.id}
            className={[
              styles.keypointsLifespan,
              isAutoLane ? styles.keypointsLifespanAuto : styles.keypointsLifespanManual,
              reviewed ? styles.keypointsLifespanReviewed : "",
              selected ? styles.keypointsLifespanSelected : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={lifespanStyle}
            title={title}
            role="button"
            tabIndex={0}
            onClick={() => onClipClick?.(clip)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onClipClick?.(clip);
            }}
          >
            {isAutoLane ? (
              <span className={styles.keypointsAiBadge} aria-hidden="true">
                AI{confText ? ` ${confText}` : ""}
                {reviewed ? " · 검수" : ""}
              </span>
            ) : reviewed ? (
              <span className={styles.keypointsReviewedBadge} aria-hidden="true">
                검수
              </span>
            ) : null}
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
  laneKind: PropTypes.string,
  pxPerSec: PropTypes.number.isRequired,
  scrollLeft: PropTypes.number,
  viewportWidth: PropTypes.number,
  selectedId: PropTypes.string,
  onClipClick: PropTypes.func,
};

export default PoseKeypointsRow;
