import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group } from "react-konva";
import { isAlive } from "mobx-state-tree";
import { useRegionStyles } from "../../../hooks/useRegionColor";
import { KonvaVector } from "../../../components/KonvaVector/KonvaVector";
import { LabelOnVideoBbox } from "../../../components/ImageView/LabelOnRegion";
import ToolsManager from "../../../tools/Manager";
import {
  diffKeypointsVsVertices,
  isFaivvVectorEditDebugEnabled,
  logFaivvVectorEdit,
  previewMergedKeyframe,
  regionDebugMeta,
  summarizeKeyframe,
  summarizeVertices,
} from "../../../utils/faivvVectorEditDebug";

function regionAlive(reg) {
  try {
    return !!reg && isAlive(reg);
  } catch (e) {
    return false;
  }
}

/**
 * Convert vertices from percent (0-100) to pixel coords using working area dimensions.
 */
const percentToPixelVertices = (vertices, waWidth, waHeight) => {
  return vertices.map((v) => {
    const result = {
      ...v,
      x: (v.x * waWidth) / 100,
      y: (v.y * waHeight) / 100,
    };

    if (v.controlPoint1) {
      result.controlPoint1 = {
        x: (v.controlPoint1.x * waWidth) / 100,
        y: (v.controlPoint1.y * waHeight) / 100,
      };
    }

    if (v.controlPoint2) {
      result.controlPoint2 = {
        x: (v.controlPoint2.x * waWidth) / 100,
        y: (v.controlPoint2.y * waHeight) / 100,
      };
    }

    return result;
  });
};

/**
 * Convert vertices from pixel coords to percent (0-100) using working area dimensions.
 */
const pixelToPercentVertices = (vertices, waWidth, waHeight) => {
  return vertices.map((v) => {
    const result = {
      ...v,
      x: (v.x / waWidth) * 100,
      y: (v.y / waHeight) * 100,
    };

    if (v.controlPoint1) {
      result.controlPoint1 = {
        x: (v.controlPoint1.x / waWidth) * 100,
        y: (v.controlPoint1.y / waHeight) * 100,
      };
    }

    if (v.controlPoint2) {
      result.controlPoint2 = {
        x: (v.controlPoint2.x / waWidth) * 100,
        y: (v.controlPoint2.y / waHeight) * 100,
      };
    }

    return result;
  });
};

const EPSILON = 1e-6;

/**
 * Check if two vertex arrays have the same coordinates (ignoring IDs and metadata).
 * Used to prevent spurious keyframe creation when KonvaVector re-initializes.
 */
const verticesMatch = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > EPSILON || Math.abs(a[i].y - b[i].y) > EPSILON) return false;

    const acp1 = a[i].controlPoint1;
    const bcp1 = b[i].controlPoint1;

    if (acp1 && bcp1) {
      if (Math.abs(acp1.x - bcp1.x) > EPSILON || Math.abs(acp1.y - bcp1.y) > EPSILON) return false;
    } else if (acp1 !== bcp1 && (acp1 || bcp1)) {
      return false;
    }

    const acp2 = a[i].controlPoint2;
    const bcp2 = b[i].controlPoint2;

    if (acp2 && bcp2) {
      if (Math.abs(acp2.x - bcp2.x) > EPSILON || Math.abs(acp2.y - bcp2.y) > EPSILON) return false;
    } else if (acp2 !== bcp2 && (acp2 || bcp2)) {
      return false;
    }
  }

  return true;
};

/**
 * Compute bounding box of pixel vertices for label positioning.
 */
