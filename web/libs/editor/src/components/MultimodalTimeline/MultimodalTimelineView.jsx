import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import PropTypes from "prop-types";

import SegmentAttachmentsPanel from "../SegmentAttachments/SegmentAttachmentsPanel";
import PoseKeypointsRow from "./PoseKeypointsRow";
import {
  bindDocumentDrag,
  pxToSec,
  resizeHandleAt,
  trackXFromEvent,
} from "./utils/laneInteraction";
import { subscribeMediaPlayhead } from "./utils/mediaSync";
import styles from "./MultimodalTimelineView.module.scss";

const LANE_LABELS = {
  // lane 키는 호환 유지 — UI 카피는 설계-20 수동/자동
  stt: "STT 자동",
  audio_manual: "수동 자막",
  object: "수동 객체",
  pose_object: "자동(POSE)",
  saved_attachment: "저장 첨부",
  relation: "관계",
};

const LANE_ROW_CLASS = {
  stt: styles.laneStt,
  audio_manual: styles.laneAudioManual,
  object: styles.laneObject,
  pose_object: styles.lanePoseObject,
  saved_attachment: styles.laneSavedAttachment,
  relation: styles.laneRelation,
};

const PX_PER_SEC_DEFAULT = 80;
const MIN_TRACK_WIDTH = 640;

