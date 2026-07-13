import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import PropTypes from "prop-types";

import SegmentAttachmentsPanel from "../SegmentAttachments/SegmentAttachmentsPanel";
import {
  bindDocumentDrag,
  pxToSec,
  resizeHandleAt,
  trackXFromEvent,
} from "./utils/laneInteraction";
import { subscribeMediaPlayhead } from "./utils/mediaSync";
import styles from "./MultimodalTimelineView.module.scss";

const LANE_LABELS = {
  audio: "오디오 구간",
  subtitle: "자막",
  object: "객체",
  saved_attachment: "저장 첨부",
};

const LANE_ROW_CLASS = {
  audio: styles.laneAudio,
  subtitle: styles.laneSubtitle,
  object: styles.laneObject,
  saved_attachment: styles.laneSavedAttachment,
};

const PX_PER_SEC_DEFAULT = 80;
const MIN_TRACK_WIDTH = 640;

const HINT_MESSAGES = {
  no_label: "오디오 구간 라벨을 먼저 선택하세요.",
  too_short: "구간이 너무 짧습니다.",
  no_audio: "오디오가 로드되지 않았습니다.",
  create_failed: "구간을 만들 수 없습니다.",
};

function formatTime(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? `0${s}` : s}`;
}

function MultimodalTimelineView({ item, className }) {
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [draftSpan, setDraftSpan] = useState(null);
  const [hint, setHint] = useState("");
  const scrollRef = useRef(null);
  const lastAutoScrollRef = useRef(0);
  const dragCleanupRef = useRef(null);

  const laneClips = item.laneClips || {};
  const laneKeys = laneKeysFromClips(laneClips);
  const height = Number(item.height) || 200;
  const readOnly = typeof item.isReadOnly === "function" ? item.isReadOnly() : false;

  const pxPerSec = PX_PER_SEC_DEFAULT;
  const resolvedDuration = duration > 0 ? duration : item.durationSec || 0;
  const trackWidth = Math.max(MIN_TRACK_WIDTH, Math.ceil(Math.max(resolvedDuration, 1) * pxPerSec));

  const attachmentPanel = item.embedAttachmentsPanel ? item.attachmentPanelProps : null;
  const selectedLabel = item.selectedAudioSegmentLabel || "";

  useEffect(() => {
    const cleanup = subscribeMediaPlayhead({
      audioObject: item.audioObject,
      videoObject: item.videoObject,
      onTime: setPlayhead,
      onDuration: setDuration,
    });
    return cleanup;
  }, [item.audioObject, item.videoObject, item.audioObject?._ws, item.videoObject?.ref?.current]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const rid = item.selectedRegionId;
    if (rid) {
      item.attachmentsControl?.ensureBucketForSelection?.();
    }
  }, [item, item.selectedRegionId]);

  const rulerTicks = useMemo(() => {
    const ticks = [];
    const step = resolvedDuration > 60 ? 10 : resolvedDuration > 20 ? 5 : 2;
    const max = Math.max(resolvedDuration, 1);
    for (let t = 0; t <= max; t += step) {
      ticks.push({ time: t, left: t * pxPerSec });
    }
    return ticks;
  }, [resolvedDuration, pxPerSec]);

  const playheadLeft = playhead * pxPerSec;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (now - lastAutoScrollRef.current < 80) return;
    lastAutoScrollRef.current = now;

    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    const margin = 48;
    const head = playheadLeft;

    if (head < viewLeft + margin || head > viewRight - margin) {
      el.scrollLeft = Math.max(0, head - el.clientWidth * 0.3);
    }
  }, [playheadLeft]);

  const showHint = useCallback((reason) => {
    setHint(HINT_MESSAGES[reason] || "");
    window.setTimeout(() => setHint(""), 2800);
  }, []);

  const onClipClick = (clip) => {
    item.selectClip(clip);
  };

  const beginAudioDraw = useCallback(
    (e, trackEl) => {
      if (readOnly) return;
      dragCleanupRef.current?.();

      const anchorSec = pxToSec(trackXFromEvent(e, trackEl, scrollRef.current), pxPerSec);

      const onMove = (ev) => {
        const currentSec = pxToSec(trackXFromEvent(ev, trackEl, scrollRef.current), pxPerSec);
        const start = Math.min(anchorSec, currentSec);
        const end = Math.max(anchorSec, currentSec);
        setDraftSpan({ start, end });
      };

      const onEnd = (ev) => {
        const currentSec = pxToSec(trackXFromEvent(ev, trackEl, scrollRef.current), pxPerSec);
        const start = Math.min(anchorSec, currentSec);
        const end = Math.max(anchorSec, currentSec);
        setDraftSpan(null);

        const result = item.createAudioRegion(start, end);
        if (!result?.ok) {
          showHint(result?.reason || "create_failed");
        } else {
          setHint("");
        }
      };

      dragCleanupRef.current = bindDocumentDrag({ onMove, onEnd });
      setDraftSpan({ start: anchorSec, end: anchorSec });
    },
    [item, pxPerSec, readOnly, showHint],
  );

  const beginAudioResize = useCallback(
    (e, clip, edge) => {
      if (readOnly || !clip?.region) return;
      e.preventDefault();
      e.stopPropagation();
      dragCleanupRef.current?.();

      const region = clip.region;
      const trackEl = e.currentTarget.closest(`.${styles.laneTrack}`);
      const origStart = region.start;
      const origEnd = region.end;

      const onMove = (ev) => {
        const sec = pxToSec(trackXFromEvent(ev, trackEl, scrollRef.current), pxPerSec);
        if (edge === "start") {
          setDraftSpan({ start: sec, end: origEnd, regionId: region.id });
        } else {
          setDraftSpan({ start: origStart, end: sec, regionId: region.id });
        }
      };

      const onEnd = (ev) => {
        const sec = pxToSec(trackXFromEvent(ev, trackEl, scrollRef.current), pxPerSec);
        const start = edge === "start" ? sec : origStart;
        const end = edge === "end" ? sec : origEnd;
        setDraftSpan(null);

        const ok = item.resizeAudioRegion(region, start, end);
        if (!ok) showHint("too_short");
      };

      dragCleanupRef.current = bindDocumentDrag({ onMove, onEnd });
    },
    [item, pxPerSec, readOnly, showHint],
  );

  const onAudioClipMouseDown = useCallback(
    (e, clip) => {
      if (readOnly) return;

      const handle = resizeHandleAt(e.clientX, e.currentTarget);
      if (handle) {
        beginAudioResize(e, clip, handle);
        return;
      }

      e.preventDefault();
      item.selectClip(clip);
    },
    [beginAudioResize, item, readOnly],
  );

  const resolveContentUrl =
    typeof window !== "undefined" &&
    window.FaivvAssetUpload &&
    typeof window.FaivvAssetUpload.resolveContentUrl === "function"
      ? window.FaivvAssetUpload.resolveContentUrl.bind(window.FaivvAssetUpload)
      : null;

  if (!resolvedDuration && laneKeys.length === 0) {
    return (
      <div className={[styles.multimodalTimeline, className].filter(Boolean).join(" ")} style={{ minHeight: height }}>
        <div className={styles.empty}>미디어가 로드되면 통합 타임라인이 표시됩니다.</div>
      </div>
    );
  }

  return (
    <div
      className={[styles.multimodalTimeline, className].filter(Boolean).join(" ")}
      style={{ minHeight: height }}
      data-testid="multimodal-timeline"
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>통합 타임라인</span>
          {selectedLabel ? (
            <span className={styles.labelChip}>{selectedLabel}</span>
          ) : (
            <span className={styles.labelHint}>구간 라벨 선택 후 드래그로 구간 생성</span>
          )}
        </div>
        <span className={styles.duration}>
          {formatTime(playhead)} / {formatTime(resolvedDuration)}
        </span>
      </div>

      {hint ? <div className={styles.hint}>{hint}</div> : null}

      <div className={styles.timelineBody}>
        <div className={styles.laneLabelsColumn} aria-hidden="true">
          <div className={styles.rulerLabelSpacer} />
          {laneKeys.map((laneKey) => (
            <div key={laneKey} className={styles.laneLabel}>
              {LANE_LABELS[laneKey] || laneKey}
            </div>
          ))}
        </div>

        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.inner} style={{ width: trackWidth }}>
            <div className={styles.ruler}>
              {rulerTicks.map((tick) => (
                <div key={tick.time} className={styles.rulerTick} style={{ left: tick.left }}>
                  {formatTime(tick.time)}
                </div>
              ))}
            </div>

            <div className={styles.lanes}>
              <div className={styles.playhead} style={{ left: playheadLeft }} />
              {laneKeys.map((laneKey) => (
                <LaneRow
                  key={laneKey}
                  laneKey={laneKey}
                  clips={laneClips[laneKey] || []}
                  trackWidth={trackWidth}
                  pxPerSec={pxPerSec}
                  selectedId={item.selectedRegionId}
                  readOnly={readOnly}
                  draftSpan={laneKey === "audio" ? draftSpan : null}
                  onClipClick={onClipClick}
                  onAudioTrackMouseDown={laneKey === "audio" ? beginAudioDraw : undefined}
                  onAudioClipMouseDown={laneKey === "audio" ? onAudioClipMouseDown : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {attachmentPanel ? (
        <div className={styles.attachments}>
          <SegmentAttachmentsPanel
            item={attachmentPanel.item}
            selectedRegionId={attachmentPanel.selectedRegionId}
            selectedMeta={attachmentPanel.selectedMeta}
            persisted={attachmentPanel.persisted}
            pending={attachmentPanel.pending}
            savedOnly={attachmentPanel.savedOnly}
            savedSegmentRegionId={attachmentPanel.savedSegmentRegionId}
            readOnly={attachmentPanel.readOnly}
            resolveContentUrl={resolveContentUrl}
            className={styles.attachmentsPanel}
            embedded
          />
        </div>
      ) : null}
    </div>
  );
}

function laneKeysFromClips(laneClips) {
  const order = ["audio", "subtitle", "object", "saved_attachment"];
  return order.filter((k) => Array.isArray(laneClips[k]));
}

function LaneRow({
  laneKey,
  clips,
  trackWidth,
  pxPerSec,
  selectedId,
  readOnly,
  draftSpan,
  onClipClick,
  onAudioTrackMouseDown,
  onAudioClipMouseDown,
}) {
  const laneClass = LANE_ROW_CLASS[laneKey] || "";
  const isAudioLane = laneKey === "audio";

  const renderClip = (clip, options = {}) => {
    const { draft = false } = options;
    const width = Math.max((clip.end - clip.start) * pxPerSec, 6);
    const left = clip.start * pxPerSec;
    const isObjectLane = laneKey === "object";
    const selected = isObjectLane
      ? !!(clip.region?.selected || clip.region?.highlighted || clip.region?.inSelection)
      : !!(selectedId && (clip.regionId === selectedId || clip.id === selectedId));
    const color = clip.meta?.color;
    const clipStyle = {
      left,
      width,
      ...(isObjectLane && color
        ? {
            background: color,
            borderColor: color,
            color: "#fff",
          }
        : {}),
    };

    return (
      <div
        key={`${laneKey}-${clip.id}${draft ? "-draft" : ""}`}
        className={[
          styles.clip,
          selected ? styles.clipSelected : "",
          draft ? styles.clipDraft : "",
          isAudioLane && !readOnly ? styles.clipInteractive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={clipStyle}
        title={clip.meta?.subtitlePreview || clip.label}
        onClick={draft || isAudioLane ? undefined : () => onClipClick(clip)}
        onMouseDown={isAudioLane && !draft ? (e) => onAudioClipMouseDown?.(e, clip) : undefined}
        role="button"
        tabIndex={draft ? -1 : 0}
        onKeyDown={
          draft
            ? undefined
            : (e) => {
                if (e.key === "Enter" || e.key === " ") onClipClick(clip);
              }
        }
      >
        {isAudioLane && !readOnly && !draft ? (
          <>
            <span className={styles.resizeHandleStart} />
            <span className={styles.resizeHandleEnd} />
          </>
        ) : null}
        {clip.label}
        {clip.meta?.attachmentCount ? ` (📎${clip.meta.attachmentCount})` : ""}
      </div>
    );
  };

  const draftClip =
    draftSpan && isAudioLane
      ? {
          id: "draft",
          start: draftSpan.start,
          end: draftSpan.end,
          label: draftSpan.regionId ? "" : "새 구간",
        }
      : null;

  return (
    <div className={[styles.lane, laneClass].filter(Boolean).join(" ")}>
      <div
        className={[styles.laneTrack, isAudioLane && !readOnly ? styles.laneTrackInteractive : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ width: trackWidth }}
        onMouseDown={
          isAudioLane && onAudioTrackMouseDown
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                onAudioTrackMouseDown(e, e.currentTarget);
              }
            : undefined
        }
      >
        {clips.map((clip) => {
          if (draftSpan?.regionId && clip.region?.id === draftSpan.regionId) {
            return renderClip(
              {
                ...clip,
                start: draftSpan.start,
                end: draftSpan.end,
              },
              { draft: true },
            );
          }
          return renderClip(clip);
        })}
        {draftClip && !draftSpan?.regionId ? renderClip(draftClip, { draft: true }) : null}
      </div>
    </div>
  );
}

LaneRow.propTypes = {
  laneKey: PropTypes.string.isRequired,
  clips: PropTypes.array.isRequired,
  trackWidth: PropTypes.number.isRequired,
  pxPerSec: PropTypes.number.isRequired,
  selectedId: PropTypes.string,
  readOnly: PropTypes.bool,
  draftSpan: PropTypes.object,
  onClipClick: PropTypes.func.isRequired,
  onAudioTrackMouseDown: PropTypes.func,
  onAudioClipMouseDown: PropTypes.func,
};

MultimodalTimelineView.propTypes = {
  item: PropTypes.object.isRequired,
  className: PropTypes.string,
};

export default observer(MultimodalTimelineView);
