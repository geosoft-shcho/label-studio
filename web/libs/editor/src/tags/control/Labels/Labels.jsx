import { observer } from "mobx-react";
import { cast, types } from "mobx-state-tree";

import { defaultStyle } from "../../../core/Constants";
import { customTypes } from "../../../core/CustomTypes";
import { guidGenerator } from "../../../core/Helpers";
import Registry from "../../../core/Registry";
import Tree from "../../../core/Tree";
import Types from "../../../core/Types";
import { AnnotationMixin } from "../../../mixins/AnnotationMixin";
import DynamicChildrenMixin from "../../../mixins/DynamicChildrenMixin";
import LabelMixin from "../../../mixins/LabelMixin";
import SelectedModelMixin from "../../../mixins/SelectedModel";
import { Block } from "../../../utils/bem";
import ControlBase from "../Base";
import "../Label";
import "./Labels.scss";

/**
 * The `Labels` tag provides a set of labels for labeling regions in tasks for machine learning and data science projects. Use the `Labels` tag to create a set of labels that can be assigned to identified region and specify the values of labels to assign to regions.
 *
 * All types of Labels can have dynamic value to load labels from task. This task data should contain a list of options to create underlying `<Label>`s. All the parameters from options will be transferred to corresponding tags.
 *
 * The Labels tag can be used with audio and text data types. Other data types have type-specific Labels tags.
 * @example
 * <!--Basic labeling configuration to apply labels to a passage of text -->
 * <View>
 *   <Labels name="type" toName="txt-1">
 *     <Label alias="B" value="Brand" />
 *     <Label alias="P" value="Product" />
 *   </Labels>
 *   <Text name="txt-1" value="$text" />
 * </View>
 *
 * @example <caption>This part of config with dynamic labels</caption>
 * <Labels name="product" toName="shelf" value="$brands" />
 * <!-- {
 *   "data": {
 *     "brands": [
 *       { "value": "Big brand" },
 *       { "value": "Another brand", "background": "orange" },
 *       { "value": "Local brand" },
 *       { "value": "Green brand", "alias": "Eco", showalias: true }
 *     ]
 *   }
 * } -->
 * @example <caption>is equivalent to this config</caption>
 * <Labels name="product" toName="shelf">
 *   <Label value="Big brand" />
 *   <Label value="Another brand" background="orange" />
 *   <Label value="Local brand" />
 *   <Label value="Green brand" alias="Eco" showAlias="true" />
 * </Labels>
 * @name Labels
 * @meta_title Labels Tag for Labeling Regions
 * @meta_description Customize Label Studio by using the Labels tag to provide a set of labels for labeling regions in tasks for machine learning and data science projects.
 * @param {string} name                      - Name of the element
 * @param {string} toName                    - Name of the element that you want to label
 * @param {single|multiple=} [choice=single] - Configure whether you can select one or multiple labels for a region
 * @param {number} [maxUsages]               - Maximum number of times a label can be used per task
 * @param {boolean} [showInline=true]        - Whether to show labels in the same visual line
 * @param {float=} [opacity=0.6]             - Opacity of rectangle highlighting the label
 * @param {string=} [fillColor]              - Rectangle fill color in hexadecimal
 * @param {string=} [strokeColor=#f48a42]    - Stroke color in hexadecimal
 * @param {number=} [strokeWidth=1]          - Width of the stroke
 * @param {string} [value]                   - Task data field containing a list of dynamically loaded labels (see example below)
 */
const TagAttrs = types.model({
  toname: types.maybeNull(types.string),

  choice: types.optional(types.enumeration(["single", "multiple"]), "single"),
  maxusages: types.maybeNull(types.string),
  showinline: types.optional(types.boolean, true),

  // TODO this will move away from here
  groupdepth: types.maybeNull(types.string),

  opacity: types.optional(customTypes.range(), "0.2"),
  fillcolor: types.optional(customTypes.color, "#f48a42"),

  strokewidth: types.optional(types.string, "1"),
  strokecolor: types.optional(customTypes.color, "#f48a42"),
  fillopacity: types.maybeNull(customTypes.range()),
  allowempty: types.optional(types.boolean, false),

  value: types.optional(types.string, ""),
});

/**
 * @param {boolean} showinline
 * @param {identifier} id
 * @param {string} pid
 */
const ModelAttrs = types.model({
  pid: types.optional(types.string, guidGenerator),
  type: "labels",
  children: Types.unionArray(["label", "header", "view", "text", "hypertext", "richtext"]),

  visible: types.optional(types.boolean, true),
});

const Model = LabelMixin.views((self) => ({
  get shouldBeUnselected() {
    return self.choice === "single";
  },
  get defaultChildType() {
    return "label";
  },
  get isLabeling() {
    return true;
  },
})).actions((self) => ({
  /**
   * API hydrate 시 config 생성 이후 발견된 정확한 라벨을 안전하게 등록한다.
   * 첫 라벨로 암묵 fallback하지 않고 VideoRectangle result label을 보존하기 위한
   * faivv fork 확장점이다.
   */
  ensureLabelValue(value, background = defaultStyle.fillcolor) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return null;
    const existing = self.findLabel(normalized);
    if (existing) return existing;

    // UI는 `value`가 아니라 `_value`를 렌더한다 (Label.jsx).
    // config 파싱 경로는 ProcessAttrs.updateValue가 _value를 채우지만,
    // 동적 push는 updateValue를 타지 않으므로 _value를 같이 넣는다.
    self.children.push({
      type: "label",
      value: normalized,
      _value: normalized,
      background,
    });
    self.annotation?.setupHotKeys?.();
    self.needsUpdate?.();
    return self.findLabel(normalized);
  },

  replaceLabelValues(values, background = defaultStyle.fillcolor) {
    const normalized = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const label = typeof value === "string" ? value.trim() : "";
      if (label && !normalized.includes(label)) normalized.push(label);
    });
    if (!normalized.length) return [];

    for (let i = self.children.length - 1; i >= 0; i--) {
      const child = self.children[i];
      if (child?.type === "label" && !child.isEmpty) self.children.splice(i, 1);
    }
    normalized.forEach((value) => {
      self.children.push({
        type: "label",
        value,
        _value: value,
        background,
      });
    });
    self.annotation?.setupHotKeys?.();
    self.needsUpdate?.();
    return normalized.map((value) => self.findLabel(value)).filter(Boolean);
  },

  afterCreate() {
    if (self.allowempty) {
      let empty = self.findLabel(null);

      if (!empty) {
        const emptyParams = {
          value: null,
          type: "label",
          background: defaultStyle.fillcolor,
        };

        if (self.children) {
          self.children.unshift(emptyParams);
        } else {
          self.children = cast([emptyParams]);
        }
        empty = self.children[0];
      }
      empty.setEmpty();
    }
  },
}));

const LabelsModel = types.compose(
  "LabelsModel",
  ControlBase,
  ModelAttrs,
  TagAttrs,
  AnnotationMixin,
  DynamicChildrenMixin,
  Model,
  SelectedModelMixin.props({ _child: "LabelModel" }),
);

const HtxLabels = observer(({ item }) => {
  return (
    <Block name="labels" mod={{ hidden: !item.visible, inline: item.showinline }}>
      {Tree.renderChildren(item, item.annotation)}
    </Block>
  );
});

Registry.addTag("labels", LabelsModel, HtxLabels);

export { HtxLabels, LabelsModel };
