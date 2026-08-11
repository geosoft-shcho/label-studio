import chroma from "chroma-js";
import { clamp } from "lodash";
import { observer } from "mobx-react";
import { getParentOfType, isAlive } from "mobx-state-tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import Constants from "../../../core/Constants";
import { Annotation } from "../../../stores/Annotation/Annotation";
import { fixMobxObserve } from "../../../utils/utilities";
import { Rectangle } from "./Rectangle";
import { VideoVectorShape } from "./VideoVector";
import { createBoundingBoxGetter, createOnDragMoveHandler } from "./TransformTools";
import ToolsManager from "../../../tools/Manager";

export const MIN_SIZE = 5;

const SelectionRect = (props) => {
  return (
    <>
      <Rect {...props} strokeWidth={2} stroke="#fff" />
      <Rect {...props} fill={chroma("#617ADA").alpha(0.1).css()} strokeWidth={2} stroke="#617ADA" dash={[2, 2]} />
    </>
  );
};

const VideoRegionsPure = ({
  item,
  regions,
  width,
  height,
  zoom,
  workingArea: videoDimensions,
  locked = false,
  allowRegionsOutsideWorkingArea = true,
  pan = { x: 0, y: 0 },
  stageRef,
}) => {
  const [newRegion, setNewRegion] = useState();
  const [isDrawing, setDrawingMode] = useState(false);

  const selected = regions.filter((reg) => {
    return (reg.selected || reg.inSelection) && !reg.hidden && !reg.isReadOnly() && reg.isInLifespan(item.frame);
  });
  const listenToEvents = !locked;

  // if region is not in lifespan, it's not rendered,
  // so we observe all the sequences to rerender transformer
  regions.map((reg) => fixMobxObserve(reg.sequence));

  const workinAreaCoordinates = useMemo(() => {
    const resultWidth = videoDimensions.width * zoom;
    const resultHeight = videoDimensions.height * zoom;
    const overshotX = Math.abs(pan.x) >= Math.abs((width - resultWidth) / 2);
    const overshotY = Math.abs(pan.y) >= Math.abs((height - resultHeight) / 2);
    const panXDirection = pan.x > 0 ? 1 : -1;
    const panYDirection = pan.y > 0 ? 1 : -1;
    const overshotXAmmount = (Math.abs(pan.x) - Math.abs((width - resultWidth) / 2)) * panXDirection;
    const overshotYAmmount = (Math.abs(pan.y) - Math.abs((height - resultHeight) / 2)) * panYDirection;
    const edgeZoomOffestX = overshotX ? overshotXAmmount : 0;
    const edgeZoomOffestY = overshotY ? overshotYAmmount : 0;
    const offsetLeft = (width - resultWidth) / 2 + pan.x - edgeZoomOffestX;
    const offsetTop = (height - resultHeight) / 2 + pan.y - edgeZoomOffestY;

    return {
      width: resultWidth,
      height: resultHeight,
      x: offsetLeft,
      y: offsetTop,
      scale: zoom,
      realWidth: videoDimensions.width,
      realHeight: videoDimensions.height,
    };
  }, [pan.x, pan.y, zoom, videoDimensions, width, height]);

  const layerProps = useMemo(
    () => ({
      width: workinAreaCoordinates.width,
      height: workinAreaCoordinates.height,
      scaleX: zoom,
      scaleY: zoom,
      position: {
        x: workinAreaCoordinates.x,
        y: workinAreaCoordinates.y,
      },
    }),
    [workinAreaCoordinates, zoom],
  );

  const normalizeMouseOffsets = useCallback(
    (x, y) => {
      const { x: offsetLeft, y: offsetTop } = workinAreaCoordinates;

      return {
        x: (x - offsetLeft) / zoom,
        y: (y - offsetTop) / zoom,
      };
    },
    [workinAreaCoordinates, zoom],
  );

  useEffect(() => {
    if (!isDrawing && newRegion) {
      const { width: waWidth, height: waHeight } = videoDimensions;
      // React 17 + Konva: setDrawingMode(false)가 동기 flush되면 click 경로에서도
      // newRegion(0×0)이 여기로 들어올 수 있음 → 스킵 (라벨 unselect 방지)
      if (Math.abs(newRegion.width) < MIN_SIZE && Math.abs(newRegion.height) < MIN_SIZE) {
                setNewRegion(null);
        return;
      }

      let x = (newRegion.x / waWidth) * 100;
      let y = (newRegion.y / waHeight) * 100;
      let width = (newRegion.width / waWidth) * 100;
      let height = (newRegion.height / waHeight) * 100;

      // deal with negative sizes
      if (width < 0) {
        width *= -1;
        x -= width;
      }
      if (height < 0) {
        height *= -1;
        y -= height;
      }

      const fixedRegion = { x, y, width, height };

            item.addVideoRegion(fixedRegion);
      setNewRegion(null);
    }
  }, [isDrawing, workinAreaCoordinates, videoDimensions]);

  const inBounds = (x, y) => {
    if (allowRegionsOutsideWorkingArea) return true;

    return x > 0 && y > 0 && x < workinAreaCoordinates.realWidth && y < workinAreaCoordinates.realHeight;
  };

  const limitCoordinates = ({ x, y }) => {
    if (allowRegionsOutsideWorkingArea) return { x, y };

    return {
      x: clamp(x, 0, workinAreaCoordinates.realWidth),
      y: clamp(y, 0, workinAreaCoordinates.realHeight),
    };
  };

  const getVectorTool = useCallback(() => {
    try {
      const manager = ToolsManager.getInstance({ name: item.name });
      const selected = manager?.findSelectedTool();
      const drawing = manager?.findDrawingTool();

      // Soft-split 수동 tip/grip: VideoVectorTool
      if (drawing?.toolName === "VideoVectorTool") return drawing;
      if (selected?.toolName === "VideoVectorTool") return selected;
    } catch {
      // No tool manager available
    }
    return null;
  }, [item.name]);

  const isVectorDrawingTool = (tool) => tool && tool.toolName === "VideoVectorTool";

  // Soft-split VideoVector: 빈 Stage 제스처 → 드래그=bbox 프리뷰 / 클릭=점.
  // canResumeDrawing만으로 툴에 넘기면 hydrate된 리전이 빈 영역 드래그(bbox)를 가로챔.
  const poseGestureRef = useRef(null);

  const handleMouseDown = (e) => {
    if (item.annotation?.isReadOnly()) return;

    const vectorTool = getVectorTool();
    const hitStage = e.target === stageRef.current;
    const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

    // 이미 drawing 중인 세션만 툴로 직행
    if (vectorTool?.isDrawing) {
            vectorTool.event("mousedown", e.evt, [x, y]);
      return;
    }

    // keypoints resume: 기존 shape 히트일 때만 (빈 Stage는 bbox/click 제스처 유지)
    if (vectorTool?.canResumeDrawing && !hitStage) {
            vectorTool.event("mousedown", e.evt, [x, y]);
      return;
    }

    // VideoVectorTool만: 기존처럼 빈 Stage에서도 resume 허용
    if (vectorTool?.toolName === "VideoVectorTool" && vectorTool?.canResumeDrawing) {
            vectorTool.event("mousedown", e.evt, [x, y]);
      return;
    }

    if (!hitStage) return;

    const isInBounds = inBounds(x, y);

    if (!isInBounds) return;

    if (isVectorDrawingTool(vectorTool)) {
            poseGestureRef.current = { x, y, mode: "pending", tool: vectorTool, evt: e.evt };
            item.annotation.unselectAreas();
      setNewRegion({ x, y, width: 0, height: 0 });
      setDrawingMode(true);
      return;
    }

    if (vectorTool) {
      vectorTool.event("mousedown", e.evt, [x, y]);
      return;
    }

    item.annotation.unselectAreas();
    setNewRegion({ x, y, width: 0, height: 0 });
    setDrawingMode(true);
  };

  const handleMouseMove = (e) => {
    const vectorTool = getVectorTool();
    const gesture = poseGestureRef.current;

    if (vectorTool?.isDrawing && !gesture) {
      const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

      vectorTool.event("mousemove", e.evt, [x, y]);
      return;
    }

    if (!isDrawing || item.annotation?.isReadOnly()) return false;

    const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

    if (gesture?.mode === "pending") {
      const dx = Math.abs(x - gesture.x);
      const dy = Math.abs(y - gesture.y);
      if (dx >= MIN_SIZE || dy >= MIN_SIZE) {
        poseGestureRef.current = { ...gesture, mode: "bbox" };
                      }
    }

    setNewRegion((region) => ({
      ...region,
      width: x - region.x,
      height: y - region.y,
    }));
  };

  const handleMouseUp = (e) => {
    const vectorTool = getVectorTool();
    const gesture = poseGestureRef.current;

    // VideoVector와 동일: drawing 중이면 툴 mouseup (점 commit; finished=false면 연속 유지)
    if (vectorTool?.isDrawing && !gesture) {
      const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

      vectorTool.event("mouseup", e.evt, [x, y]);
      return;
    }

    if (!isDrawing || item.annotation?.isReadOnly()) return false;

    const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

    if (gesture && isVectorDrawingTool(gesture.tool)) {
      const dx = Math.abs(x - gesture.x);
      const dy = Math.abs(y - gesture.y);
      const isBbox = gesture.mode === "bbox" || dx >= MIN_SIZE || dy >= MIN_SIZE;

      poseGestureRef.current = null;

      if (isBbox) {
        if (dx < MIN_SIZE && dy < MIN_SIZE) {
          // React 17+Konva: newRegion을 먼저 비운 뒤 isDrawing=false (0×0 createResult→라벨 해제 방지)
          setNewRegion(null);
          setDrawingMode(false);
                  } else {
          setNewRegion((region) => ({ ...region, width: x - region.x, height: y - region.y }));
          setDrawingMode(false);
                  }
        return;
      }

      // 짧은 클릭 → VideoVector와 동일: 툴 mousedown+mouseup (KonvaVector 점·선)
      // newRegion을 먼저 null → 이후 isDrawing=false (React 17 비배치에서 0×0 bbox 생성 방지)
      setNewRegion(null);
      setDrawingMode(false);
      const tool = gesture.tool;
      tool.event("mousedown", gesture.evt || e.evt, [gesture.x, gesture.y]);
      tool.event("mouseup", e.evt, [x, y]);
      return;
    }

    if (Math.abs(newRegion.x - x) < MIN_SIZE && Math.abs(newRegion.y - y) < MIN_SIZE) {
      setNewRegion(null);
    } else {
      setNewRegion((region) => ({ ...region, width: x - region.x, height: y - region.y }));
    }
    setDrawingMode(false);
  };

  const handleClick = useCallback(
    (e) => {
      const vectorTool = getVectorTool();

      if (vectorTool) {
        const { x, y } = limitCoordinates(normalizeMouseOffsets(e.evt.offsetX, e.evt.offsetY));

        vectorTool.event("click", e.evt, [x, y]);
      }
    },
    [getVectorTool, limitCoordinates, normalizeMouseOffsets],
  );

  const initTransform = (tr) => {
    if (!tr) return;

    const stage = tr.getStage();
    // @todo not an obvious way to not render transformer for hidden regions
    // @todo could it be rewritten to usual react way?
    const shapes = selected.map((shape) => stage.findOne(`#${shape.id}`)).filter(Boolean);

    tr.nodes(shapes);
    tr.getLayer().batchDraw();
  };

  const eventHandlers = listenToEvents
    ? {
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onClick: handleClick,
      }
    : {};

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      style={{ position: "absolute", zIndex: 1 }}
      listening={listenToEvents}
      {...eventHandlers}
    >
      <Layer {...layerProps}>
        <RegionsLayer
          regions={regions}
          item={item}
          layerProps={layerProps}
          locked={locked}
          isDrawing={isDrawing}
          workinAreaCoordinates={workinAreaCoordinates}
          onDragMove={createOnDragMoveHandler(workinAreaCoordinates, !allowRegionsOutsideWorkingArea)}
          stageRef={stageRef}
        />
      </Layer>
      {!item.annotation?.isReadOnly() && isDrawing ? (
        <Layer {...layerProps}>
          <SelectionRect {...newRegion} />
        </Layer>
      ) : null}
      {!item.annotation?.isReadOnly() && selected?.length > 0 ? (
        <Layer>
          <Transformer
            ref={initTransform}
            keepRatio={false}
            ignoreStroke
            flipEnabled={false}
            boundBoxFunc={createBoundingBoxGetter(workinAreaCoordinates, !allowRegionsOutsideWorkingArea)}
            onDragMove={createOnDragMoveHandler(workinAreaCoordinates, !allowRegionsOutsideWorkingArea)}
          />
        </Layer>
      ) : null}
    </Stage>
  );
};

