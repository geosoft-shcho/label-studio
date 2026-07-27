import { types } from "mobx-state-tree";
import Registry from "../core/Registry";
import Tree from "../core/Tree";
import { AreaMixin } from "../mixins/AreaMixin";
import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import { RectRegionModel } from "./RectRegion";
import { KeyPointRegionModel } from "./KeyPointRegion";
import { AudioRegionModel } from "./AudioRegion";
import { PolygonRegionModel } from "./PolygonRegion";
import { EllipseRegionModel } from "./EllipseRegion";
import { RichTextRegionModel } from "./RichTextRegion";
import { BrushRegionModel } from "./BrushRegion";
import { TimelineRegionModel } from "./TimelineRegion";
import { TimeSeriesRegionModel } from "./TimeSeriesRegion";
import { ParagraphsRegionModel } from "./ParagraphsRegion";
import { VideoRectangleRegionModel } from "./VideoRectangleRegion";
import { VideoPoseRegionModel } from "./VideoPoseRegion";
import { VideoVectorRegionModel } from "./VideoVectorRegion";

// general Area type for classification Results which doesn't belong to any real Area
const ClassificationArea = types.compose(
  "ClassificationArea",
  RegionsMixin,
  NormalizationMixin,
  AreaMixin,
  types
    .model({
      object: types.late(() => types.reference(types.union(...Registry.objectTypes()))),
      // true only for global classifications
      classification: true,
    })
    .views((self) => ({
      get supportSuggestions() {
        return false;
      },
      // it's required in some contexts when it's treated as a region
      get type() {
        return "";
      },
    }))
    .actions(() => ({
      serialize: () => ({}),
    })),
);

const Area = types.union(
  {
    dispatcher(sn) {
      // for some deserializations
      if (sn.$treenode) return sn.$treenode.type;
      if (
        !sn.points && // dirty hack to make it work with polygons, but may be the whole condition is not necessary at all
        // `sequence` and `ranges` are used for video regions
        !sn.sequence &&
        !sn.ranges &&
        sn.value &&
        Object.values(sn.value).length <= 1
      )
        return ClassificationArea;
      // may be a tag itself or just its name
      const objectName = Tree.cleanUpId(sn.object.name || sn.object);
      // we have to use current config to detect Object tag by name
      const tag = window.Htx.annotationStore.names.get(objectName);
      // provide value to detect Area by data
      const available = Registry.getAvailableAreas(tag.type, sn);
      // union of all available Areas for this Object type

      // video: sequence(+vertices/+bbox) → VideoPose (단일 태그). Timeline은 sequence 없음.
      if (tag.type === "video") {
        const seq = sn.sequence || sn.value?.sequence;

        if (seq) {
          const firstItem = Array.isArray(seq) ? seq[0] : null;
          const hasVertices =
            firstItem?.vertices !== undefined || sn.value?.vertices !== undefined;
          const hasBbox =
            firstItem && (firstItem.x !== undefined || firstItem.width !== undefined);

          if (hasVertices || hasBbox) {
            return VideoPoseRegionModel;
          }
          return VideoPoseRegionModel;
        }
        return TimelineRegionModel;
      }

      if (!available.length) return ClassificationArea;
      return types.union(...available, ClassificationArea);
    },
  },
  AudioRegionModel,
  ParagraphsRegionModel,
  TimelineRegionModel,
  TimeSeriesRegionModel,
  RectRegionModel,
  RichTextRegionModel,
  KeyPointRegionModel,
  EllipseRegionModel,
  PolygonRegionModel,
  BrushRegionModel,
  VideoRectangleRegionModel,
  VideoPoseRegionModel,
  VideoVectorRegionModel,
  ClassificationArea,
);

export default Area;
