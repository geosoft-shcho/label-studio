import { inject, observer } from "mobx-react";
import { destroy, getSnapshot, types } from "mobx-state-tree";

import SavedSegmentAttachmentsList from "../../components/SavedSegmentAttachments/SavedSegmentAttachmentsList";
import Registry from "../../core/Registry";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import { ReadOnlyControlMixin } from "../../mixins/ReadOnlyMixin";
import { guidGenerator } from "../../utils/unique";
import ControlBase from "./Base";

/**
 * 저장된 구간 첨부(첨부 전용 레이어) 목록 — 읽기·삭제 UI.
 *
 * @example
 * <SavedSegmentAttachments name="saved_segment_attachments" toName="audio" />
 *
 * @name SavedSegmentAttachments
 * @param {string} name   Control name
 * @param {string} toName Object tag name (typically `audio`)
 */
const AttachmentModel = types.model("SavedSegmentAttachmentItem", {
  assetId: types.string,
  fileName: types.optional(types.string, ""),
  mimeType: types.optional(types.string, ""),
  size: types.optional(types.number, 0),
  contentUrl: types.optional(types.string, ""),
  isNew: types.optional(types.boolean, false),
});

const SegmentModel = types.model("SavedSegmentAttachmentGroup", {
  regionId: types.string,
  start: types.maybeNull(types.number),
  end: types.maybeNull(types.number),
  label: types.optional(types.string, ""),
  layerId: types.optional(types.string, ""),
  attachments: types.array(AttachmentModel),
});

const TagAttrs = types.model({
  toname: types.maybeNull(types.string),
});

const Model = types
  .model({
    type: "savedsegmentattachments",
    segments: types.array(SegmentModel),
    removedAssetIds: types.array(types.string),
  })
  .views((self) => ({
    get valueType() {
      return "savedsegmentattachments";
    },
    get toNameTag() {
      return self.annotation?.names?.get(self.toname);
    },
    get result() {
      return self.annotation?.results?.find((r) => r.from_name === self);
    },
    exportPayload() {
      return {
        segments: getSnapshot(self.segments),
        removedAssetIds: self.removedAssetIds.slice(),
      };
    },
  }))
  .actions((self) => ({
    loadFromServer(list) {
      self.segments.clear();
      self.removedAssetIds.clear();
      if (!Array.isArray(list)) return;

      list.forEach((raw) => {
        const regionId = (raw.regionId || raw.segmentId || raw.id || "").toString().trim();
        if (!regionId) return;
        const atts = Array.isArray(raw.attachments) ? raw.attachments : [];
        const attachments = atts
          .map((a) => ({
            assetId: (a.assetId || a.asset_id || "").toString().trim(),
            fileName: (a.fileName || a.file_name || "").toString(),
            mimeType: (a.mimeType || a.mime_type || "").toString(),
            size: typeof a.size === "number" ? a.size : 0,
            contentUrl: (a.contentUrl || a.content_url || "").toString(),
            isNew: false,
          }))
          .filter((a) => a.assetId);

        if (!attachments.length) return;

        self.segments.push({
          regionId,
          start: raw.start != null ? Number(raw.start) : null,
          end: raw.end != null ? Number(raw.end) : null,
          label: (raw.label || "").toString(),
          layerId: (raw.layerId || raw.layer_id || "").toString(),
          attachments,
        });
      });
    },

    removeAttachment(regionId, assetId) {
      const rid = (regionId || "").trim();
      const aid = (assetId || "").trim();
      if (!rid || !aid) return;

      const seg = self.segments.find((s) => s.regionId === rid);
      if (!seg) return;

      const att = seg.attachments.find((a) => a.assetId === aid);
      if (!att) return;

      if (!att.isNew && !self.removedAssetIds.includes(aid)) {
        self.removedAssetIds.push(aid);
      }
      destroy(att);

      if (!seg.attachments.length) {
        destroy(seg);
      }

      self.updateResult();
      self.annotation?.setDraftSelected?.(true);
    },

    createResult(data) {
      const target = self.toNameTag;
      if (!target) return;
      self.annotation.createResult({}, { savedsegmentattachments: data }, self, target);
    },

    updateResult() {
      const data = self.exportPayload();
      if (self.result) {
        self.result.setValue(data);
      } else {
        self.createResult(data);
      }
    },

    commitSaved() {
      self.removedAssetIds.clear();
      self.segments.forEach((seg) => {
        seg.attachments.forEach((att) => {
          att.isNew = false;
        });
      });
    },
  }));

const SavedSegmentAttachmentsModel = types.compose(
  "SavedSegmentAttachmentsModel",
  ControlBase,
  AnnotationMixin,
  ReadOnlyControlMixin,
  TagAttrs,
  Model,
);

const HtxSavedSegmentAttachments = inject("store")(
  observer(({ item }) => {
    const resolveContentUrl =
      typeof window !== "undefined" &&
      window.FaivvAssetUpload &&
      typeof window.FaivvAssetUpload.resolveContentUrl === "function"
        ? window.FaivvAssetUpload.resolveContentUrl.bind(window.FaivvAssetUpload)
        : null;

    return (
      <SavedSegmentAttachmentsList
        className={item.classname}
        segments={item.segments}
        readOnly={item.isReadOnly()}
        onRemove={(regionId, assetId) => item.removeAttachment(regionId, assetId)}
        resolveContentUrl={resolveContentUrl}
      />
    );
  }),
);

Registry.addTag("savedsegmentattachments", SavedSegmentAttachmentsModel, HtxSavedSegmentAttachments);

export { HtxSavedSegmentAttachments, SavedSegmentAttachmentsModel };
