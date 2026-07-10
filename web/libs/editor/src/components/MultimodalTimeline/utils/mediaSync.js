/**
 * AudioUltra + Video sync — playhead/duration for MultimodalTimeline.
 * Video sync="audio" 환경에서 DOM <audio> currentTime이 0에 고정될 수 있어
 * LSF 태그·waveform·video ref·DOM 요소 중 유효한 최대 시각을 사용한다.
 */

function pushFinite(times, value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    times.push(value);
  }
}

function readTagTimeSec(mediaTag) {
  if (!mediaTag) return null;
  const times = [];

  pushFinite(times, mediaTag.currentTime);

  try {
    if (typeof mediaTag.getCurrentTime === "function") {
      pushFinite(times, mediaTag.getCurrentTime());
    }
  } catch (e) {
    /* noop */
  }

  try {
    const ws = mediaTag._ws;
    if (ws) pushFinite(times, ws.currentTime);
  } catch (e) {
    /* noop */
  }

  try {
    const ref = mediaTag.ref && (mediaTag.ref.current || mediaTag.ref);
    if (ref) {
      pushFinite(times, ref.currentTime);
      if (ref.wavesurfer && typeof ref.wavesurfer.getCurrentTime === "function") {
        pushFinite(times, ref.wavesurfer.getCurrentTime());
      }
    }
  } catch (e) {
    /* noop */
  }

  try {
    if (mediaTag.frame && mediaTag.framerate) {
      const fps = Number(mediaTag.framerate) || 24;
      if (fps > 0) pushFinite(times, mediaTag.frame / fps);
    }
  } catch (e) {
    /* noop */
  }

  if (!times.length) return null;
  return Math.max(...times);
}

function readTagDurationSec(mediaTag) {
  if (!mediaTag) return null;
  const durations = [];

  try {
    const ws = mediaTag._ws;
    if (ws?.duration) pushFinite(durations, ws.duration);
  } catch (e) {
    /* noop */
  }

  try {
    const ref = mediaTag.ref && (mediaTag.ref.current || mediaTag.ref);
    if (ref?.duration) pushFinite(durations, ref.duration);
  } catch (e) {
    /* noop */
  }

  try {
    if (mediaTag.length && mediaTag.framerate) {
      const fps = Number(mediaTag.framerate) || 24;
      if (fps > 0) pushFinite(durations, mediaTag.length / fps);
    }
  } catch (e) {
    /* noop */
  }

  if (!durations.length) return null;
  return Math.max(...durations);
}

function findDomVideoElement() {
  if (typeof document === "undefined") return null;
  const main = document.querySelector("#label-studio .lsf-video__main");
  if (main) {
    const v = main.querySelector("video");
    if (v) return v;
  }
  return document.querySelector("#label-studio video");
}

function findDomAudioElement() {
  if (typeof document === "undefined") return null;
  return document.querySelector("#label-studio audio");
}

export function readPlayheadSec(audioObject, videoObject) {
  const times = [];
  pushFinite(times, readTagTimeSec(audioObject));
  pushFinite(times, readTagTimeSec(videoObject));

  const audioEl = findDomAudioElement();
  const videoEl = findDomVideoElement();
  pushFinite(times, audioEl?.currentTime);
  pushFinite(times, videoEl?.currentTime);

  if (!times.length) return 0;
  return Math.max(...times);
}

export function readDurationSec(audioObject, videoObject) {
  const durations = [];
  pushFinite(durations, readTagDurationSec(audioObject));
  pushFinite(durations, readTagDurationSec(videoObject));

  const audioEl = findDomAudioElement();
  const videoEl = findDomVideoElement();
  pushFinite(durations, audioEl?.duration);
  pushFinite(durations, videoEl?.duration);

  if (!durations.length) return 0;
  return Math.max(...durations);
}

function isMediaPlaying(audioObject, videoObject) {
  try {
    if (audioObject?._ws?.playing) return true;
  } catch (e) {
    /* noop */
  }
  try {
    if (videoObject?.ref?.current?.playing) return true;
  } catch (e) {
    /* noop */
  }
  const videoEl = findDomVideoElement();
  if (videoEl && !videoEl.paused && !videoEl.ended) return true;
  const audioEl = findDomAudioElement();
  if (audioEl && !audioEl.paused && !audioEl.ended) return true;
  return false;
}

/**
 * @param {{ audioObject?: object, videoObject?: object, onTime: (sec: number) => void, onDuration?: (sec: number) => void }} opts
 * @returns {() => void} cleanup
 */
export function subscribeMediaPlayhead({ audioObject, videoObject, onTime, onDuration }) {
  const cleanups = [];
  let rafId = null;

  const emit = () => {
    onTime(readPlayheadSec(audioObject, videoObject));
    if (onDuration) onDuration(readDurationSec(audioObject, videoObject));
  };

  const stopRaf = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const startRaf = () => {
    if (rafId != null) return;
    const tick = () => {
      emit();
      if (isMediaPlaying(audioObject, videoObject)) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  };

  const onPlayingEvent = (time) => {
    if (typeof time === "number" && Number.isFinite(time)) {
      onTime(time);
    } else {
      emit();
    }
    startRaf();
  };

  const onSeekEvent = onPlayingEvent;

  const onPauseEvent = () => {
    stopRaf();
    emit();
  };

  const ws = audioObject?._ws;
  if (ws && typeof ws.on === "function") {
    ws.on("playing", onPlayingEvent);
    ws.on("seek", onSeekEvent);
    ws.on("play", startRaf);
    ws.on("pause", onPauseEvent);
    ws.on("load", emit);
    ws.on("durationChanged", emit);

    cleanups.push(() => {
      if (typeof ws.off !== "function") return;
      ws.off("playing", onPlayingEvent);
      ws.off("seek", onSeekEvent);
      ws.off("play", startRaf);
      ws.off("pause", onPauseEvent);
      ws.off("load", emit);
      ws.off("durationChanged", emit);
    });
  }

  const bindDomMedia = (el) => {
    if (!el) return;
    const onTimeUpdate = () => {
      emit();
      if (!el.paused && !el.ended) startRaf();
    };
    const onPlay = () => {
      emit();
      startRaf();
    };
    const onPause = onPauseEvent;
    const onMeta = () => {
      emit();
      if (onDuration) onDuration(readDurationSec(audioObject, videoObject));
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeked", onTimeUpdate);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onMeta);

    cleanups.push(() => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeked", onTimeUpdate);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
    });
  };

  bindDomMedia(findDomVideoElement());
  bindDomMedia(findDomAudioElement());

  // waveform / video ref 준비 지연 대비
  let retryCount = 0;
  const retryTimer = window.setInterval(() => {
    emit();
    if (audioObject?._ws || videoObject?.ref?.current || retryCount++ > 40) {
      window.clearInterval(retryTimer);
    }
  }, 250);
  cleanups.push(() => window.clearInterval(retryTimer));

  emit();
  if (isMediaPlaying(audioObject, videoObject)) startRaf();

  return () => {
    cleanups.forEach((fn) => fn());
    stopRaf();
  };
}
