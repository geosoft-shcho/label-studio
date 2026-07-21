import { inject, observer } from "mobx-react";
import { types } from "mobx-state-tree";

import MultimodalTimelineView from "../../components/MultimodalTimeline/MultimodalTimelineView";
import { collectAllLaneClips, isAudioRegion } from "../../components/MultimodalTimeline/utils/regionBridge";
import {
  createAudioRegionFromSpan,
  getAudioSegmentLabels,
  resizeAudioRegionSpan,
} from "../../components/MultimodalTimeline/utils/laneInteraction";
import { readDurationSec, readPlayheadSec } from "../../components/MultimodalTimeline/utils/mediaSync";
import Registry from "../../core/Registry";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import { ReadOnlyControlMixin } from "../../mixins/ReadOnlyMixin";
import ControlBase from "./Base";

/**
 * 멀티모달 통합 타임라인 — STT·첨부·비디오 객체를 한 strip에서 표시·선택한다.
 *
 * lane 키: `stt` = STT 자동 (`audio_segments` + transcript).
 *
 * @example
 * <MultimodalTimeline name="mm_timeline" toName="audio" videoToName="video"
 *   audioSegmentsFrom="audio_segments"
 *   transcriptFrom="transcript"
 *   attachmentsFrom="audio_evidence" savedAttachmentsFrom="saved_segment_attachments"
 *   videoObjectsFrom="box" poseObjectsFrom="pose_box" height="200" />
 *
 * @name MultimodalTimeline
 * @param {string} name Control name
 * @param {string} toName Audio object name (master time axis)
 * @param {string} [videoToName] Video object name (object lane frame→sec)
 * @param {string} [audioSegmentsFrom] Labels for STT carrier regions (`audio_segments`, labels 레이어 저장 안 함)
 * @param {string} [transcriptFrom] TextArea perRegion for STT transcript
 * @param {string} [attachmentsFrom] SegmentAttachments control name
 * @param {string} [savedAttachmentsFrom] SavedSegmentAttachments control name
 * @param {string} [videoObjectsFrom] VideoRectangle control for manual objects (`box`)
 * @param {string} [poseObjectsFrom] VideoRectangle control for pose inference (`pose_box`)
 * @param {string} [height] Strip min height in px
 * @param {string} [showLanes] Comma-separated lane keys to show
 * @param {boolean} [embedAttachments] Embed SegmentAttachments panel under timeline
 */
const TagAttrs = types.model({
  toname: types.maybeNull(types.string),
  videotoname: types.maybeNull(types.string),
  audiosegmentsfrom: types.optional(types.string, "audio_segments"),
  transcriptfrom: types.optional(types.string, "transcript"),
  attachmentsfrom: types.optional(types.string, "audio_evidence"),
  savedattachmentsfrom: types.optional(types.string, "saved_segment_attachments"),
  videoobjectsfrom: types.optional(types.string, "box"),
  poseobjectsfrom: types.optional(types.string, "pose_box"),
  height: types.optional(types.string, "200"),
  showlanes: types.optional(types.string, "stt,object,pose_object,saved_attachment"),
  embedattachments: types.optional(types.boolean, true),
});

