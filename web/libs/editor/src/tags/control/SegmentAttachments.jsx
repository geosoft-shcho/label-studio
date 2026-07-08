import { useEffect } from "react";
import { inject, observer } from "mobx-react";
import { destroy, flow, types } from "mobx-state-tree";

import SegmentAttachmentsPanel from "../../components/SegmentAttachments/SegmentAttachmentsPanel";
import Registry from "../../core/Registry";
import { AnnotationMixin } from "../../mixins/AnnotationMixin";
import { ReadOnlyControlMixin } from "../../mixins/ReadOnlyMixin";
import ControlBase from "./Base";

/**
 * 선택 구간(audio region)별 근거 파일 첨부 Control.
 *
 * @example
 * <SegmentAttachments name="audio_evidence" toName="audio" />
 *
 * @name SegmentAttachments
 * @param {string} name   Control name (`from_name`)
 * @param {string} toName Object tag name (typically `audio`)
 */
const AttachmentModel = types.model("SegmentAttachmentItem", {
  assetId: types.string,
  fileName: types.optional(types.string, ""),
  mimeType: types.optional(types.string, ""),
  size: types.optional(types.number, 0),
  contentUrl: types.optional(types.string, ""),
  isNew: types.optional(types.boolean, false),
});

const PendingModel = types.model("SegmentAttachmentPending", {
  tempId: types.string,
  fileName: types.optional(types.string, ""),
  size: types.optional(types.number, 0),
});

const RegionBucketModel = types.model("SegmentAttachmentRegionBucket", {
  regionId: types.string,
  start: types.maybeNull(types.number),
  end: types.maybeNull(types.number),
  label: types.optional(types.string, ""),
  attachments: types.array(AttachmentModel),
  pendings: types.array(PendingModel),
});

const TagAttrs = types.model({
  toname: types.maybeNull(types.string),
});

/** File objects are kept outside MST (not serializable). */
const pendingFilesByTempId = new Map();
let tempSeq = 0;

function isAudioRegion(region) {
  if (!region) return false;
  try {
    if (region.object && region.object.name === "audio") return true;
    if (region.parent && region.parent.name === "audio") return true;
    if (
      typeof region.start === "number" &&
      typeof region.end === "number" &&
      (!region.object || region.object.name !== "video")
    ) {
      return true;
    }
  } catch (e) {
    /* noop */
  }
  return false;
}

function regionLabelText(region) {
  try {
    if (region.labeling?.mainValue?.length) {
      return String(region.labeling.mainValue[0]);
    }
    const results = region.results || [];
    for (let i = 0; i < results.length; i++) {
      const v = results[i]?.value;
      if (v?.labels?.length) return String(v.labels[0]);
    }
  } catch (e) {
    /* noop */
  }
  return "";
}

function selectedAudioRegion(ann) {
  if (!ann?.regionStore) return null;
  const regions = ann.regionStore.regions || [];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (!isAudioRegion(r)) continue;
    if (r.selected === true || r.highlighted === true) return r;
  }
  return null;
}

