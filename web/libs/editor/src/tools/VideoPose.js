import { isAlive, types } from "mobx-state-tree";

import BaseTool, { DEFAULT_DIMENSIONS } from "./Base";

/** Max time (ms) between two clicks to treat as double-click */
const DOUBLE_CLICK_MAX_MS = 300;
/** Max pixel distance between two clicks to treat as same position (double-click) */
const DOUBLE_CLICK_MAX_PIXEL_DIST = 5;
import ToolMixin from "../mixins/Tool";
import { MultipleClicksDrawingTool } from "../mixins/DrawingTool";
import { NodeViews } from "../components/Node/Node";
import { observe } from "mobx";
import { faivvVideoManualDebug, summarizePoseShape } from "../tags/object/Video/faivvVideoManualDebug";

/**
 * VideoPose drawing tool — VideoVectorTool과 동일한 점/선(skeleton) 클릭 UX.
 * bbox 드래그만 VideoRegions 제스처에서 분리 처리한다.
 */
const _Tool = types
  .model("VideoPoseTool", {
    group: "segmentation",
    shortcut: "tool:videopose",
  })
  .views((self) => ({
    get tagTypes() {
      return {
        stateTypes: "videoposelabels",
        controlTagTypes: ["videoposelabels", "videopose"],
      };
    },

    get viewTooltip() {
      return "Video pose region (bbox + skeleton)";
    },

    get iconComponent() {
      return (
        NodeViews.VideoPoseRegionModel?.icon ??
        NodeViews.VideoVectorRegionModel?.icon ??
        NodeViews.VectorRegionModel?.icon
      );
    },

    get defaultDimensions() {
      return DEFAULT_DIMENSIONS.vector;
    },

    isIncorrectLabel() {
      const states = self.obj?.activeStates?.();
      return states && states.length === 0 && self.obj.hasStates;
    },

    canStart() {
      return !self.isDrawing && !self.annotation?.isReadOnly();
    },

    get canResumeDrawing() {
      if (self.isDrawing) return false;
      const obj = self.obj;
      const frame = obj?.currentFrame ?? obj?.frame;

      return !!obj?.regs?.find((reg) => {
        if (reg.type !== "videoposeregion" || !reg.selected || !isAlive(reg)) return false;
        const shape = reg.getShape?.(frame);
        // VideoVector와 동일: 미닫힘 + vertices 있으면 이어 그리기
        return shape && !shape.closed && (shape.vertices?.length ?? 0) > 0;
      });
    },

    getActiveVector() {
      const area = self.currentArea;

      if (area && !isAlive(area)) return null;
      if (area === undefined) return null;
      if (area && area.type !== "videoposeregion") return null;

      return area;
    },

    getCurrentArea() {
      return self.currentArea;
    },

    current() {
      if (self.currentArea) {
        return self.getActiveVector();
      }

      const obj = self.obj;

      if (obj?.regs) {
        const activeDrawing = obj.regs.find(
          (reg) => reg.type === "videoposeregion" && reg.isDrawing && isAlive(reg),
        );

        if (activeDrawing) return activeDrawing;
      }

      return self.getActiveVector();
    },
  }))
  .actions((self) => {
    let down = false;
    let initialCursorPosition = null;
    const disposers = [];
    let lastClick = { ts: 0, x: 0, y: 0 };

    return {
      // VideoVector와 동일: [x,y] + shift 필터 없음
      event(name, ev, args) {
        if (ev.button > 0) return;
        let fn = `${name}Ev`;

        if (typeof self[fn] !== "undefined") self[fn].call(self, ev, args);

        if (name === "click") {
          const ts = ev.timeStamp;

          if (
            ts - lastClick.ts < DOUBLE_CLICK_MAX_MS &&
            Math.abs(lastClick.x - args[0]) < DOUBLE_CLICK_MAX_PIXEL_DIST &&
            Math.abs(lastClick.y - args[1]) < DOUBLE_CLICK_MAX_PIXEL_DIST
          ) {
            fn = `dbl${fn}`;
            if (typeof self[fn] !== "undefined") self[fn].call(self, ev, args);
          }
          lastClick = { ts, x: args[0], y: args[1] };
        }
      },

      canStartDrawing() {
        return (
          !self.disabled &&
          !self.isIncorrectControl() &&
          !self.isIncorrectLabel() &&
          self.canStart() &&
          !self.annotation?.isDrawing
        );
      },

      handleToolSwitch() {
        self.stopListening();
        if (self.currentArea?.isDrawing) {
          if (self.currentArea?.incomplete) self.deleteRegion();
          else self._finishDrawing();
        }
      },

      listenForClose() {
        const { currentArea } = self;

        if (!currentArea) return;

        disposers.push(
          observe(
            currentArea,
            "sequence",
            () => {
              const shape = self.currentArea?.getShape(self.obj.frame);

              if (shape?.closed) self._finishDrawing();
            },
            false,
          ),
        );

        disposers.push(
          observe(
            currentArea,
            "finished",
            () => {
              if (self.currentArea?.finished) self.finishDrawing();
            },
            false,
          ),
        );
      },

      closeCurrent() {},

      stopListening() {
        for (const disposer of disposers) {
          disposer();
        }
        disposers.length = 0;
      },

      startDrawing(x, y) {
        if (!self.canStartDrawing()) {
          const ctrl = self.control;
          const states = self.obj?.activeStates?.() || [];
          faivvVideoManualDebug("tool.startDrawing.blocked", {
            disabled: !!self.disabled,
            incorrectControl: !!self.isIncorrectControl?.(),
            incorrectLabel: !!self.isIncorrectLabel?.(),
            canStart: !!self.canStart?.(),
            annotationIsDrawing: !!self.annotation?.isDrawing,
            controlType: ctrl?.type,
            controlSelected: !!ctrl?.isSelected,
            stateTypes: self.tagTypes?.stateTypes,
            activeLabelCount: states.length,
            activeLabels: states.flatMap((t) => {
              try {
                return t.selectedValues?.() || [];
              } catch {
                return [];
              }
            }),
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
          });
          return;
        }

        const videoObj = self.obj;

        initialCursorPosition = { x, y };

        let area = self.current();
        const created = !area;

        if (!area) {
          area = videoObj.addVideoPoseRegion({
            vertices: [],
            closed: false,
          });

          if (!area) {
            faivvVideoManualDebug("tool.startDrawing.no_region", {
              hasPoseControl: !!videoObj?.videoPoseControl,
            });
            return;
          }

          self.currentArea = area;

          const activeStates = videoObj.activeStates();

          for (const tag of activeStates || []) {
            area.setValue(tag);
          }
        } else {
          self.currentArea = area;
        }

        self.mode = "drawing";
        area.setDrawing(true);
        self.annotation?.setIsDrawing(true);
        self.annotation?.history?.freeze();

        self.listenForClose();

        faivvVideoManualDebug("tool.startDrawing", {
          created,
          regionId: area.id,
          frame: videoObj?.frame,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          labels: (videoObj?.activeStates?.() || []).flatMap((t) => {
            try {
              return t.selectedValues?.() || [];
            } catch {
              return [];
            }
          }),
          hasVectorRef: !!area.vectorRef,
          seq0Verts: area.sequence?.[0]?.vertices?.length ?? 0,
        });

        // VideoVector와 동일: empty면 startPoint를 다음 tick에 (VideoVectorShape mount 대기)
        if (!area || (area.sequence?.[0]?.vertices?.length ?? 0) === 0) {
          setTimeout(() => {
            const a = self.currentArea;
            faivvVideoManualDebug("tool.startPoint.deferred", {
              regionId: a?.id,
              hasVectorRef: !!a?.vectorRef,
              x: Math.round(x * 10) / 10,
              y: Math.round(y * 10) / 10,
            });
            a?.startPoint(x, y);
          });
        }
      },

      mousedownEv(ev, [x, y]) {
        if (self.mode === "drawing") {
          self.annotation?.history?.freeze();
          down = true;
          initialCursorPosition = { x, y };
          return;
        }

        const obj = self.obj;
        const frame = obj?.currentFrame;
        const selectedUnclosed = obj?.regs?.find((reg) => {
          if (reg.type !== "videoposeregion" || !reg.selected || !isAlive(reg)) return false;
          const shape = reg.getShape(frame);
          return shape && !shape.closed && (shape.vertices?.length ?? 0) > 0;
        });

        if (selectedUnclosed) {
          self.currentArea = selectedUnclosed;
          self.mode = "drawing";
          selectedUnclosed.setDrawing(true);
          self.annotation?.setIsDrawing(true);
          self.listenForClose();
          self.annotation?.history?.freeze();
          down = true;
          initialCursorPosition = { x, y };
          return;
        }

        self.annotation?.unselectAreas?.();
        down = true;
        self.startDrawing(x, y);
      },

      mousemoveEv() {},

      mouseupEv(_, [x, y]) {
        if (!self.isDrawing) return;
        if (!down) return;
        down = false;

        if (initialCursorPosition) {
          const dx = Math.abs(x - initialCursorPosition.x);
          const dy = Math.abs(y - initialCursorPosition.y);

          if (dx < 5 && dy < 5) {
            // VideoVector와 동일: KonvaVector start/commit 후 finishDrawing
            // (finished=false 이면 drawing 유지 → 연속 점·선)
            setTimeout(() => {
              const area = self.currentArea;
              const before = summarizePoseShape(area?.getShape?.(self.obj?.frame));
              faivvVideoManualDebug("tool.mouseup.commit", {
                regionId: area?.id,
                hasVectorRef: !!area?.vectorRef,
                x: Math.round(x * 10) / 10,
                y: Math.round(y * 10) / 10,
                before,
                finished: !!area?.finished,
                isDrawing: !!self.isDrawing,
              });
              area?.startPoint(x, y);
              area?.commitPoint(x, y);
              const after = summarizePoseShape(area?.getShape?.(self.obj?.frame));
              faivvVideoManualDebug("tool.mouseup.afterCommit", {
                regionId: area?.id,
                after,
                finished: !!area?.finished,
              });
              self.annotation?.history?.unfreeze();
              self.finishDrawing();
              faivvVideoManualDebug("tool.mouseup.finishDrawing", {
                stillDrawing: !!self.isDrawing,
                currentAreaId: self.currentArea?.id ?? null,
              });
            });
          }
        }
      },

      clickEv() {},

      dblclickEv() {
        if (self.isDrawing) {
          self._finishDrawing();
        }
      },

      finishDrawing() {
        // VideoVector: finished일 때만 종료. closable=false면 점만으로 finished=false → 연속 클릭 유지
        if (self.currentArea?.finished) {
          self._finishDrawing();
        }
      },

      _finishDrawing({ skipAfterCreate = false } = {}) {
        if (!self.currentArea) return;
        self.currentArea.setDrawing(false);
        self.currentArea.notifyDrawingFinished?.();
        self.annotation?.setIsDrawing(false);
        self.annotation?.history?.unfreeze();

        const { currentArea, control } = self;

        self.currentArea = null;
        self.mode = "viewing";
        down = false;
        self.stopListening();

        if (!skipAfterCreate && currentArea && !currentArea.incomplete) {
          self.annotation?.afterCreateResult?.(currentArea, control);
        }
      },

      complete() {
        self._finishDrawing({ skipAfterCreate: true });
        self.annotation?.unselectAll();
      },

      cleanupUncloseableShape() {
        if (self.currentArea?.incomplete) {
          self.deleteRegion();
        }
      },

      deleteRegion() {
        const { currentArea } = self;

        self.currentArea = null;
        self.mode = "viewing";
        down = false;
        self.stopListening();
        self.annotation?.setIsDrawing(false);
        self.annotation?.history?.unfreeze();

        if (currentArea && isAlive(currentArea)) {
          currentArea.setDrawing(false);
          currentArea.deleteRegion();
        }
      },
    };
  });

const VideoPose = types.compose(_Tool.name, ToolMixin, BaseTool, MultipleClicksDrawingTool, _Tool);

export { VideoPose };
