import type React from "react";
import { Fragment } from "react";
import { Circle as KonvaCircle, Rect as KonvaRect, Text as KonvaText } from "react-konva";
import type Konva from "konva";
import type { BezierPoint } from "../types";
import { HIT_RADIUS } from "../constants";

// react-konva ↔ React JSX 타입 불일치 (VectorTransformer와 동일 패턴)
const Circle = KonvaCircle as any;
const Rect = KonvaRect as any;
const Text = KonvaText as any;

/** tip/grip/pose 관절명. nanoid·UUID는 숨김. */
export type ShowPointLabelsMode = boolean | "always" | "selected" | "auto" | "never";

/** Soft-split vertices[].id 형태 (tip, left_eye). 수동 nanoid는 제외. */
export function isSemanticPointLabel(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const s = id.trim();
  if (!s || s.length > 40) return false;
  // UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
  // pose/torch: lowercase snake_case (tip, grip, nose, left_shoulder)
  return /^[a-z][a-z0-9_]{0,39}$/.test(s);
}

function shouldRenderPointLabels(
  mode: ShowPointLabelsMode | undefined,
  selected: boolean,
  pointCount: number,
): boolean {
  if (mode === false || mode === "never" || mode == null) return false;
  if (mode === true || mode === "always") return true;
  if (mode === "selected") return selected;
  // auto: tip/grip(≤2)는 항상, pose(다점)는 selected일 때만
  return selected || pointCount <= 2;
}

interface VectorPointsProps {
  initialPoints: BezierPoint[];
  selectedPointIndex: number | null;
  selectedPoints: Set<number>;
  transform: { zoom: number; offsetX: number; offsetY: number };
  fitScale: number;
  pointRefs: React.MutableRefObject<{ [key: number]: Konva.Circle | Konva.Rect | null }>;
  selected?: boolean;
  disabled?: boolean;
  transformMode?: boolean;
  pointRadius?: {
    enabled?: number;
    disabled?: number;
  };
  pointFill?: string;
  pointStroke?: string;
  pointStrokeSelected?: string;
  pointStrokeWidth?: number;
  pointStyle?: "circle" | "rectangle";
  activePointId?: string | null;
  maxPoints?: number;
  /** Soft-split tip/grip·pose 관절명 표시. 기본 never(이미지 Vector 무영향). */
  showPointLabels?: ShowPointLabelsMode;
  onPointClick?: (e: Konva.KonvaEventObject<MouseEvent>, pointIndex: number) => void;
}

