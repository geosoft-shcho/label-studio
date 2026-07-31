import type { KonvaEventObject } from "konva/lib/Node";
import { observer } from "mobx-react";
import { type FC, useMemo, useRef } from "react";
import { Group, Rect } from "react-konva";
import { useRegionStyles } from "../../../hooks/useRegionColor";
import { getNodeAbsoluteDimensions, normalizeNodeDimentions } from "./tools";
import type { WorkingArea } from "./types";
import { LabelOnVideoBbox } from "../../../components/ImageView/LabelOnRegion";
import {
  faivvVideoManualDebug,
  summarizePoseShape,
  summarizeRegionForBboxEdit,
} from "./faivvVideoManualDebug";

type RectPropsExtend = typeof Rect;

interface RectProps extends RectPropsExtend {
  reg: any;
  frame: number;
  selected: boolean;
  draggable: boolean;
  listening: boolean;
  box: { x: number; y: number; width: number; height: number; rotation: number };
  workingArea: WorkingArea;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
}

const RectanglePure: FC<RectProps> = ({
  reg,
  box,
  frame,
  workingArea,
  selected,
  draggable,
  listening,
  onDragMove,
  ...rest
}) => {
  const style = useRegionStyles(reg, { includeFill: true });
  // 설계-20: LayerSegment.confidence set → 자동(AI) 점선 bbox
  const isAuto = !!(reg?.hasInferenceConfidence ?? (reg?.inferenceConfidence != null));
  const editLoggedRef = useRef(false);

  const { realWidth: waWidth, realHeight: waHeight, scale: waScale } = workingArea;

  const newBox = useMemo(
    () => ({
      x: (box.x * waWidth) / 100,
      y: (box.y * waHeight) / 100,
      width: (box.width * waWidth) / 100,
      height: (box.height * waHeight) / 100,
      rotation: box.rotation,
    }),
    [box, waWidth, waHeight],
  );

  const logBboxEdit = (phase: string, e: KonvaEventObject<Event>, dims?: Record<string, number>) => {
    const target = summarizeRegionForBboxEdit(reg);
    faivvVideoManualDebug("bbox.edit", {
      phase,
      eventType: e.type,
      frame,
      // 편집 중인 LayerSegment — Flutter 터미널에서 segmentId로 특정
      segmentId: target?.segmentId ?? null,
      target,
      shape: dims ? summarizePoseShape(dims) : null,
    });
  };

  const onDimensionUpdate = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const dims = getNodeAbsoluteDimensions(node, workingArea);

    if (e.type === "dragmove") {
      onDragMove(e as KonvaEventObject<DragEvent>);
      // dragmove는 스팸 방지: 제스처당 1회만 segment 특정 로그
      if (!editLoggedRef.current) {
        editLoggedRef.current = true;
        logBboxEdit("drag_start", e, dims);
      }
    } else if (e.type === "dragend") {
      editLoggedRef.current = false;
      logBboxEdit("drag_end", e, dims);
    } else if (e.type === "transformend") {
      editLoggedRef.current = false;
      logBboxEdit("transform_end", e, dims);
    }

    reg.updateShape(dims, frame);
  };

  const onTransform = (e: KonvaEventObject<Event>) => {
    normalizeNodeDimentions(e.target, "rect");
    if (!editLoggedRef.current) {
      editLoggedRef.current = true;
      const dims = getNodeAbsoluteDimensions(e.target, workingArea);
      logBboxEdit("transform_start", e, dims);
    }
  };

  return (
    <Group>
      <LabelOnVideoBbox
        reg={reg}
        box={newBox}
        scale={waScale}
        color={style.strokeColor}
        strokeWidth={style.strokeWidth}
        adjacent
      />
      <Rect
        {...newBox}
        fill={style.fillColor ?? "#fff"}
        stroke={style.strokeColor}
        dash={isAuto ? [6, 4] : undefined}
        strokeScaleEnabled={false}
        selected={selected}
        draggable={draggable}
        listening={listening}
        opacity={reg.hidden ? 0 : 1}
        onTransform={onTransform}
        onTransformEnd={onDimensionUpdate}
        onDragMove={onDimensionUpdate}
        onDragEnd={onDimensionUpdate}
        {...rest}
      />
    </Group>
  );
};

export const Rectangle = observer(RectanglePure);