const Model = types
  .model({
    type: "multimodaltimeline",
  })
  .volatile(() => ({
    /** applyTranscript 등 외부 inject 후 lane clip 재집계 트리거. */
    clipsEpoch: 0,
  }))
  .views((self) => ({
    get valueType() {
      return "multimodaltimeline";
    },
    get toNameTag() {
      return self.annotation?.names?.get(self.toname);
    },
    get audioObject() {
      return self.annotation?.names?.get(self.toname);
    },
    get videoObject() {
      const name = (self.videotoname || "").trim();
      return name ? self.annotation?.names?.get(name) : null;
    },
    get audioSegmentsControl() {
      const name = (self.audiosegmentsfrom || "").trim();
      return name ? self.annotation?.names?.get(name) : null;
    },
    get transcriptControl() {
      const name = (self.transcriptfrom || "").trim();
      return name ? self.annotation?.names?.get(name) : null;
    },
    get attachmentsControl() {
      const name = (self.attachmentsfrom || "").trim();
      return name ? self.annotation?.names?.get(name) : null;
    },
    get savedAttachmentsControl() {
      const name = (self.savedattachmentsfrom || "").trim();
      return name ? self.annotation?.names?.get(name) : null;
    },
    get durationSec() {
      return readDurationSec(self.audioObject, self.videoObject);
    },
    get playheadSec() {
      return readPlayheadSec(self.audioObject, self.videoObject);
    },
    get laneClips() {
      // regionStore / results / clipsEpoch 를 읽어 외부 inject 후에도 observer 가 갱신되게 함.
      // deleteRegion 중 MST reaction 이 죽은 AudioRegion 의 results 를 읽지 않도록 try 로 감싼다.
      try {
        const regions = self.annotation?.regionStore?.regions || [];
        const results = self.annotation?.results || [];
        void self.clipsEpoch;
        void regions.length;
        void results.length;
        return collectAllLaneClips(self);
      } catch (e) {
        return {};
      }
    },
    get selectedRegionId() {
      const ann = self.annotation;
      if (!ann?.regionStore) return "";
      const regions = ann.regionStore.regions || [];
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        if (!isAudioRegion(r)) continue;
        if (r.selected === true || r.highlighted === true || r.inSelection === true) return r.id;
      }
      return "";
    },
    get embedAttachmentsPanel() {
      return self.embedattachments !== false;
    },
    get selectedAudioSegmentLabel() {
      const { labels } = getAudioSegmentLabels(self.audioSegmentsControl);
      return labels.join(", ");
    },
    get attachmentPanelProps() {
      const ctrl = self.attachmentsControl;
      if (!ctrl) return null;
      return {
        item: ctrl,
        selectedRegionId: ctrl.selectedRegionId || self.selectedRegionId,
        selectedMeta: ctrl.selectedMeta,
        persisted: ctrl.selectedPersisted,
        pending: ctrl.selectedPending,
        savedOnly: ctrl.selectedSavedOnlyAttachments,
        savedSegmentRegionId: ctrl.selectedSavedSegment?.regionId,
        readOnly: ctrl.isReadOnly?.() ?? false,
      };
    },
  }))
  .actions((self) => ({
    bumpClips() {
      self.clipsEpoch += 1;
    },

    seekTo(sec) {
      const audio = self.audioObject;
      const video = self.videoObject;
      if (typeof sec !== "number" || !Number.isFinite(sec)) return;
      const clamped = Math.max(0, sec);

      if (audio && typeof audio.handleSyncSeek === "function") {
        audio.handleSyncSeek({ time: clamped, playing: audio._ws?.playing });
      } else if (audio?._ws && typeof audio._ws.setCurrentTime === "function") {
        try {
          audio._ws.setCurrentTime(clamped, true);
          audio._ws.syncCursor?.();
        } catch (e) {
          /* noop */
        }
      }

      if (video?.ref?.current && typeof video.ref.current.currentTime === "number") {
        try {
          video.ref.current.currentTime = clamped;
        } catch (e) {
          /* noop */
        }
      }

      if (typeof audio?.triggerSyncSeek === "function") {
        audio.triggerSyncSeek(clamped);
      } else if (video && typeof video.triggerSync === "function") {
        video.triggerSync("seek", { time: clamped });
      }
    },

    selectClip(clip) {
      if (!clip) return;
      const ann = self.annotation;
      if (!ann) return;

      if (typeof clip.start === "number") {
        self.seekTo(clip.start);
      }

      if ((clip.lane === "object" || clip.lane === "pose_object") && clip.region) {
        ann.regionStore.unselectAll();
        ann.selectArea(clip.region);
        const video = self.videoObject;
        const startFrame = clip.meta?.frameRange?.[0];
        if (video && typeof startFrame === "number" && typeof video.setFrame === "function") {
          video.setFrame(startFrame);
        }
        return;
      }

      if (clip.region && isAudioRegion(clip.region)) {
        ann.regionStore.unselectAll();
        ann.selectArea(clip.region);
        self.attachmentsControl?.ensureBucketForSelection?.();
        return;
      }

      if (clip.lane === "attachment" || clip.lane === "saved_attachment") {
        const rid = (clip.regionId || clip.id || "").trim();
        if (!rid) return;
        const regions = ann.regionStore?.regions || [];
        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          if (!isAudioRegion(r) || r.id !== rid) continue;
          ann.regionStore.unselectAll();
          ann.selectArea(r);
          self.attachmentsControl?.ensureBucketForSelection?.();
          return;
        }
        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          if (!isAudioRegion(r)) continue;
          if (typeof r.start !== "number" || typeof r.end !== "number") continue;
          if (Math.abs(r.start - clip.start) < 0.05 && Math.abs(r.end - clip.end) < 0.05) {
            ann.regionStore.unselectAll();
            ann.selectArea(r);
            self.attachmentsControl?.ensureBucketForSelection?.();
            return;
          }
        }
      }
    },

    createAudioRegion(startSec, endSec) {
      // STT 레인 드래그 → audio_segments (저장: textarea + transcript)
      const result = createAudioRegionFromSpan(
        self.audioObject,
        self.audioSegmentsControl,
        startSec,
        endSec,
      );
      if (!result.ok) return result;

      const ann = self.annotation;
      if (result.region && ann) {
        ann.regionStore.unselectAll();
        ann.selectArea(result.region);
        self.attachmentsControl?.ensureBucketForSelection?.();
      }

      return result;
    },

    resizeAudioRegion(region, startSec, endSec) {
      const ok = resizeAudioRegionSpan(region, startSec, endSec);
      if (ok) {
        self.attachmentsControl?.syncSelectedRegionMeta?.();
      }
      return ok;
    },
  }));

const MultimodalTimelineModel = types.compose(
  "MultimodalTimelineModel",
  ControlBase,
  AnnotationMixin,
  ReadOnlyControlMixin,
  TagAttrs,
  Model,
);

const HtxMultimodalTimeline = inject("store")(
  observer(({ item }) => {
    return <MultimodalTimelineView item={item} className={item.classname} />;
  }),
);

Registry.addTag("multimodaltimeline", MultimodalTimelineModel, HtxMultimodalTimeline);

export { HtxMultimodalTimeline, MultimodalTimelineModel };