export const VectorPoints: React.FC<VectorPointsProps> = ({
  initialPoints,
  selectedPointIndex,
  selectedPoints,
  transform,
  fitScale,
  pointRefs,
  selected = true,
  disabled = false,
  transformMode = false,
  pointRadius,
  pointFill = "#ffffff",
  pointStroke = "#3b82f6",
  pointStrokeSelected = "#ffffff",
  pointStrokeWidth = 2,
  pointStyle = "circle",
  activePointId = null,
  maxPoints,
  showPointLabels = "never",
  onPointClick,
}) => {
  // CRITICAL: For single-point regions, we need to allow clicks even when not selected
  // Single-point regions have no segments to click on, so clicking the point must trigger region selection
  // BUT: Never allow clicks when disabled or in transform mode
  const isSinglePointRegion = initialPoints.length === 1;
  const shouldListenToClicks = !disabled && !transformMode && (selected || isSinglePointRegion);

  // CRITICAL: Always enable listening for hit detection to ensure consistent hit box
  // regardless of selected state. The hitFunc will always use HIT_RADIUS.SELECTION / scale
  // for consistent hit detection. We handle click events conditionally in onClick handler.
  const shouldEnableListening = !disabled && !transformMode;
  const renderLabels = shouldRenderPointLabels(showPointLabels, selected, initialPoints.length);

  return (
    <>
      {initialPoints.map((point, index) => {
        // Scale up radius to compensate for Layer scaling
        const scale = transform.zoom * fitScale || 1;
        // Use configurable radius with fallbacks to defaults
        const enabledRadius = pointRadius?.enabled ?? 6;
        const disabledRadius = pointRadius?.disabled ?? 4;
        const baseRadius = selected ? enabledRadius : disabledRadius;
        // Check if maxPoints is reached
        const isMaxPointsReached = maxPoints !== undefined && initialPoints.length >= maxPoints;
        // Check if multiple points are selected
        const isMultiSelection = selectedPoints.size > 1;
        // Point is explicitly selected if it's in selectedPoints or is the selectedPointIndex
        const isExplicitlySelected = selectedPointIndex === index || selectedPoints.has(index);
        // Active point should only be rendered as selected if:
        // - It's explicitly selected, OR
        // - (selected AND maxPoints not reached AND not in multi-selection AND it's the active point)
        const isSelected =
          isExplicitlySelected ||
          (selected &&
            !isMaxPointsReached &&
            !isMultiSelection &&
            activePointId !== null &&
            point.id === activePointId);
        // Make selected points larger
        const radiusMultiplier = isSelected ? 1.3 : 1;
        const scaledRadius = (baseRadius * radiusMultiplier) / scale;
        const pointLabel = renderLabels && isSemanticPointLabel(point.id) ? point.id : null;
        const fontSize = 10 / scale;
        const labelOffsetX = scaledRadius + 4 / scale;
        const labelOffsetY = -fontSize / 2;

        const labelNode = pointLabel ? (
          <Text
            key={`point-label-${index}-${pointLabel}`}
            x={point.x + labelOffsetX}
            y={point.y + labelOffsetY}
            text={pointLabel}
            fontSize={fontSize}
            fontFamily="sans-serif"
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.75)"
            strokeWidth={Math.max(0.5, 2 / scale)}
            fillAfterStrokeEnabled
            listening={false}
            perfectDrawEnabled={false}
            name={`point-label-${index}`}
          />
        ) : null;

        // Common props for both Circle and Rect
        const commonClickHandler = onPointClick
          ? (e: Konva.KonvaEventObject<MouseEvent>) => {
              // Only handle clicks when shouldListenToClicks is true
              // Otherwise, let the event bubble to stage-level handlers
              if (!shouldListenToClicks) {
                // Don't handle the click, let it bubble to stage-level handlers
                return;
              }

              // For single-point regions, call onPointClick but don't stop propagation
              // The onPointClick handler in KonvaVector will directly call handleClickWithDebouncing
              // to trigger region selection
              if (isSinglePointRegion && !e.evt.altKey && !e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey) {
                // Don't stop propagation - let onPointClick handle it and call onClick directly
                onPointClick(e, index);
                return;
              }

              // Stop propagation immediately to prevent the event from bubbling to VectorShape onClick
              // This prevents the shape from being selected/unselected when clicking on points
              e.evt.stopImmediatePropagation();
              e.evt.stopPropagation();
              e.evt.preventDefault();
              e.cancelBubble = true;
              onPointClick(e, index);
            }
          : undefined;

        // Hit function for both shapes
        const hitFunc = (context: Konva.Context, shape: Konva.Shape) => {
          // Calculate a larger hit radius using the constant (scaled for current zoom)
          // This ensures consistent hit detection regardless of selected/unselected state
          const hitRadius = HIT_RADIUS.SELECTION / scale;
          context.beginPath();
          context.arc(0, 0, hitRadius, 0, Math.PI * 2);
          context.fillStrokeShape(shape);
        };

        if (pointStyle === "rectangle") {
          // Rectangle style - calculate size from radius
          const size = scaledRadius * 2;

          return (
            <Fragment key={`point-wrap-${index}-${point.id || index}`}>
              {/* White outline ring for selected points - rendered outside the colored stroke */}
              {selected && isSelected && (
                <Rect
                  key={`point-outline-${index}-${point.x}-${point.y}`}
                  x={point.x - size / 2}
                  y={point.y - size / 2}
                  width={size}
                  height={size}
                  fill="transparent"
                  stroke={pointStrokeSelected}
                  strokeScaleEnabled={false}
                  strokeWidth={pointStrokeWidth + 5}
                  listening={false}
                  name={`point-outline-${index}`}
                />
              )}
              {/* Main point rectangle with colored stroke */}
              <Rect
                key={`point-${index}-${point.x}-${point.y}`}
                ref={(node: Konva.Rect | null) => {
                  pointRefs.current[index] = node;
                }}
                x={point.x - size / 2}
                y={point.y - size / 2}
                width={size}
                height={size}
                fill={pointFill}
                stroke={pointStroke}
                strokeScaleEnabled={false}
                strokeWidth={pointStrokeWidth}
                listening={shouldEnableListening}
                name={`point-${index}`}
                hitFunc={hitFunc}
                onClick={commonClickHandler}
              />
              {labelNode}
            </Fragment>
          );
        }

        // Circle style (default)
        return (
          <Fragment key={`point-wrap-${index}-${point.id || index}`}>
            {/* White outline ring for selected points - rendered outside the colored stroke */}
            {selected && isSelected && (
              <Circle
                key={`point-outline-${index}-${point.x}-${point.y}`}
                x={point.x}
                y={point.y}
                radius={scaledRadius}
                fill="transparent"
                stroke={pointStrokeSelected}
                strokeScaleEnabled={false}
                strokeWidth={pointStrokeWidth + 5}
                listening={false}
                name={`point-outline-${index}`}
              />
            )}
            {/* Main point circle with colored stroke */}
            <Circle
              key={`point-${index}-${point.x}-${point.y}`}
              ref={(node: Konva.Circle | null) => {
                pointRefs.current[index] = node;
              }}
              x={point.x}
              y={point.y}
              radius={scaledRadius}
              fill={pointFill}
              stroke={pointStroke}
              strokeScaleEnabled={false}
              strokeWidth={pointStrokeWidth}
              // Always enable listening for hit detection to ensure consistent hit box
              // regardless of selected state. The hitFunc will always use HIT_RADIUS.SELECTION / scale
              // for consistent hit detection. We handle click events conditionally in onClick handler.
              listening={shouldEnableListening}
              name={`point-${index}`}
              // Use custom hit function to create a larger clickable area around the point
              // This makes points easier to click even when the cursor is not exactly over the point
              // CRITICAL: Always use the same hit radius regardless of selected state for consistent behavior
              hitFunc={hitFunc}
              onClick={commonClickHandler}
            />
            {labelNode}
          </Fragment>
        );
      })}
    </>
  );
};
