import { types } from "mobx-state-tree";

import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import Registry from "../core/Registry";
import { AreaMixin } from "../mixins/AreaMixin";
import { onlyProps, VideoRegion } from "./VideoRegion";
import { interpolateProp } from "../utils/props";
import { faivvVideoManualDebug, summarizePoseShape } from "../tags/object/Video/faivvVideoManualDebug";

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
  }))
  .actions((self) => ({
    setVectorRef(ref) {
      self.vectorRef = ref;
      faivvVideoManualDebug("region.setVectorRef", {
        regionId: self.id,
        hasRef: !!ref,
        isDrawing: !!self.isDrawing,
      });
    },

    /** frame 0 / 첫 키프레임 이전에도 bbox·skeleton 표시 (getShape와 동일 정책). */
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
        const { enabled, frame } = closestKeypoint;
        if (Number(frame) === target && !enabled) return true;
        return enabled !== false;
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

      const verts = data?.vertices;
      if (Array.isArray(verts) || data?.width != null) {
        faivvVideoManualDebug("region.updateShape", {
          regionId: self.id,
          frame,
          shape: summarizePoseShape({
            ...data,
            vertices: verts ?? self.getShape(frame)?.vertices,
          }),
        });
      }
    },

    startPoint(x, y) {
      const ok = !!self.vectorRef;
      faivvVideoManualDebug("region.startPoint", {
        regionId: self.id,
        hasVectorRef: ok,
        x: Math.round(Number(x) * 10) / 10,
        y: Math.round(Number(y) * 10) / 10,
      });
      self.vectorRef?.startPoint(x, y);
    },

    updatePoint(x, y) {
      self.vectorRef?.updatePoint(x, y);
    },

    commitPoint(x, y) {
      const ok = !!self.vectorRef;
      faivvVideoManualDebug("region.commitPoint", {
        regionId: self.id,
        hasVectorRef: ok,
        x: Math.round(Number(x) * 10) / 10,
        y: Math.round(Number(y) * 10) / 10,
        before: summarizePoseShape(self.getShape(self.object?.frame)),
      });
      self.vectorRef?.commitPoint(x, y);
      faivvVideoManualDebug("region.commitPoint.after", {
        regionId: self.id,
        after: summarizePoseShape(self.getShape(self.object?.frame)),
      });
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
