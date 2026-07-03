import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import ProcessAttrsMixin from "../../mixins/ProcessAttrs";
import Registry from "../../core/Registry";
import { guidGenerator } from "../../utils/unique";

/**
 * The `SegmentAttachments` tag renders a mount container for the faivv
 * segment-attachment panel inside the labeling tree. It is a purely visual
 * mount point (no native region output); the panel logic (upload, per-region
 * list, save payload) is provided by the host module
 * `window.FaivvSegmentAttachments`, which mounts into the DOM element here.
 *
 * To keep the saved annotation uniform with native controls, the host
 * synthesizes minimal `result[]` entries (from_name/to_name/type) at save
 * time using the meta exposed here via `window.__faivvSegAttachResultMeta`.
 *
 * NOTE: `controlName`/`objectName` are custom string attributes — NOT the LSF
 * `name`/`toName` binding attributes — so this tag is never treated as a
 * control tag by the parser (which previously broke initial render).
 *
 * @example
 * <View>
 *   <Audio name="audio" value="$audio" />
 *   <SegmentAttachments controlName="audio_evidence" objectName="audio" />
 * </View>
 * @name SegmentAttachments
 * @param {string} [controlName=audio_evidence] - from_name used in synthesized result[]
 * @param {string} [objectName=audio]           - to_name used in synthesized result[]
 * @param {string} [outputType=segmentattachments] - type used in synthesized result[]
 * @param {string} [mountId=faivv-seg-attach-mount] - DOM id the host panel mounts into
 * @param {string} [className] - Optional CSS class for the mount container
 */
const Model = types.model({
  id: types.optional(types.identifier, guidGenerator),
  type: "segmentattachments",
  controlname: types.optional(types.string, "audio_evidence"),
  objectname: types.optional(types.string, "audio"),
  outputtype: types.optional(types.string, "segmentattachments"),
  mountid: types.optional(types.string, "faivv-seg-attach-mount"),
  classname: types.optional(types.string, ""),
});

const SegmentAttachmentsModel = types.compose(
  "SegmentAttachmentsModel",
  Model,
  ProcessAttrsMixin,
);

const HtxSegmentAttachments = observer(({ item }) => {
  const mountId = item.mountid || "faivv-seg-attach-mount";
  const className = ["faivv-seg-attach-mount", item.classname].filter(Boolean).join(" ");

  const onMountRef = (el) => {
    if (!el) return;
    try {
      const meta = {
        fromName: item.controlname || "audio_evidence",
        toName: item.objectname || "audio",
        type: item.outputtype || "segmentattachments",
      };
      // 저장 시 host가 result[] 합성에 사용할 메타를 전역에 노출한다(타이밍 디커플).
      if (typeof window !== "undefined") window.__faivvSegAttachResultMeta = meta;

      // 디버깅: 마운트 시 현재 data output 덤프(태그 자체는 region 결과 없음).
      // eslint-disable-next-line no-console
      console.log("[faivv-ls-v2] SegmentAttachments.mounted", {
        tag: item.type,
        id: item.id,
        mountId,
        resultMeta: meta,
      });
      const host = typeof window !== "undefined" && window.FaivvSegmentAttachments;
      if (host && typeof host.debug === "function") host.debug("tag_mount");
    } catch (e) {
      /* noop */
    }
  };

  return <div id={mountId} ref={onMountRef} className={className} data-faivv-seg-attach-mount="1" />;
});

Registry.addTag("segmentattachments", SegmentAttachmentsModel, HtxSegmentAttachments);

export { HtxSegmentAttachments, SegmentAttachmentsModel };
