import { useRef, useState } from "react";
import { observer } from "mobx-react";
import PropTypes from "prop-types";

import styles from "./SegmentAttachmentsPanel.module.scss";

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

function extractDropSource(dt) {
  if (!dt) return { url: "", meta: null };
  try {
    const raw = dt.getData("application/x-faivv-asset-ref");
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.sourceUrl) {
        return { url: String(obj.sourceUrl).trim(), meta: obj };
      }
    }
  } catch (e) {
    /* noop */
  }
  try {
    const uriList = dt.getData("text/uri-list") || "";
    if (uriList) {
      const lines = uriList.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = (lines[i] || "").trim();
        if (line && line.charAt(0) !== "#") return { url: line, meta: null };
      }
    }
  } catch (e) {
    /* noop */
  }
  try {
    const plain = (dt.getData("text/plain") || "").trim();
    if (plain) return { url: plain, meta: null };
  } catch (e) {
    /* noop */
  }
  return { url: "", meta: null };
}

function isSupportedSource(url) {
  return /^(fileservice|mongoservice):\/\//i.test(url || "");
}

function SegmentAttachmentsPanel({
  item,
  selectedRegionId,
  selectedMeta,
  persisted,
  pending,
  readOnly,
  resolveContentUrl,
  className,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const metaText = (() => {
    if (statusMessage) return statusMessage;
    if (!selectedRegionId) {
      return "오디오 타임라인에서 구간을 선택하면 파일을 첨부할 수 있습니다.";
    }
    const timeText =
      typeof selectedMeta?.start === "number" && typeof selectedMeta?.end === "number"
        ? `${formatTime(selectedMeta.start)} ~ ${formatTime(selectedMeta.end)}`
        : "";
    return `${selectedMeta?.label ? `${selectedMeta.label} · ` : ""}${timeText || "선택 구간"}`;
  })();

  const onAddClick = () => {
    if (readOnly) return;
    if (!selectedRegionId) {
      setStatusMessage("먼저 오디오 타임라인에서 구간을 선택하세요.");
      return;
    }
    setStatusMessage("");
    inputRef.current?.click();
  };

  const onFilesPicked = (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length || readOnly || !selectedRegionId) return;
    item.addPendingFiles(selectedRegionId, files);
    setStatusMessage("");
  };

  const onDragOver = (e) => {
    if (readOnly) return;
    e.preventDefault();
    try {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    } catch (err) {
      /* noop */
    }
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;

    const parsed = extractDropSource(e.dataTransfer);
    if (!isSupportedSource(parsed.url)) {
      setStatusMessage("지원하지 않는 드롭입니다. (fileservice/mongoservice URL만 가능)");
      return;
    }
    if (!selectedRegionId) {
      setStatusMessage("먼저 오디오 타임라인에서 구간을 선택하세요.");
      return;
    }

    const importer = typeof window !== "undefined" ? window.FaivvAssetImport : null;
    if (!importer || typeof importer.importFromSource !== "function") {
      setStatusMessage("가져오기 모듈이 초기화되지 않았습니다.");
      return;
    }

    const regionId = selectedRegionId;
    setStatusMessage("외부 파일 가져오는 중…");
    importer
      .importFromSource(parsed.url, {
        name: parsed.meta && parsed.meta.name,
        mimeType: parsed.meta && parsed.meta.mimeType,
      })
      .then((asset) => {
        item.addImportedAsset(regionId, asset);
        setStatusMessage("");
        try {
          if (typeof window !== "undefined" && typeof window.faivvFlutterDispatch === "function") {
            window.faivvFlutterDispatch("onAssetImported", {
              assetId: asset.assetId || "",
              fileName: asset.fileName || "",
              regionId: regionId,
              source: "external_drop",
            });
          }
        } catch (e) {
          /* noop */
        }
      })
      .catch((err) => {
        setStatusMessage(`가져오기 실패: ${String((err && err.message) || err)}`);
      });
  };

  const emptyText = !selectedRegionId
    ? "선택된 구간이 없습니다."
    : readOnly
      ? "첨부 파일이 없습니다."
      : "이 구간에 파일을 첨부하세요.";

  const hasItems = (persisted || []).length > 0 || (pending || []).length > 0;

  return (
    <div
      className={[styles.root, dragOver ? styles.rootDragover : "", className].filter(Boolean).join(" ")}
      data-faivv-seg-attach="1"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.header}>구간 첨부 파일</div>
      <div className={styles.meta}>{metaText}</div>
      <div className={styles.list}>
        {!hasItems ? (
          <div className={styles.empty}>{emptyText}</div>
        ) : (
          <>
            {(persisted || []).map((a) => {
              const downloadUrl = resolveDownloadUrl(a, resolveContentUrl);
              const sizeText = formatSize(a.size);
              return (
                <div key={a.assetId} className={styles.item}>
                  <span className={styles.name}>
                    {downloadUrl ? (
                      <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                        {a.fileName || a.assetId}
                      </a>
                    ) : (
                      a.fileName || a.assetId
                    )}
                  </span>
                  {sizeText ? <span className={styles.size}>{sizeText}</span> : null}
                  <span className={styles.badge}>{a.isNew ? "업로드됨" : "저장됨"}</span>
                  {!readOnly ? (
                    <button
                      type="button"
                      className={styles.remove}
                      title="제거"
                      aria-label="제거"
                      onClick={() => item.removePersisted(selectedRegionId, a.assetId)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              );
            })}
            {(pending || []).map((p) => {
              const sizeText = formatSize(p.size);
              return (
                <div key={p.tempId} className={[styles.item, styles.itemPending].join(" ")}>
                  <span className={styles.name}>{p.fileName || "file"}</span>
                  {sizeText ? <span className={styles.size}>{sizeText}</span> : null}
                  <span className={[styles.badge, styles.badgePending].join(" ")}>대기</span>
                  {!readOnly ? (
                    <button
                      type="button"
                      className={styles.remove}
                      title="제거"
                      aria-label="제거"
                      onClick={() => item.removePending(selectedRegionId, p.tempId)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              );
            })}
          </>
        )}
      </div>
      {!readOnly ? (
        <div className={styles.actions}>
          <input
            ref={inputRef}
            type="file"
            multiple
            className={styles.fileInput}
            data-faivv-seg-attach-input="1"
            onChange={onFilesPicked}
          />
          <button type="button" className={styles.add} onClick={onAddClick}>
            + 파일 추가
          </button>
        </div>
      ) : null}
    </div>
  );
}

SegmentAttachmentsPanel.propTypes = {
  item: PropTypes.object.isRequired,
  selectedRegionId: PropTypes.string,
  selectedMeta: PropTypes.object,
  persisted: PropTypes.array,
  pending: PropTypes.array,
  readOnly: PropTypes.bool,
  resolveContentUrl: PropTypes.func,
  className: PropTypes.string,
};

export default observer(SegmentAttachmentsPanel);
