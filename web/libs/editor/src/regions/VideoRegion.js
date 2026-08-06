import { getRoot, types } from "mobx-state-tree";

import { guidGenerator } from "../core/Helpers";
import { AreaMixin } from "../mixins/AreaMixin";
import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import { VideoModel } from "../tags/object/Video";
import { FF_LEAP_187, isFF } from "../utils/feature-flags";
import {
  isAutoSegmentSource,
  normalizeReviewed,
  normalizeSegmentSource,
} from "../utils/segmentSource";
import { logRegionSerialize } from "../utils/faivvVectorEditDebug";

export const onlyProps = (props, obj) => {
  return Object.fromEntries(props.map((prop) => [prop, obj[prop]]));
};

/** 설계-20 §9: confidence는 UI 점수만. */
function finiteConfidence(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const Model = types
  .model("VideoRegionModel", {
    id: types.optional(types.identifier, guidGenerator),
    pid: types.optional(types.string, guidGenerator),
    object: types.late(() => types.reference(VideoModel)),

    sequence: types.frozen([]),
    // faivv: LayerSegment.id — Labels Person 인스턴스 구분용
    segmentId: types.maybeNull(types.string),
    personId: types.maybeNull(types.string),
    // 설계-20 §9: UI 신뢰도(0..1). 자동/수동 판별은 source.
    confidence: types.maybeNull(types.number),
    // LayerSegment.source — "auto" | "manual" (기본 manual)
    source: types.optional(types.string, "manual"),
    // LayerSegment.reviewed — 검수 완료
    reviewed: types.optional(types.boolean, false),
  })
  .preProcessSnapshot((snapshot) => {
    const value = snapshot.value || {};
    const conf =
      finiteConfidence(snapshot.confidence) ??
      finiteConfidence(value.confidence) ??
      finiteConfidence(snapshot.score);
    const source = normalizeSegmentSource(
      snapshot.source ?? value.source ?? "manual",
    );
    const reviewed = normalizeReviewed(snapshot.reviewed ?? value.reviewed);
    return {
      ...snapshot,
      sequence: snapshot.sequence || value.sequence,
      segmentId: snapshot.segmentId ?? value.segmentId ?? null,
      personId: snapshot.personId ?? value.personId ?? null,
      confidence: conf,
      source,
      reviewed,
      // LabelOnBbox score 뱃지 (0도 표시되도록 score 유지)
      score: conf != null ? conf : snapshot.score ?? null,
    };
  })
  .volatile(() => ({
    hideable: true,
  }))
  .views((self) => ({
    get parent() {
      return self.object;
    },

    get annotation() {
      return getRoot(self)?.annotationStore?.selected;
    },

    /** 설계-20 §9: source=auto → 자동(AI). 이름 유지(호환). */
    get hasInferenceConfidence() {
      return isAutoSegmentSource(self.segmentSource);
    },

    get segmentSource() {
      try {
        if (self.source) return normalizeSegmentSource(self.source);
      } catch (e) {
        /* noop */
      }
      try {
        for (const r of self.results || []) {
          const s = r?.value?.source;
          if (s != null && s !== "") return normalizeSegmentSource(s);
        }
      } catch (e2) {
        /* noop */
      }
      return "manual";
    },

    /** UI 점수 — 레인 분기에 쓰지 않음. */
    get inferenceConfidence() {
      const fromField = finiteConfidence(self.confidence);
      if (fromField != null) return fromField;
      try {
        for (const r of self.results || []) {
          const c = finiteConfidence(r?.value?.confidence);
          if (c != null) return c;
        }
      } catch (e) {
        /* noop */
      }
      return finiteConfidence(self.score);
    },

    getShape() {
      throw new Error("Method getShape be implemented on a shape level");
    },

    getVisibility() {
      return true;
    },
  }))
  .actions((self) => ({
    updateShape() {
      throw new Error("Method updateShape must be implemented on a shape level");
    },

    onSelectInOutliner() {
      if (isFF(FF_LEAP_187)) {
        // skip video to the first frame of this region
        // @todo hidden/disabled timespans?
        self.object.setFrame(self.sequence[0].frame);
      }
    },

    serialize() {
      const { framerate, length: framesCount } = self.object;

      const duration = self.object?.ref?.current?.duration ?? 0;

      logRegionSerialize(self, self.sequence);

      const value = {
        framesCount,
        duration,
        sequence: self.sequence.map((keyframe) => {
          return { ...keyframe, time: keyframe.frame / framerate };
        }),
      };
      if (self.segmentId) value.segmentId = self.segmentId;
      if (self.personId) value.personId = self.personId;
      const conf = self.inferenceConfidence;
      if (conf != null) value.confidence = conf;
      value.source = self.segmentSource || "manual";
      if (self.reviewed) value.reviewed = true;

      return { value };
    },

    toggleLifespan(frame) {
      const keypoint = self.closestKeypoint(frame, true);

      if (keypoint) {
        const index = self.sequence.indexOf(keypoint);

        self.sequence = [
          ...self.sequence.slice(0, index),
          { ...keypoint, enabled: !keypoint.enabled },
          ...self.sequence.slice(index + 1),
        ];
      }
    },

    addKeypoint(frame) {
      const sequence = Array.from(self.sequence);
      const closestKeypoint = self.closestKeypoint(frame);
      const newKeypoint = {
        ...(self.getShape(frame) ??
          closestKeypoint ?? {
            x: 0,
            y: 0,
          }),
        enabled: closestKeypoint?.enabled ?? true,
        frame,
      };

      sequence.push(newKeypoint);

      sequence.sort((a, b) => a.frame - b.frame);

      self.sequence = sequence;

      self.updateShape(
        {
          ...newKeypoint,
        },
        newKeypoint.frame,
      );
    },

    removeKeypoint(frame) {
      self.sequence = self.sequence.filter((closestKeypoint) => closestKeypoint.frame !== frame);
    },

    isInLifespan(targetFrame) {
      const closestKeypoint = self.closestKeypoint(targetFrame);

      if (closestKeypoint) {
        const { enabled, frame } = closestKeypoint;

        if (frame === targetFrame && !enabled) return true;
        return enabled;
      }
      return false;
    },

    closestKeypoint(targetFrame, onlyPrevious = false) {
      const seq = self.sequence;
      let result;

      const keypoints = seq.filter(({ frame }) => frame <= targetFrame);

      result = keypoints[keypoints.length - 1];

      if (!result && onlyPrevious !== true) {
        result = seq.find(({ frame }) => frame >= targetFrame);
      }

      return result;
    },
  }));

const VideoRegion = types.compose("VideoRegionModel", RegionsMixin, AreaMixin, NormalizationMixin, Model);

export { VideoRegion };
