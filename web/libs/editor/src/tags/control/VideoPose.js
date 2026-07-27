import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import Registry from "../../core/Registry";
import { guidGenerator } from "../../core/Helpers";
import ControlBase from "./Base";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import SeparatedControlMixin from "../../mixins/SeparatedControlMixin";
import { ToolManagerMixin } from "../../mixins/ToolManagerMixin";
import { customTypes } from "../../core/CustomTypes";

/**
 * VideoPose — bbox + skeleton on video (FAIVV).
 * VideoVector(점/선/skeleton) 드로잉 툴을 포함하며, bbox는 VideoRegions 드래그로 생성.
 *
 * @name VideoPose
 */
const TagAttrs = types.model({
  toname: types.maybeNull(types.string),

  opacity: types.optional(customTypes.range(), "0.2"),
  fillcolor: types.optional(customTypes.color, "#f48a42"),

  strokewidth: types.optional(types.string, "2"),
  strokecolor: types.optional(customTypes.color, "#f48a42"),

  snap: types.optional(types.string, "none"),

  pointsize: types.optional(types.string, "small"),
  pointstyle: types.optional(types.string, "circle"),

  closable: types.optional(types.maybeNull(types.boolean), false),
  minpoints: types.optional(types.maybeNull(types.string), null),
  maxpoints: types.optional(types.maybeNull(types.string), null),
  skeleton: types.optional(types.maybeNull(types.boolean), true),
  pointsizeenabled: types.optional(types.maybeNull(types.string), "5"),
  pointsizedisabled: types.optional(types.maybeNull(types.string), "3"),
});

const ModelAttrs = types
  .model("VideoPoseModel", {
    pid: types.optional(types.string, guidGenerator),
    type: "videopose",
    _value: types.optional(types.string, ""),
  })
  .volatile(() => ({
    toolNames: ["VideoPose"],
  }));

const VideoPoseModel = types.compose(
  "VideoPoseModel",
  ControlBase,
  AnnotationMixin,
  SeparatedControlMixin,
  TagAttrs,
  ToolManagerMixin,
  ModelAttrs,
);

const HtxVideoPose = observer(() => {
  return null;
});

Registry.addTag("videopose", VideoPoseModel, HtxVideoPose);

export { HtxVideoPose, VideoPoseModel };