const Model = types
  .model({
    type: "segmentattachments",
    regions: types.array(RegionBucketModel),
    removedAssetIds: types.array(types.string),
  })
  .views((self) => ({
    get valueType() {
      return "segmentattachments";
    },
    get toNameTag() {
      return self.annotation?.names?.get(self.toname);
    },
    get result() {
      return self.annotation?.results?.find((r) => r.from_name === self);
    },
    get selectedAudioRegion() {
      return selectedAudioRegion(self.annotation);
    },
    get selectedRegionId() {
      return self.selectedAudioRegion?.id || "";
    },
    get selectedMeta() {
      const region = self.selectedAudioRegion;
      if (!region) return null;
      const bucket = self.regions.find((r) => r.regionId === region.id);
      return {
        start: typeof region.start === "number" ? region.start : bucket?.start ?? null,
        end: typeof region.end === "number" ? region.end : bucket?.end ?? null,
        label: regionLabelText(region) || bucket?.label || "",
      };
    },
    bucketFor(regionId) {
      const rid = (regionId || "").trim();
      if (!rid) return null;
      return self.regions.find((r) => r.regionId === rid) || null;
    },
    get selectedPersisted() {
      return self.bucketFor(self.selectedRegionId)?.attachments?.slice() || [];
    },
    get selectedPending() {
      return self.bucketFor(self.selectedRegionId)?.pendings?.slice() || [];
    },
    hasPendingUploads() {
      return self.regions.some((r) => (r.pendings || []).length > 0);
    },
    exportPayload() {
      const segmentAttachments = [];
      self.regions.forEach((bucket) => {
        const list = bucket.attachments || [];
        if (!list.length) return;
        segmentAttachments.push({
          regionId: bucket.regionId,
          lsfRegionId: bucket.regionId,
          start: bucket.start,
          end: bucket.end,
          evidenceAssetIds: list.map((a) => a.assetId),
          newEvidenceAssetIds: list.filter((a) => a.isNew).map((a) => a.assetId),
          attachments: list.map((a) => ({
            assetId: a.assetId,
            fileName: a.fileName,
            mimeType: a.mimeType,
            size: a.size,
          })),
        });
      });
      return {
        segmentAttachments,
        removedEvidenceAssetIds: self.removedAssetIds.slice(),
      };
    },
  }))
  .actions((self) => {
    const ensureBucket = (regionId, meta = {}) => {
      const rid = (regionId || "").trim();
      if (!rid) return null;
      let bucket = self.regions.find((r) => r.regionId === rid);
      if (!bucket) {
        self.regions.push({
          regionId: rid,
          start: meta.start != null ? Number(meta.start) : null,
          end: meta.end != null ? Number(meta.end) : null,
          label: (meta.label || "").toString(),
          attachments: [],
          pendings: [],
        });
        bucket = self.regions.find((r) => r.regionId === rid);
      } else {
        if (meta.start != null) bucket.start = Number(meta.start);
        if (meta.end != null) bucket.end = Number(meta.end);
        if (meta.label != null && meta.label !== "") bucket.label = String(meta.label);
      }
      return bucket;
    };

    const markDirty = () => {
      self.updateResult();
      self.annotation?.setDraftSelected?.(true);
      try {
        if (typeof window !== "undefined" && typeof window.faivvFlutterDispatch === "function") {
          window.faivvFlutterDispatch("onDirty", { dirty: true });
        }
      } catch (e) {
        /* noop */
      }
    };

    return {
      afterAttach() {
        // Capture selected region meta whenever it changes via reactive UI reads.
      },

      syncSelectedRegionMeta() {
        const region = self.selectedAudioRegion;
        if (!region?.id) return;
        ensureBucket(region.id, {
          start: typeof region.start === "number" ? region.start : null,
          end: typeof region.end === "number" ? region.end : null,
          label: regionLabelText(region),
        });
      },

      ensureBucketForSelection() {
        self.syncSelectedRegionMeta();
      },

      loadFromServer(list) {
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

          const bucket = ensureBucket(regionId, {
            start: raw.start,
            end: raw.end,
            label: raw.label,
          });
          if (!bucket) return;
          // 재오픈 주입은 서버 첨부 목록으로 교체(선택 세션 pending은 유지).
          bucket.attachments.clear();
          attachments.forEach((att) => bucket.attachments.push(att));
        });
      },

      addPendingFiles(regionId, files) {
        const region = self.selectedAudioRegion;
        const rid = (regionId || self.selectedRegionId || "").trim();
        if (!rid || !files?.length) return;
        const meta = region
          ? {
              start: typeof region.start === "number" ? region.start : null,
              end: typeof region.end === "number" ? region.end : null,
              label: regionLabelText(region),
            }
          : {};
        const bucket = ensureBucket(rid, meta);
        if (!bucket) return;
        files.forEach((file) => {
          const tempId = `tmp_${++tempSeq}`;
          pendingFilesByTempId.set(tempId, file);
          bucket.pendings.push({
            tempId,
            fileName: (file && file.name) || "file",
            size: typeof file?.size === "number" ? file.size : 0,
          });
        });
        markDirty();
      },

      removePending(regionId, tempId) {
        const bucket = self.bucketFor(regionId);
        if (!bucket) return;
        const pending = bucket.pendings.find((p) => p.tempId === tempId);
        if (!pending) return;
        pendingFilesByTempId.delete(tempId);
        destroy(pending);
        markDirty();
      },

      removePersisted(regionId, assetId) {
        const bucket = self.bucketFor(regionId);
        if (!bucket) return;
        const att = bucket.attachments.find((a) => a.assetId === assetId);
        if (!att) return;
        if (!att.isNew && !self.removedAssetIds.includes(assetId)) {
          self.removedAssetIds.push(assetId);
        }
        destroy(att);
        if (!bucket.attachments.length && !bucket.pendings.length) {
          destroy(bucket);
        }
        markDirty();
      },

      addImportedAsset(regionId, asset) {
        const rid = (regionId || "").trim();
        if (!rid || !asset?.assetId) return;
        const region = self.selectedAudioRegion;
        const meta =
          region && region.id === rid
            ? {
                start: typeof region.start === "number" ? region.start : null,
                end: typeof region.end === "number" ? region.end : null,
                label: regionLabelText(region),
              }
            : {};
        const bucket = ensureBucket(rid, meta);
        if (!bucket) return;
        const aid = String(asset.assetId).trim();
        if (bucket.attachments.find((a) => a.assetId === aid)) return;
        bucket.attachments.push({
          assetId: aid,
          fileName: asset.fileName || asset.displayName || aid,
          mimeType: asset.mimeType || "",
          size: typeof asset.size === "number" ? asset.size : 0,
          contentUrl: asset.contentUrl || "",
          isNew: true,
        });
        markDirty();
      },

      reconcileDeletedRegions() {
        const ann = self.annotation;
        const alive = {};
        if (ann?.regionStore) {
          (ann.regionStore.regions || []).forEach((r) => {
            if (r?.id) alive[r.id] = true;
          });
        }
        const toRemove = [];
        self.regions.forEach((bucket) => {
          if (alive[bucket.regionId]) return;
          (bucket.attachments || []).forEach((a) => {
            if (!a.isNew && a.assetId && !self.removedAssetIds.includes(a.assetId)) {
              self.removedAssetIds.push(a.assetId);
            }
          });
          (bucket.pendings || []).forEach((p) => pendingFilesByTempId.delete(p.tempId));
          toRemove.push(bucket);
        });
        toRemove.forEach((b) => destroy(b));
      },

      // Promise.then 콜백은 MST action 컨텍스트를 벗어나므로 flow로 감싼다.
      uploadPending: flow(function* uploadPending() {
        self.reconcileDeletedRegions();
        const uploadApi = typeof window !== "undefined" ? window.FaivvAssetUpload : null;
        if (!uploadApi || typeof uploadApi.isConfigured !== "function" || !uploadApi.isConfigured()) {
          if (self.hasPendingUploads()) {
            throw new Error("업로드 API(upload_api)가 설정되지 않았습니다.");
          }
          return;
        }

        const regionIds = self.regions
          .filter((r) => (r.pendings || []).length > 0)
          .map((r) => r.regionId);

        for (const regionId of regionIds) {
          const bucket = self.bucketFor(regionId);
          if (!bucket) continue;
          const pendingSnap = bucket.pendings.slice();
          const files = pendingSnap.map((p) => pendingFilesByTempId.get(p.tempId)).filter(Boolean);
          if (!files.length) {
            pendingSnap.forEach((p) => {
              pendingFilesByTempId.delete(p.tempId);
              destroy(p);
            });
            continue;
          }
          const uploaded = yield uploadApi.uploadFiles(files);
          (uploaded || []).forEach((u) => {
            bucket.attachments.push({
              assetId: u.assetId,
              fileName: u.fileName,
              mimeType: u.mimeType,
              size: u.size,
              contentUrl: u.contentUrl,
              isNew: true,
            });
          });
          pendingSnap.forEach((p) => {
            pendingFilesByTempId.delete(p.tempId);
            const still = bucket.pendings.find((x) => x.tempId === p.tempId);
            if (still) destroy(still);
          });
        }
        self.updateResult();
      }),

      createResult(data) {
        const target = self.toNameTag;
        if (!target) return;
        self.annotation.createResult({}, { segmentattachments: data }, self, target);
      },

      updateResult() {
        self.syncSelectedRegionMeta();
        const data = self.exportPayload();
        if (self.result) {
          self.result.setValue(data);
        } else {
          self.createResult(data);
        }
      },

      commitSaved() {
        self.removedAssetIds.clear();
        self.regions.forEach((bucket) => {
          bucket.attachments.forEach((att) => {
            att.isNew = false;
          });
        });
        self.updateResult();
      },

      reset() {
        self.regions.forEach((bucket) => {
          (bucket.pendings || []).forEach((p) => pendingFilesByTempId.delete(p.tempId));
        });
        self.regions.clear();
        self.removedAssetIds.clear();
      },
    };
  });

