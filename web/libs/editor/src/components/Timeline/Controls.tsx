import { type FC, memo, type MouseEvent, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  IconBackward,
  IconChevronLeft,
  IconChevronRight,
  IconCollapse,
  IconExpand,
  IconFastForward,
  IconForward,
  IconFullscreen,
  IconFullscreenExit,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRewind,
} from "../../assets/icons/timeline";
import { Button, type ButtonProps } from "../../common/Button/Button";
import { Space } from "../../common/Space/Space";
import { Block, Elem } from "../../utils/bem";
import { isDefined } from "../../utils/utilities";
import { TimelineContext } from "./Context";
import "./Controls.scss";
import * as SideControls from "./SideControls";
import type {
  TimelineControlsProps,
  TimelineControlsStepHandler,
  TimelineCustomControls,
  TimelineStepFunction,
} from "./Types";
import { FF_DEV_2715, isFF } from "../../utils/feature-flags";
import { AudioControl } from "./Controls/AudioControl";
import { ConfigControl } from "./Controls/ConfigControl";
import { TimeDurationControl } from "../TimeDurationControl/TimeDurationControl";

export const Controls: FC<TimelineControlsProps> = memo(
  ({
    length = 1000,
    position,
    frameRate = 1024,
    playing,
    collapsed,
    duration,
    extraControls,
    fullscreen,
    altHopSize,
    disableFrames,
    allowFullscreen,
    allowViewCollapse,
    onRewind,
    onForward,
    onPlay,
    onPause,
    onFullScreenToggle,
    onStepBackward,
    onPositionChange,
    onStepForward,
    onSpeedChange,
    onToggleCollapsed,
    toggleVisibility,
    layerVisibility,
    mediaType,
    ...props
  }) => {
    const { settings } = useContext(TimelineContext);
    const [altControlsMode, setAltControlsMode] = useState(false);
    const [configModal, setConfigModal] = useState(false);
    const [audioModal, setAudioModal] = useState(false);
    const [startReached, endReached] = [position === 1, position === length];

    const durationFormatted = useMemo(() => {
      return Math.max((length - 1) / frameRate, 0);
    }, [length, frameRate]);

    const currentTime = useMemo(() => {
      return (position - 1) / frameRate;
    }, [position, frameRate]);

    const customControls = useCustomControls(props.customControls);
    const stepHandlerWrapper =
      (handler: TimelineControlsStepHandler, stepSize?: TimelineStepFunction) => (e: MouseEvent<HTMLButtonElement>) => {
        handler(e, stepSize ?? undefined);
      };

    const handlePlay = useCallback(() => {
      playing ? onPause?.() : onPlay?.();
    }, [playing, onPlay, onPause]);

    const onSetVolumeModal = (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (configModal) setConfigModal(false);

      setAudioModal(!audioModal);
    };

    const onSetConfigModal = (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();

      if (audioModal) setAudioModal(false);

      setConfigModal(!configModal);
    };

    const renderControls = () => {
      return (
        <Elem name="group" tag={Space} size="small" style={{ gridAutoColumns: "auto" }}>
          <ConfigControl
            onSetModal={onSetConfigModal}
            onAmpChange={props.onAmpChange}
            configModal={configModal}
            onSpeedChange={(speed: number) => onSpeedChange?.(speed)}
            speed={props.speed || 0}
            amp={props.amp || 0}
            toggleVisibility={toggleVisibility}
            layerVisibility={layerVisibility}
          />
          <AudioControl
            volume={props.volume || 0}
            onVolumeChange={props.onVolumeChange}
            onSetModal={onSetVolumeModal}
            audioModal={audioModal}
          />
        </Elem>
      );
    };

    const closeModalHandler = () => {
      setConfigModal(false);
      setAudioModal(false);
    };

    useEffect(() => {
      const keyboardHandler = (e: KeyboardEvent) => {
        if (!settings?.stepSize) return;
        const altMode = e.key === "Shift";

        if (e.type === "keydown" && altMode && !altControlsMode) {
          setAltControlsMode(true);
        } else if (e.type === "keyup" && altMode && altControlsMode) {
          setAltControlsMode(false);
        }
      };

      document.addEventListener("keydown", keyboardHandler);
      document.addEventListener("keyup", keyboardHandler);
      document.addEventListener("click", closeModalHandler);

      return () => {
        document.removeEventListener("keydown", keyboardHandler);
        document.removeEventListener("keyup", keyboardHandler);
        document.removeEventListener("click", closeModalHandler);
      };
    }, [altControlsMode]);

    /** Audio: `position` is seconds. */
    const onTimeUpdateChange = (value: number) => {
      onPositionChange(value);
    };

    /** Video/timeline: convert seconds → 1-based frame. */
    const onTimelineTimeUpdateChange = (value: number) => {
      const next = Math.round(value * frameRate) + 1;
      onPositionChange(Math.max(1, Math.min(length, next)));
    };

    return (
      <Block name="timeline-controls" tag={Space} spread style={{ gridAutoColumns: "auto" }}>
        {isFF(FF_DEV_2715) && mediaType === "audio" ? (
          renderControls()
        ) : (
          <Elem name="group" tag={Space} size="small" style={{ gridAutoColumns: "auto" }}>
            {props.controls &&
              Object.entries(props.controls).map(([name, enabled]) => {
                if (enabled === false) return;

                const Component = SideControls[name as keyof typeof SideControls];

                return (
                  isDefined(Component) && (
                    <Component
                      key={name}
                      length={length}
                      position={position - 1}
                      volume={props.volume}
                      onPositionChange={onPositionChange}
                      onVolumeChange={props.onVolumeChange}
                    />
                  )
                );
              })}
            {customControls?.left}
          </Elem>
        )}
        <Elem name="main-controls">
          <Elem name="group" tag={Space} collapsed>
            {extraControls}
          </Elem>
          <Elem name="group" tag={Space} collapsed>
            {customControls?.leftCenter}
            <AltControls
              showAlterantive={altControlsMode && !disableFrames}
              main={
                <>
                  {settings?.stepSize && !disableFrames && (
                    <ControlButton
                      onClick={stepHandlerWrapper(onStepBackward, settings.stepSize)}
                      hotkey={settings?.stepAltBack}
                      disabled={startReached}
                    >
                      {<IconPrev />}
                    </ControlButton>
                  )}
                  <ControlButton
                    onClick={stepHandlerWrapper(onStepBackward)}
                    hotkey={settings?.stepBackHotkey}
                    disabled={startReached}
                  >
                    <IconChevronLeft />
                  </ControlButton>
                </>
              }
              alt={
                <>
                  <ControlButton
                    onClick={() => onRewind?.()}
                    disabled={startReached}
                    hotkey={settings?.skipToBeginning}
                  >
                    <IconRewind />
                  </ControlButton>
                  <ControlButton
                    onClick={() => onRewind?.(altHopSize)}
                    disabled={startReached}
                    hotkey={settings?.hopBackward}
                  >
                    <IconBackward />
                  </ControlButton>
                </>
              }
            />
            <ControlButton
              data-testid={`playback-button:${playing ? "pause" : "play"}`}
              onClick={handlePlay}
              hotkey={settings?.playpauseHotkey}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </ControlButton>
            <AltControls
              showAlterantive={altControlsMode && !disableFrames}
              main={
                <>
                  <ControlButton
                    onClick={stepHandlerWrapper(onStepForward)}
                    hotkey={settings?.stepForwardHotkey}
                    disabled={endReached}
                  >
                    <IconChevronRight />
                    {}
                  </ControlButton>
                  {settings?.stepSize && !disableFrames && (
                    <ControlButton
                      disabled={endReached}
                      onClick={stepHandlerWrapper(onStepForward, settings.stepSize)}
                      hotkey={settings?.stepAltForward}
                    >
                      <IconNext />
                    </ControlButton>
                  )}
                </>
              }
              alt={
                <>
                  <ControlButton
                    onClick={() => onForward?.(altHopSize)}
                    disabled={endReached}
                    hotkey={settings?.hopForward}
                  >
                    <IconForward />
                  </ControlButton>
                  <ControlButton onClick={() => onForward?.()} disabled={endReached} hotkey={settings?.skipToEnd}>
                    <IconFastForward />
                  </ControlButton>
                </>
              }
            />
            {customControls?.rightCenter}
          </Elem>
          <Elem name="group" tag={Space} collapsed>
            {!disableFrames && allowViewCollapse && (
              <ControlButton tooltip="Toggle Timeline" onClick={() => onToggleCollapsed?.(!collapsed)}>
                {collapsed ? <IconExpand /> : <IconCollapse />}
              </ControlButton>
            )}
            {allowFullscreen && (
              <ControlButton tooltip="Fullscreen" onClick={() => onFullScreenToggle?.(false)}>
                {fullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
              </ControlButton>
            )}
          </Elem>
        </Elem>

        <Elem name="group" tag={Space} size="small">
          {isFF(FF_DEV_2715) && mediaType === "audio" ? (
            <>
              {customControls?.right}
              <TimeDurationControl
                startTime={0}
                endTime={duration}
                minTime={0}
                maxTime={duration}
                startTimeReadonly={false}
                endTimeReadonly={true}
                currentTime={position}
                onChangeStartTime={onTimeUpdateChange}
              />
            </>
          ) : (
            <>
              {customControls?.right}
              {/* Video/timeline: current time editable (seek); duration readonly. */}
              <TimeDurationControl
                startTime={0}
                endTime={durationFormatted}
                minTime={0}
                maxTime={durationFormatted}
                startTimeReadonly={false}
                endTimeReadonly={true}
                currentTime={currentTime}
                onChangeStartTime={onTimelineTimeUpdateChange}
              />
            </>
          )}
        </Elem>
      </Block>
    );
  },
);

export const ControlButton: FC<ButtonProps & { disabled?: boolean }> = ({ children, ...props }) => {
  return (
    <Button {...props} type="text" style={{ width: 36, height: 36, padding: 0 }}>
      {children}
    </Button>
  );
};

type AltControlsProps = {
  showAlterantive: boolean;
  main: JSX.Element;
  alt: JSX.Element;
  hidden?: boolean;
};

const AltControls: FC<AltControlsProps> = (props) => {
  if (props.hidden) return null;
  return props.showAlterantive ? props.alt : props.main;
};

type ControlGroups = Record<TimelineCustomControls["position"], JSX.Element[]>;

const useCustomControls = (customControls?: TimelineCustomControls[]): ControlGroups | null => {
  if (!customControls) return null;

  const groups = customControls?.reduce<ControlGroups>((groups, item) => {
    const group = groups[item.position] ?? [];
    const component = item.component instanceof Function ? item.component() : item.component;

    group.push(component);
    groups[item.position] = group;

    return groups;
  }, {} as ControlGroups);

  return groups;
};