const computeBBox = (vertices) => {
  if (!vertices.length) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const getPointRadiusFromSize = (control) => {
  const size = control?.pointsize ?? "small";

  switch (size) {
    case "medium":
      return { enabled: 5, disabled: 4 };
    case "large":
      return { enabled: 7, disabled: 5 };
    default:
      return { enabled: 4, disabled: 3 };
  }
};

const getMinPoints = (control) => {
  const val = control?.minpoints;

  return val ? Number.parseInt(val) : undefined;
};

const getMaxPoints = (control) => {
  const val = control?.maxpoints;

  return val ? Number.parseInt(val) : undefined;
};

/**
 * VideoVector rendering component for the video overlay.
 *
 * Unlike the image VectorRegion (which stores pixel coords directly), the video
 * version must convert between percent (MobX store) and pixels (KonvaVector).
 * Writing to MobX during every drag frame causes re-renders that interfere with
 * KonvaVector's internal drag state. So we defer MobX writes until drag ends.
 *
 * To prevent the "shape disappears on drag end" bug, lastCommittedRef caches the
 * exact pixel values KonvaVector gave us so that the pixel→percent→pixel roundtrip
 * doesn't cause KonvaVector to re-initialize (its arePointsEqual uses strict ===).
 */
const VideoVectorPure = ({
  id,
  reg,
  box,
  frame,
  workingArea,
  selected,
  draggable,
  listening,
  /** false면 LabelOnVideoBbox 생략 (videoposeregion+bbox는 Rectangle이 담당). */
  showLabel = true,
  onClick: onClickProp,
  onDragMove,
  ...rest
}) => {
  const vectorRef = useRef(null);
  const isDraggingRef = useRef(false);
  const latestDragPixelsRef = useRef(null);
  const [dragPixels, setDragPixels] = useState(null);
  const lastCommittedRef = useRef(null);
  const alive = regionAlive(reg);

  const style = useRegionStyles(reg, { includeFill: true });
  const { realWidth: waWidth, realHeight: waHeight, scale: waScale, x: waX, y: waY } = workingArea;

  // Keep a ref to the latest working area dims and frame so that callbacks
  // reached through stale closures (KonvaVector's stage-level event handlers
  // are set up once and never re-attached) always read fresh values.
  const commitContextRef = useRef({ waWidth, waHeight, frame });
  commitContextRef.current = { waWidth, waHeight, frame };

  const storePixelVertices = useMemo(
    () => percentToPixelVertices(box?.vertices || [], waWidth, waHeight),
    [box?.vertices, waWidth, waHeight],
  );

  let pixelVertices;

  if (dragPixels) {
    pixelVertices = dragPixels;
  } else if (
    lastCommittedRef.current &&
    box?.vertices &&
    verticesMatch(box.vertices, lastCommittedRef.current.percent)
  ) {
    pixelVertices = lastCommittedRef.current.pixels;
  } else {
    pixelVertices = storePixelVertices;
    lastCommittedRef.current = null;
  }

  const bbox = useMemo(() => computeBBox(pixelVertices), [pixelVertices]);

  const control = alive ? reg.results?.[0]?.from_name : null;

  const stageTransform = useMemo(
    () => ({
      zoom: 1,
      offsetX: waX,
      offsetY: waY,
    }),
    [waX, waY],
  );

  const pointRadius = useMemo(() => getPointRadiusFromSize(control), [control?.pointsize]);
  const isReadOnly = alive ? reg.isReadOnly() : true;

  // Match image VectorRegion's disabled/selected detection pattern exactly:
  //   model:  disabled = (tool?.disabled) || isReadOnly || (!selected && !isDrawing)
  //   view:   kvSelected = !disabled,  kvDisabled = isReadOnly
  const objectTag = alive ? reg.object : null;
  const manager = objectTag ? ToolsManager.getInstance({ name: objectTag.name }) : null;
  const selectedTool = manager?.findSelectedTool?.();
  const toolDisabled = selectedTool?.disabled ?? false;
  const isDrawing = alive ? !!reg.isDrawing : false;
  const kvDisabled =
    !alive || toolDisabled || isReadOnly || !listening || (!selected && !isDrawing);
  const kvSelected = !kvDisabled;

  const handleRef = useCallback(
    (kv) => {
      vectorRef.current = kv;
      // 저장·deserialize 후 구 area는 tree에서 제거됨 — dead node setVectorRef 금지
      if (!regionAlive(reg)) return;
      try {
        reg.setVectorRef(kv);
      } catch (e) {
        /* region already detached */
      }
    },
    [reg],
  );

  const commitPoints = useCallback(
    (points) => {
      if (!regionAlive(reg)) return;
      const { waWidth: w, waHeight: h, frame: f } = commitContextRef.current;

      if (!w || !h) return;

      const percentPoints = pixelToPercentVertices(points, w, h);
      const currentShape = reg.getShape(f);

      if (currentShape?.vertices && verticesMatch(currentShape.vertices, percentPoints)) {
        if (isFaivvVectorEditDebugEnabled()) {
          logFaivvVectorEdit("VideoVector.commit.skip-same", {
            ...regionDebugMeta(reg),
            frame: f,
            vertices: summarizeVertices(percentPoints),
          });
        }
        return;
      }

      if (isFaivvVectorEditDebugEnabled()) {
        const data = {
          vertices: percentPoints,
          closed: currentShape?.closed ?? false,
        };
        const merged = previewMergedKeyframe(currentShape, data, f);
        logFaivvVectorEdit("VideoVector.commit", {
          ...regionDebugMeta(reg),
          frame: f,
          // VideoVectorShape → updateShape({vertices}) 만 전달. keypoints는 merge 잔존.
          kpVsVert: diffKeypointsVsVertices(currentShape, merged),
          before: summarizeKeyframe(currentShape),
          afterVertices: summarizeVertices(percentPoints),
          hint:
            "실제 region: VideoPoseRegion|VideoVectorRegion (VectorRegion=image 전용). " +
            "envelope: data.lsfResult.value.sequence[].keypoints|vertices",
        });
      }

      lastCommittedRef.current = { percent: percentPoints, pixels: points };
      try {
        reg.updateShape({ vertices: percentPoints, closed: currentShape?.closed ?? false }, f);
      } catch (e) {
        /* region detached mid-drag */
      }
    },
    [reg],
  );

  const handlePointsChange = useCallback(
    (points) => {
      if (isDraggingRef.current) {
        latestDragPixelsRef.current = points;
        setDragPixels(points);
        return;
      }
      commitPoints(points);
    },
    [commitPoints],
  );

  const handleTransformStart = useCallback(() => {
    if (!regionAlive(reg)) return;
    isDraggingRef.current = true;
    latestDragPixelsRef.current = null;
    try {
      reg.annotation?.history?.freeze?.();
    } catch (e) {
      /* detached */
    }
  }, [reg]);

  const handleTransformEnd = useCallback(() => {
    isDraggingRef.current = false;
    if (latestDragPixelsRef.current) {
      commitPoints(latestDragPixelsRef.current);
      latestDragPixelsRef.current = null;
    }
    if (!regionAlive(reg)) return;
    try {
      reg.annotation?.history?.unfreeze?.();
    } catch (e) {
      /* detached */
    }
  }, [commitPoints, reg]);

  // Clear dragPixels once MobX store has propagated the committed values.
  // This avoids the race where clearing dragPixels immediately in handleTransformEnd
  // causes the shape to flash to old positions before MobX observer re-renders.
  useEffect(() => {
    if (dragPixels && !isDraggingRef.current && lastCommittedRef.current) {
      if (box?.vertices && verticesMatch(box.vertices, lastCommittedRef.current.percent)) {
        setDragPixels(null);
      }
    }
  }, [dragPixels, box?.vertices]);

  const handlePathClosedChange = useCallback(
    (isClosed) => {
      if (!regionAlive(reg)) return;
      const shape = reg.getShape(frame);

      if (!shape) return;
      if (shape.closed === isClosed) return;

      try {
        reg.updateShape({ vertices: shape.vertices, closed: isClosed }, frame);
      } catch (e) {
        /* detached */
      }
    },
    [reg, frame],
  );

  const handleFinish = useCallback(
    (e) => {
      if (!regionAlive(reg) || isReadOnly) return;
      e.evt.stopPropagation();
      e.evt.preventDefault();

      const objTag = reg.object;

      if (!objTag) return;

      const mgr = ToolsManager.getInstance({ name: objTag.name });
      const tool = mgr?.findSelectedTool?.();

      if (tool?.currentArea) {
        tool.commitDrawingRegion?.();
      }
      tool?.complete?.();
    },
    [isReadOnly, reg],
  );

  const handleRegionClick = useCallback(
    (e) => {
      if (!regionAlive(reg)) return;
      if (e.evt.defaultPrevented) return;
      if (reg.isReadOnly()) return;
      if (reg.isDrawing) return;
      if (e.evt.altKey || e.evt.ctrlKey || e.evt.shiftKey || e.evt.metaKey) return;

      e.cancelBubble = true;

      const objTag = reg.object;
      const mgr = objTag ? ToolsManager.getInstance({ name: objTag.name }) : null;
      const tool = mgr?.findSelectedTool?.();

      if (tool?.currentArea && tool.currentArea !== reg && tool.complete) {
        tool.complete();
      }

      if (typeof onClickProp === "function") {
        onClickProp(e);
      } else {
        try {
          reg.setHighlight(false);
          reg.onClickRegion(e);
        } catch (err) {
          /* detached */
        }
      }
    },
    [reg, frame, onClickProp],
  );

  // 저장·rehydrate로 area가 교체되면 구 observer가 한 틱 남을 수 있음 — dead node 렌더 금지
  if (!alive) return null;

  // videoposeregion + bbox: Rectangle이 LabelOnVideoBbox를 그림 → 이중 칩 방지
  const hasRegionBbox =
    box &&
    box.x != null &&
    box.y != null &&
    Number(box.width) > 0 &&
    Number(box.height) > 0;
  const poseBboxOwnsLabel = reg?.type === "videoposeregion" && hasRegionBbox;
  const renderLabel = showLabel !== false && !poseBboxOwnsLabel && pixelVertices.length > 0;

  return (
    <Group listening={listening} opacity={reg.hidden ? 0 : 1}>
      {/* 라벨을 점 아래에 두어 tip/grip 히트를 가리지 않음 */}
      {renderLabel && (
        <LabelOnVideoBbox
          reg={reg}
          box={bbox}
          scale={waScale}
          color={style.strokeColor}
          strokeWidth={style.strokeWidth}
          adjacent
        />
      )}
      <KonvaVector
        key={reg.id}
        ref={handleRef}
        initialPoints={Array.from(pixelVertices)}
        closed={box?.closed}
        width={waWidth}
        height={waHeight}
        scaleX={1}
        scaleY={1}
        x={0}
        y={0}
        transform={stageTransform}
        fitScale={waScale}
        allowClose={control?.closable ?? false}
        allowBezier={false}
        minPoints={getMinPoints(control)}
        maxPoints={getMaxPoints(control)}
        skeletonEnabled={control?.skeleton ?? false}
        stroke={selected ? "#ff0000" : style.strokeColor}
        fill={style.fillColor ?? "transparent"}
        strokeWidth={style.strokeWidth}
        opacity={Number.parseFloat(control?.opacity || "1")}
        pixelSnapping={control?.snap === "pixel"}
        selected={kvSelected}
        disabled={isReadOnly}
        pointRadius={pointRadius}
        pointFill={selected ? "#ffffff" : "#f8fafc"}
        pointStroke={selected ? "#ff0000" : style.strokeColor}
        pointStrokeSelected="#ff6b35"
        pointStrokeWidth={selected ? 2 : 1}
        pointStyle={control?.pointstyle ?? "circle"}
        disableInternalPointAddition={true}
        disableGhostLine={isDraggingRef.current}
        onFinish={handleFinish}
        onPointsChange={handlePointsChange}
        onTransformStart={handleTransformStart}
        onTransformEnd={handleTransformEnd}
        onPathClosedChange={handlePathClosedChange}
        onClick={handleRegionClick}
        onMouseEnter={() => {
          if (!regionAlive(reg)) return;
          try {
            reg.setHighlight(true);
          } catch (e) {
            /* detached */
          }
        }}
        onMouseLeave={() => {
          if (!regionAlive(reg)) return;
          try {
            reg.setHighlight(false);
          } catch (e) {
            /* detached */
          }
        }}
      />
    </Group>
  );
};

export const VideoVectorShape = observer(VideoVectorPure);