const RegionsLayer = observer(({ regions, item, locked, isDrawing, workinAreaCoordinates, stageRef, onDragMove }) => {
  return (
    <>
      {regions.map((reg) => {
        if (!reg || !isAlive(reg)) return null;
        return (
          <Shape
            id={reg.id}
            key={reg.id}
            reg={reg}
            frame={item.frame}
            workingArea={workinAreaCoordinates}
            draggable={!reg.isReadOnly() && !isDrawing && !locked}
            selected={reg.selected || reg.inSelection}
            listening={!reg.locked && !reg.hidden}
            stageRef={stageRef}
            onDragMove={onDragMove}
          />
        );
      })}
    </>
  );
});

const Shape = observer(({ reg, frame, stageRef, ...props }) => {
  if (!reg || !isAlive(reg)) return null;

  const box = reg.getShape(frame);

  if (!reg.isInLifespan(frame) || !box) return null;

  const handleClick = (e) => {
    if (!isAlive(reg)) return;
    const annotation = getParentOfType(reg, Annotation);

    if (annotation && annotation.isLinkingMode) {
      stageRef.current.container().style.cursor = Constants.DEFAULT_CURSOR;
    }

    try {
      reg.setHighlight(false);
      reg.onClickRegion(e);
    } catch (err) {
      /* detached */
    }
  };

  if (reg.type === "videoposeregion") {
    const hasBbox =
      box &&
      box.width != null &&
      box.height != null &&
      Number(box.width) > 0 &&
      Number(box.height) > 0;
    // bbox+vertices: Rectangle이 라벨 담당, VectorShape는 점·선만 (이중 LabelOnVideoBbox 방지)
    return (
      <Group>
        {hasBbox ? <Rectangle reg={reg} box={box} frame={frame} onClick={handleClick} {...props} /> : null}
        <VideoVectorShape
          reg={reg}
          box={box}
          frame={frame}
          onClick={handleClick}
          showLabel={!hasBbox}
          {...props}
        />
      </Group>
    );
  }

  if (reg.type === "videovectorregion") {
    return <VideoVectorShape reg={reg} box={box} frame={frame} onClick={handleClick} {...props} />;
  }

  return <Rectangle reg={reg} box={box} frame={frame} onClick={handleClick} {...props} />;
});

export const VideoRegions = observer(VideoRegionsPure);