const SegmentAttachmentsModel = types.compose(
  "SegmentAttachmentsModel",
  ControlBase,
  AnnotationMixin,
  ReadOnlyControlMixin,
  TagAttrs,
  Model,
);

const HtxSegmentAttachments = inject("store")(
  observer(({ item }) => {
    const selectedRegionId = item.selectedRegionId;

    useEffect(() => {
      if (selectedRegionId) {
        item.ensureBucketForSelection();
      }
    }, [item, selectedRegionId]);

    const resolveContentUrl =
      typeof window !== "undefined" &&
      window.FaivvAssetUpload &&
      typeof window.FaivvAssetUpload.resolveContentUrl === "function"
        ? window.FaivvAssetUpload.resolveContentUrl.bind(window.FaivvAssetUpload)
        : null;

    return (
      <SegmentAttachmentsPanel
        item={item}
        className={item.classname}
        selectedRegionId={selectedRegionId}
        selectedMeta={item.selectedMeta}
        persisted={item.selectedPersisted}
        pending={item.selectedPending}
        readOnly={item.isReadOnly()}
        resolveContentUrl={resolveContentUrl}
      />
    );
  }),
);

Registry.addTag("segmentattachments", SegmentAttachmentsModel, HtxSegmentAttachments);

export { HtxSegmentAttachments, SegmentAttachmentsModel };
