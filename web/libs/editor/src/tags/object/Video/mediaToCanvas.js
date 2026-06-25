/**
 * Video canvas 좌표 변환 — 미디어 % (0–100) → .lsf-video__main 내부 px.
 * VideoRectangle bboxCoordsCanvas 와 POSE keypoint 오버레이가 동일 식을 사용한다.
 */
export function mediaPercentToCanvas(video, xPct, yPct) {
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
  const panXAdj = (Math.abs(pan.x) - Math.abs((viewW - scaledW) / 2)) * panXDir;
  const panYAdj = (Math.abs(pan.y) - Math.abs((viewH - scaledH) / 2)) * panYDir;
  const offsetX = panXOverflow ? panXAdj : 0;
  const offsetY = panYOverflow ? panYAdj : 0;
  const baseX = (viewW - scaledW) / 2 + pan.x - offsetX;
  const baseY = (viewH - scaledH) / 2 + pan.y - offsetY;

  return {
    x: ((xPct * mediaW) / 100) * zoom + baseX,
    y: ((yPct * mediaH) / 100) * zoom + baseY,
  };
}

export function mediaBboxToCanvas(video, bbox) {
  if (!bbox) return null;

  const topLeft = mediaPercentToCanvas(video, bbox.left, bbox.top);
  const bottomRight = mediaPercentToCanvas(video, bbox.right, bbox.bottom);

  if (!topLeft || !bottomRight) return null;

  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}
