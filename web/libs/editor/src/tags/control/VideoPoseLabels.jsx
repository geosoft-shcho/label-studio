import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import LabelMixin from "../../mixins/LabelMixin";
import Registry from "../../core/Registry";
import SelectedModelMixin from "../../mixins/SelectedModel";
import Types from "../../core/Types";
import { HtxLabels, LabelsModel } from "./Labels/Labels";
import { VideoPoseModel } from "./VideoPose";
import ControlBase from "./Base";

/**
 * VideoPoseLabels — labeled bbox + skeleton on video (**FAIVV pose-only control**).
 *
 * Not an official Label Studio replacement for VideoVectorLabels / VideoRectangle.
 * Product docs: faivv-flow `docs/구현설명-VideoPoseLabels.md`
 * Fork inventory: `docs/FAIVV_CUSTOMIZATIONS.md`
 *
 * @example
 * <View>
 *   <Video name="video" value="$video" />
 *   <VideoPoseLabels name="pose" toName="video" skeleton="true">
 *     <Label value="Person" />
 *   </VideoPoseLabels>
 * </View>
 * @name VideoPoseLabels
 * @regions VideoPoseRegion
 */
const ModelAttrs = types.model("VideoPoseLabelsModel", {
  type: "videoposelabels",
  children: Types.unionArray(["label", "header", "view", "hypertext"]),
});

const VideoPoseLabelsModel = types.compose(
  "VideoPoseLabelsModel",
  ControlBase,
  LabelsModel,
  ModelAttrs,
  VideoPoseModel,
  LabelMixin,
  SelectedModelMixin.props({ _child: "LabelModel" }),
);

const HtxVideoPoseLabels = observer(({ item }) => {
  return <HtxLabels item={item} />;
});

Registry.addTag("videoposelabels", VideoPoseLabelsModel, HtxVideoPoseLabels);

export { HtxVideoPoseLabels, VideoPoseLabelsModel };
