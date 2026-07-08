import PropTypes from "prop-types";

import styles from "./SavedSegmentAttachmentsList.module.scss";

function formatTime(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? `0${s}` : s}`;
}

function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveDownloadUrl(attachment, resolveContentUrl) {
  if (!attachment) return "";
  const contentUrl = (attachment.contentUrl || "").trim();
  if (contentUrl && resolveContentUrl) return resolveContentUrl(contentUrl);
  const assetId = (attachment.assetId || "").trim();
  if (assetId && typeof window !== "undefined" && window.FaivvAssetUpload) {
    return window.FaivvAssetUpload.contentUrlForAssetId(assetId);
  }
  return contentUrl;
}

function SavedSegmentAttachmentsList({ segments, readOnly, onRemove, resolveContentUrl, className }) {
  const groups = Array.isArray(segments) ? segments : [];
  const visible = groups.filter((g) => (g.attachments || []).length > 0);

  if (!visible.length) {
    return <div className={[styles.root, className].filter(Boolean).join(" ")}><div className={styles.empty}>저장된 구간 첨부가 없습니다.</div></div>;
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.subheader}>저장된 구간 첨부</div>
      {visible.map((seg) => {
        const regionId = (seg.regionId || seg.segmentId || seg.id || "").toString();
        const start = seg.start;
        const end = seg.end;
        const timeText =
          typeof start === "number" && typeof end === "number"
            ? `${formatTime(start)} ~ ${formatTime(end)}`
            : "";
        const header = `${seg.label ? `${seg.label} · ` : ""}${timeText || "구간"}`;

        return (
          <div key={regionId || header} className={styles.group}>
            <div className={styles.groupHeader}>{header}</div>
            <div className={styles.list}>
              {(seg.attachments || []).map((att) => {
                const assetId = (att.assetId || "").toString();
                const fileName = (att.fileName || att.displayName || assetId || "file").toString();
                const downloadUrl = resolveDownloadUrl(att, resolveContentUrl);
                const sizeText = formatSize(att.size);

                return (
                  <div key={assetId || fileName} className={styles.item}>
                    <span className={styles.name}>
                      {downloadUrl ? (
                        <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                          {fileName}
                        </a>
                      ) : (
                        fileName
                      )}
                    </span>
                    {sizeText ? <span className={styles.size}>{sizeText}</span> : null}
                    <span className={styles.badge}>저장됨</span>
                    {!readOnly && onRemove ? (
                      <button
                        type="button"
                        className={styles.remove}
                        title="제거"
                        aria-label="제거"
                        onClick={() => onRemove(regionId, assetId)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

SavedSegmentAttachmentsList.propTypes = {
  segments: PropTypes.array,
  readOnly: PropTypes.bool,
  onRemove: PropTypes.func,
  resolveContentUrl: PropTypes.func,
  className: PropTypes.string,
};

export default SavedSegmentAttachmentsList;
