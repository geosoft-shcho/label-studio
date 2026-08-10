import { observer } from "mobx-react";
import type { FC } from "react";
import { Block, Elem } from "../../../utils/bem";
import "./VideoRegionSequenceInfo.scss";

function isVideoSequenceRegion(region: any): boolean {
  const type = String(region?.type || "");
  return type.includes("video") && Array.isArray(region?.sequence);
}

function currentVideoFrame(region: any): number | null {
  try {
    if (typeof region?.frame === "number") return region.frame;
    const video = region?.object || region?.parent;
    if (video && typeof video.frame === "number") return video.frame;
  } catch {
    /* noop */
  }
  return null;
}

function framerateOf(region: any): number {
  try {
    const video = region?.object || region?.parent;
    const fps = Number(video?.framerate);
    return Number.isFinite(fps) && fps > 0 ? fps : 0;
  } catch {
    return 0;
  }
}

function frameToSec(frame: unknown, framerate: number): number | null {
  const f = Number(frame);
  if (!Number.isFinite(f) || !(framerate > 0)) return null;
  return f / framerate;
}

function fmtNum(v: unknown, digits = 1): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

function fmtSec(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

/** Video region Details: 현재 frame exact-match sequence만 표시 (Flutter 패널과 동일 규칙). */
export const VideoRegionSequenceInfo: FC<{ region: any }> = observer(({ region }) => {
  if (!isVideoSequenceRegion(region)) return null;

  const seq = region.sequence || [];
  const frame = currentVideoFrame(region);
  const framerate = framerateOf(region);
  const startFrame = seq.length ? seq[0]?.frame : null;
  const endFrame = seq.length ? seq[seq.length - 1]?.frame : null;
  const matched =
    frame == null
      ? []
      : seq.filter((kp: any) => kp && Number(kp.frame) === Number(frame));

  return (
    <Block name="video-seq-info">
      <Elem name="row">
        Frame {frame ?? "—"} · fps {framerate || "—"} · sequence {seq.length}
      </Elem>
      <Elem name="row">
        Range f {fmtNum(startFrame, 0)}–{fmtNum(endFrame, 0)}
        {framerate > 0
          ? ` · ${fmtSec(frameToSec(startFrame, framerate))}s–${fmtSec(frameToSec(endFrame, framerate))}s`
          : ""}
      </Elem>
      <Elem name="heading">Sequence @ frame {frame ?? "—"}</Elem>
      {matched.length === 0 ? (
        <Elem name="empty">No sequence at this frame</Elem>
      ) : (
        <Elem name="list">
          {matched.map((kp: any, i: number) => {
            const time = kp.time != null ? Number(kp.time) : frameToSec(kp.frame, framerate);
            const parts = [
              `f=${fmtNum(kp.frame, 0)}`,
              `t=${fmtSec(time)}`,
              kp.enabled != null ? `en=${kp.enabled}` : null,
              kp.x != null ? `x=${fmtNum(kp.x)}` : null,
              kp.y != null ? `y=${fmtNum(kp.y)}` : null,
              kp.width != null ? `w=${fmtNum(kp.width)}` : null,
              kp.height != null ? `h=${fmtNum(kp.height)}` : null,
              Array.isArray(kp.keypoints) ? `kps=${kp.keypoints.length}` : null,
              Array.isArray(kp.pose) ? `pose=${kp.pose.length}` : null,
            ].filter(Boolean);
            return (
              <Elem name="item" key={`${kp.frame}-${i}`}>
                {parts.join(" · ")}
              </Elem>
            );
          })}
        </Elem>
      )}
    </Block>
  );
});

export { isVideoSequenceRegion };
