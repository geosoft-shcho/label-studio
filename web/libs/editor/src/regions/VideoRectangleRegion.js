import { types } from "mobx-state-tree";

import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import Registry from "../core/Registry";
import { AreaMixin } from "../mixins/AreaMixin";
import { onlyProps, VideoRegion } from "./VideoRegion";
import { interpolateProp } from "../utils/props";
import { keypointsAtFrame as resolveKeypointsAtFrame } from "./videoKeypoints";
import { mediaBboxToCanvas, mediaPercentToCanvas } from "../tags/object/Video/mediaToCanvas";
import { logRegionShapeUpdate } from "../utils/faivvVectorEditDebug";
import { markRegionReviewedOnEdit } from "../utils/segmentSource";

const Model = types
  .model("VideoRectangleRegionModel", {
    type: "videorectangleregion",
  })
  .volatile(() => ({
    props: ["x", "y", "width", "height", "rotation"],
  }))
  .views((self) => ({
    getShape(frame) {
      let prev;
      let next;

      for (const item of self.sequence) {
        if (item.frame === frame) {
          return onlyProps(self.props, item);
        }

        if (item.frame > frame) {
          next = item;
          break;
        }
        prev = item;
      }

      if (!prev) return null;
      if (!next) return onlyProps(self.props, prev);

      return Object.fromEntries(self.props.map((prop) => [prop, interpolateProp(prev, next, frame, prop)]));
    },

    getVisibility() {
      return true;
    },

    get bboxTriggers() {
      const frame = self.parent?.frame || 1;
      const video = self.parent?.ref?.current;

      return [
        frame,
        self.sequence,
        video?.zoom,
        video?.pan?.x,
        video?.pan?.y,
        video?.width,
        video?.height,
        self.keypointsAtFrame,
      ];
    },

    get bboxCoords() {
      const frame = self.parent?.frame || 1;
      const shape = self.getShape(frame);
      if (!shape) return null;
      return {
        left: shape.x,
        top: shape.y,
        right: shape.x + shape.width,
        bottom: shape.y + shape.height,
      };
    },

    get bboxCoordsCanvas() {
      const frame = self.parent?.frame || 1;
      if (!self.isInLifespan(frame)) return null;
      const bbox = self.bboxCoords;
      if (!bbox) return null;
      const video = self.parent?.ref?.current;

      return mediaBboxToCanvas(video, bbox);
    },

    /** 현재 Video 프레임의 keypoints (미디어 %, faivv POSE sequence). */
    get keypointsAtFrame() {
      const frame = self.parent?.frame || 1;
      if (!self.isInLifespan(frame)) return null;

      return resolveKeypointsAtFrame(self.sequence, frame);
    },

    getKeypointCoords(keypointName) {
      const kps = self.keypointsAtFrame;
      if (!kps) return null;

      return kps.find((k) => k.name === keypointName) ?? null;
    },

    getKeypointCoordsCanvas(keypointName) {
      const kp = self.getKeypointCoords(keypointName);
      if (!kp) return null;

      const video = self.parent?.ref?.current;
      const pt = mediaPercentToCanvas(video, Number(kp.x), Number(kp.y));

      if (!pt) return null;

      return {
        x: pt.x,
        y: pt.y,
        confidence: Number(kp.confidence) || 0,
      };
    },

    /** { left_ankle: { x, y, confidence }, ... } canvas px */
    get keypointsCoordsCanvas() {
      const kps = self.keypointsAtFrame;
      const out = {};

      if (!kps) return out;

      kps.forEach((kp) => {
        if (!kp?.name) return;
        const canvas = self.getKeypointCoordsCanvas(kp.name);

        if (canvas) out[kp.name] = canvas;
      });

      return out;
    },

    /**
     * Video 박스 라벨: `AI · seg_…: Person` (source=auto) / `seg_…: Person` (수동).
     * Labels 클래스명(Person)은 유지. 인스턴스는 segment id.
     */
    getLabelText(joinstr) {
      const label = self.labeling;
      const text = self.texting?.mainValue?.[0]?.replace(/\n\r|\n/, " ");
      const labelNames = label?.getSelectedString(joinstr);
      const labelText = [];
      if (self.hasInferenceConfidence) labelText.push("AI");
      const segmentId = self.videoSegmentId;
      if (segmentId) labelText.push(shortVideoSegmentId(segmentId));
      else if (self.region_index) labelText.push(String(self.region_index));
      if (labelNames) labelText.push(labelNames);
      if (text) labelText.push(text);
      return labelText.join(": ");
    },

    /** LayerSegment.id — region.segmentId / result.value.segmentId / cleanId(`seg_*`). */
    get videoSegmentId() {
      const fromRegion = String(self.segmentId || "").trim();
      if (fromRegion) return fromRegion;
      try {
        for (const r of self.results || []) {
          const sid = String(r?.value?.segmentId || "").trim();
          if (sid) return sid;
        }
      } catch (e) {
        /* noop */
      }
      const clean = String(self.cleanId || self.id || "").trim();
      return clean.startsWith("seg_") ? clean : "";
    },
  }))
  .actions((self) => ({
    updateShape(data, frame) {
      const beforeKf =
        self.sequence.find((item) => item.frame === frame) ||
        self.closestKeypoint?.(frame) ||
        null;
      logRegionShapeUpdate(self, frame, data, beforeKf);

      const newItem = {
        ...data,
        frame,
        enabled: true,
      };

      const kp = self.closestKeypoint(frame);
      const index = self.sequence.findIndex((item) => item.frame >= frame);

      if (index < 0) {
        self.sequence = [...self.sequence, newItem];
      } else {
        const keypoint = {
          ...(self.sequence[index] ?? {}),
          ...data,
          enabled: kp?.enabled ?? true,
          frame,
        };

        self.sequence = [
          ...self.sequence.slice(0, index),
          keypoint,
          ...self.sequence.slice(index + (self.sequence[index].frame === frame)),
        ];
      }

      markRegionReviewedOnEdit(self);
    },
  }));

function shortVideoSegmentId(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (s.startsWith("seg_") && s.length > 4) {
    const rest = s.slice(4);
    return rest.length <= 8 ? `seg_${rest}` : `seg_${rest.slice(0, 8)}`;
  }
  return s.length <= 10 ? s : s.slice(0, 10);
}

const VideoRectangleRegionModel = types.compose(
  "VideoRectangleRegionModel",
  RegionsMixin,
  VideoRegion,
  AreaMixin,
  NormalizationMixin,
  Model,
);

Registry.addRegionType(VideoRectangleRegionModel, "video");

export { VideoRectangleRegionModel };
