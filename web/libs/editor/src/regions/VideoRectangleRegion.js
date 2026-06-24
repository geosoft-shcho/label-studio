import { types } from "mobx-state-tree";

import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import Registry from "../core/Registry";
import { AreaMixin } from "../mixins/AreaMixin";
import { onlyProps, VideoRegion } from "./VideoRegion";
import { interpolateProp } from "../utils/props";

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
      if (!video?.videoDimensions) return null;
      const { width: mediaW, height: mediaH } = video.videoDimensions;
      const zoom = video.zoom || 1;
      const pan = video.pan || { x: 0, y: 0 };
      const viewW = video.width || 0;
      const viewH = video.height || 0;
      const scaledW = mediaW * zoom;
      const scaledH = mediaH * zoom;
      const panXOverflow = Math.abs(pan.x) >= Math.abs((viewW - scaledW) / 2);
      const panYOverflow = Math.abs(pan.y) >= Math.abs((viewH - scaledH) / 2);
      const panXDir = pan.x > 0 ? 1 : -1;
      const panYDir = pan.y > 0 ? 1 : -1;
      const panXAdj =
        (Math.abs(pan.x) - Math.abs((viewW - scaledW) / 2)) * panXDir;
      const panYAdj =
        (Math.abs(pan.y) - Math.abs((viewH - scaledH) / 2)) * panYDir;
      const offsetX = panXOverflow ? panXAdj : 0;
      const offsetY = panYOverflow ? panYAdj : 0;
      const baseX = (viewW - scaledW) / 2 + pan.x - offsetX;
      const baseY = (viewH - scaledH) / 2 + pan.y - offsetY;
      return {
        left: (bbox.left * mediaW) / 100 * zoom + baseX,
        top: (bbox.top * mediaH) / 100 * zoom + baseY,
        right: (bbox.right * mediaW) / 100 * zoom + baseX,
        bottom: (bbox.bottom * mediaH) / 100 * zoom + baseY,
      };
    },
  }))
  .actions((self) => ({
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
  }));

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
