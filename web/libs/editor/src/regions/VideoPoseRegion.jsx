import { types } from "mobx-state-tree";

import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import Registry from "../core/Registry";
import { AreaMixin } from "../mixins/AreaMixin";
import { onlyProps, VideoRegion } from "./VideoRegion";
import { interpolateProp } from "../utils/props";
import { mediaBboxToCanvas } from "../tags/object/Video/mediaToCanvas";

const BBOX_PROPS = ["x", "y", "width", "height", "rotation"];

const interpolateVertex = (prev, next, r) => {
  const result = {
    ...prev,
    x: prev.x + (next.x - prev.x) * r,
    y: prev.y + (next.y - prev.y) * r,
  };

  if (prev.controlPoint1 && next.controlPoint1) {
    result.controlPoint1 = {
      x: prev.controlPoint1.x + (next.controlPoint1.x - prev.controlPoint1.x) * r,
      y: prev.controlPoint1.y + (next.controlPoint1.y - prev.controlPoint1.y) * r,
    };
  }

  if (prev.controlPoint2 && next.controlPoint2) {
    result.controlPoint2 = {
      x: prev.controlPoint2.x + (next.controlPoint2.x - prev.controlPoint2.x) * r,
      y: prev.controlPoint2.y + (next.controlPoint2.y - prev.controlPoint2.y) * r,
    };
  }

  return result;
};

const interpolateVertices = (prevKeyframe, nextKeyframe, frame) => {
  const r = (frame - prevKeyframe.frame) / (nextKeyframe.frame - prevKeyframe.frame);
  const prevVertices = prevKeyframe.vertices || [];
  const nextVertices = nextKeyframe.vertices || [];
  const nextMap = new Map(nextVertices.map((v) => [v.id, v]));

  return prevVertices.map((prevV) => {
    const nextV = nextMap.get(prevV.id);

    if (!nextV) return prevV;
    return interpolateVertex(prevV, nextV, r);
  });
};

/**
 * FAIVV VideoPose — bbox + skeleton vertices in one video region.
 */
const Model = types
  .model("VideoPoseRegionModel", {
    type: "videoposeregion",
  })
  .volatile(() => ({
    vectorRef: null,
    props: BBOX_PROPS,
  }))
  .views((self) => ({
    getShape(frame) {
      const target = Number(frame);
      const seq = self.sequence || [];
      if (!seq.length) return null;

      let prev;
      let next;

      for (const item of seq) {
        const itemFrame = Number(item.frame);
        if (itemFrame === target) {
          return {
            ...onlyProps(BBOX_PROPS, item),
            rotation: Number(item.rotation) || 0,
            vertices: item.vertices || [],
            closed: item.closed ?? false,
          };
        }

        if (itemFrame > target) {
          next = item;
          break;
        }
        prev = item;
      }

      // video frame 0 / 첫 키프레임 이전 → 첫 키프레임 bbox 표시
      if (!prev) {
        const first = seq[0];
        return {
          ...onlyProps(BBOX_PROPS, first),
          rotation: Number(first.rotation) || 0,
          vertices: first.vertices || [],
          closed: first.closed ?? false,
        };
      }

      if (!next) {
        return {
          ...onlyProps(BBOX_PROPS, prev),
          rotation: Number(prev.rotation) || 0,
          vertices: prev.vertices || [],
          closed: prev.closed ?? false,
        };
      }

      const bbox = Object.fromEntries(
        BBOX_PROPS.map((prop) => [prop, interpolateProp(prev, next, target, prop)]),
      );

      return {
        ...bbox,
        rotation: Number(bbox.rotation) || 0,
        vertices: interpolateVertices(prev, next, target),
        closed: prev.closed ?? false,
      };
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
      ];
    },

    get bboxCoords() {
      const frame = self.parent?.frame || 1;
      const shape = self.getShape(frame);
      if (!shape || shape.x == null || shape.y == null) return null;
      const width = Number(shape.width) || 0;
      const height = Number(shape.height) || 0;
      return {
        left: shape.x,
        top: shape.y,
        right: shape.x + width,
        bottom: shape.y + height,
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

    get control() {
      const byTools = self.results.find((result) => result.from_name?.tools)?.from_name;
      if (byTools) return byTools;
      const byType = self.results.find((result) =>
        String(result.type || "").includes("videopose"),
      )?.from_name;
      if (byType) return byType;
      return self.labeling?.from_name || self.results[0]?.from_name;
    },
    get closable() {
      return self.control?.closable ?? false;
    },
    get minPoints() {
      const min = self.control?.minpoints;
      return min ? Number.parseInt(min) : undefined;
    },
    get maxPoints() {
      const max = self.control?.maxpoints;
      return max ? Number.parseInt(max) : undefined;
    },
    get vertices() {
      const kf = self.sequence[0];
      return kf?.vertices ?? [];
    },
    get closed() {
      const kf = self.sequence[0];
      return kf?.closed ?? false;
    },
    get atMaxLength() {
      return self.maxPoints && self.vertices.length === self.maxPoints;
    },
    get incomplete() {
      if (self.atMaxLength) return false;
      const notClosed = self.closable === true && self.closed === false;
      const notFinished = self.minPoints && self.vertices.length < self.minPoints;
      return notClosed || notFinished;
    },
    get finished() {
      // VideoVectorRegion과 동일: closable=false면 점만으로 finish하지 않음 → 연속 클릭으로 점·선
      if (self.closable) return !self.incomplete;
      if (self.atMaxLength) return true;
      return false;
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
      const hash = clean.lastIndexOf("#");
      const base = hash > 0 ? clean.slice(0, hash) : clean;
      return base.startsWith("seg_") ? base : "";
    },
  }))
  .actions((self) => ({
    setVectorRef(ref) {
      self.vectorRef = ref;
    },

    /** 검출됨(enabled≠false)인 closest KF 구간만 bbox·skeleton 표시.
     * 추론 미검출 프레임의 enabled:false 키프레임부터 다음 true까지 완전 숨김. */
    isInLifespan(targetFrame) {
      const seq = self.sequence || [];
      if (!seq.length) return false;
      const target = Number(targetFrame);
      const firstFrame = Number(seq[0].frame);
      if (Number.isFinite(target) && Number.isFinite(firstFrame) && target < firstFrame) {
        return seq[0].enabled !== false;
      }
      const closestKeypoint = self.closestKeypoint(target);
      if (closestKeypoint) {
        return closestKeypoint.enabled !== false;
      }
      return false;
    },

    updateShape(data, frame) {
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

    },

    startPoint(x, y) {
      self.vectorRef?.startPoint(x, y);
    },

    updatePoint(x, y) {
      self.vectorRef?.updatePoint(x, y);
    },

    commitPoint(x, y) {
      self.vectorRef?.commitPoint(x, y);
    },
  }));

const VideoPoseRegionModel = types.compose(
  "VideoPoseRegionModel",
  RegionsMixin,
  VideoRegion,
  AreaMixin,
  NormalizationMixin,
  Model,
);

// bbox만 / vertices만 / 둘 다 → VideoPoseRegion (단일 태그 통합)
Registry.addRegionType(VideoPoseRegionModel, "video", (value) => {
  const seq0 = value.sequence?.[0];
  const hasVertices =
    value.vertices !== undefined || (seq0 && seq0.vertices !== undefined);
  const hasBbox =
    seq0 && (seq0.x !== undefined || seq0.width !== undefined);

  return !!(hasVertices || hasBbox);
});

export { VideoPoseRegionModel };