const HINT_MESSAGES = {
  no_label: "오디오 구간 라벨(audio_segments)을 먼저 선택하세요.",
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
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef(null);
  const lastAutoScrollRef = useRef(0);
  const dragCleanupRef = useRef(null);

  const laneClips = item.laneClips || {};
  const laneRows = timelineRowsFromClips(laneClips);
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
    if (!el) return undefined;

    const syncViewport = () => {
      setScrollLeft(el.scrollLeft);
      setViewportWidth(el.clientWidth);
    };

    syncViewport();
    el.addEventListener("scroll", syncViewport, { passive: true });
    let ro = null;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(syncViewport);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", syncViewport);
      ro?.disconnect();
    };
  }, []);

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

  if (!resolvedDuration && laneRows.length === 0) {
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
          {laneRows.map((row) => (
            <div
              key={row.key}
              className={[
                styles.laneLabel,
                row.kind === "object" || row.kind === "pose_object" ? styles.laneLabelKeypoints : "",
                row.kind === "object" ? styles.laneLabelObject : "",
                row.kind === "pose_object" ? styles.laneLabelPoseObject : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={row.label}
            >
              {row.kind === "pose_object" ? (
                <span className={styles.laneSourceBadge} aria-hidden="true">
                  AI
                </span>
              ) : null}
              {row.label}
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
              {laneRows.map((row) => (
                <LaneRow
                  key={row.key}
                  laneKey={row.key}
                  laneKind={row.kind}
                  clips={row.clips}
                  trackWidth={trackWidth}
                  pxPerSec={pxPerSec}
                  scrollLeft={scrollLeft}
                  viewportWidth={viewportWidth}
                  selectedId={item.selectedRegionId}
                  readOnly={readOnly}
                  draftSpan={row.kind === "audio_manual" ? draftSpan : null}
                  onClipClick={onClipClick}
                  onAudioTrackMouseDown={row.kind === "audio_manual" ? beginAudioDraw : undefined}
                  onAudioClipMouseDown={
                    row.kind === "stt" || row.kind === "audio_manual"
                      ? onAudioClipMouseDown
                      : undefined
                  }
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

function timelineRowsFromClips(laneClips) {
  const order = ["stt", "audio_manual", "object", "pose_object", "saved_attachment", "relation"];
  const orderIndex = new Map(order.map((kind, index) => [kind, index]));
  return Object.entries(laneClips)
    .filter(([, clips]) => Array.isArray(clips))
    .map(([key, clips]) => {
      const kind = key.split(":")[0];
      const firstClip = clips[0];
      const segmentId = String(firstClip?.meta?.segmentId || "").trim();
      return {
        key,
        kind,
        clips,
        label: firstClip?.meta?.laneLabel || LANE_LABELS[kind] || kind,
        start: firstClip?.start ?? 0,
        segmentId,
        regionId: firstClip?.regionId || "",
      };
    })
    .sort((a, b) => {
      const kindOrder = (orderIndex.get(a.kind) ?? order.length) - (orderIndex.get(b.kind) ?? order.length);
      if (kindOrder !== 0) return kindOrder;
      return a.start - b.start || (a.segmentId || a.regionId).localeCompare(b.segmentId || b.regionId);
    });
}

function LaneRow({
  laneKey,
  laneKind,
  clips,
  trackWidth,
  pxPerSec,
  scrollLeft,
  viewportWidth,
  selectedId,
  readOnly,
  draftSpan,
  onClipClick,
  onAudioTrackMouseDown,
  onAudioClipMouseDown,
}) {
  const laneClass = LANE_ROW_CLASS[laneKind] || "";
  // 수동 자막 레인에서만 신규 드래그. STT·수동 모두 클립 리사이즈 가능.
  const isAudioDrawLane = laneKind === "audio_manual";
  const isAudioClipLane = laneKind === "stt" || laneKind === "audio_manual";
  const isKeypointsLane = laneKind === "object" || laneKind === "pose_object";

  const renderClip = (clip, options = {}) => {
    const { draft = false } = options;
    const width = Math.max((clip.end - clip.start) * pxPerSec, 6);
    const left = clip.start * pxPerSec;
    const selected = !!(selectedId && (clip.regionId === selectedId || clip.id === selectedId));
    const clipStyle = { left, width };

    return (
      <div
        key={`${laneKey}-${clip.id}${draft ? "-draft" : ""}`}
        className={[
          styles.clip,
          selected ? styles.clipSelected : "",
          draft ? styles.clipDraft : "",
          isAudioClipLane && !readOnly ? styles.clipInteractive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={clipStyle}
        title={clip.meta?.subtitlePreview || clip.meta?.labelPreview || clip.label}
        onClick={draft || isAudioClipLane ? undefined : () => onClipClick(clip)}
        onMouseDown={isAudioClipLane && !draft ? (e) => onAudioClipMouseDown?.(e, clip) : undefined}
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
        {isAudioClipLane && !readOnly && !draft ? (
          <>
            <span className={styles.resizeHandleStart} />
            <span className={styles.resizeHandleEnd} />
          </>
        ) : null}
        <span className={styles.clipText}>
          {clip.label}
          {clip.meta?.attachmentCount ? ` (📎${clip.meta.attachmentCount})` : ""}
        </span>
      </div>
    );
  };

  const draftClip =
    draftSpan && isAudioDrawLane
      ? {
          id: "draft",
          start: draftSpan.start,
          end: draftSpan.end,
          label: draftSpan.regionId ? "" : "새 구간",
        }
      : null;

  return (
    <div className={[styles.lane, isKeypointsLane ? styles.laneKeypoints : "", laneClass].filter(Boolean).join(" ")}>
      <div
        className={[styles.laneTrack, isAudioDrawLane && !readOnly ? styles.laneTrackInteractive : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ width: trackWidth }}
        onMouseDown={
          isAudioDrawLane && onAudioTrackMouseDown
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                onAudioTrackMouseDown(e, e.currentTarget);
              }
            : undefined
        }
      >
        {isKeypointsLane ? (
          <PoseKeypointsRow
            clips={clips}
            laneKind={laneKind}
            pxPerSec={pxPerSec}
            scrollLeft={scrollLeft}
            viewportWidth={viewportWidth}
            selectedId={selectedId}
            onClipClick={onClipClick}
          />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

LaneRow.propTypes = {
  laneKey: PropTypes.string.isRequired,
  laneKind: PropTypes.string.isRequired,
  clips: PropTypes.array.isRequired,
  trackWidth: PropTypes.number.isRequired,
  pxPerSec: PropTypes.number.isRequired,
  scrollLeft: PropTypes.number,
  viewportWidth: PropTypes.number,
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
