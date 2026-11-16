import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";
import {
  chooseRulerStep,
  clipLabel,
  formatTick,
  formatTime,
  isObjectActiveAt,
  timelineDuration,
} from "../lib/video";
import {
  TIMELINE_SNAP_PX,
  snapMove,
  snapValue,
  timelineSnapTargets,
} from "../lib/timeline";
import type { EditorObject, MusicTrack } from "../types";

type TimelineInteraction =
  | { kind: "scrub" }
  | {
      kind: "moveTime" | "trimL" | "trimR";
      id: string;
      startX: number;
      width: number;
      origStart: number;
      origEnd: number;
      viewDuration: number;
    }
  | {
      kind: "musicMove" | "musicTrimL" | "musicTrimR";
      startX: number;
      width: number;
      origStart: number;
      origEnd: number;
      origAudioStart: number;
      viewDuration: number;
    };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// The furthest timeline position the music can reach without running past the
// end of the audio file.
function musicMaxEnd(music: MusicTrack, audioStart: number): number {
  if (!isFinite(music.duration) || music.duration <= 0) return Infinity;
  return music.start + (music.duration - audioStart);
}

export function Timeline() {
  const {
    state,
    dispatch,
    commit,
    seekTo,
    getPlayhead,
    togglePlay,
    toggleMute,
    addMusicDialog,
    removeMusic,
  } = useEditor();

  const visible = state.started && state.mediaType === "video";
  // The timeline is as long as the video *or* the music, whichever ends later.
  const effectiveDuration = timelineDuration(state.video.duration, state.music);
  // Freeze the scale while a clip is being dragged. Otherwise trimming the
  // music shorter would shrink the timeline mid-gesture and the clip would move
  // away from the pointer.
  const [frozenDuration, setFrozenDuration] = useState<number | null>(null);
  const duration = frozenDuration ?? effectiveDuration;
  const interactionRef = useRef<TimelineInteraction | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const [snapTime, setSnapTime] = useState<number | null>(null);

  const ticks = useMemo(() => {
    if (duration <= 0) return [] as { t: number; label: string }[];
    const step = chooseRulerStep(duration);
    const out: { t: number; label: string }[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step) {
      out.push({ t, label: t > 1e-6 ? formatTick(t) : "" });
    }
    return out;
  }, [duration]);

  // Position the playhead against the lane track on every render (cheap layout
  // read) so it stays in sync during playback without extra state.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const lanes = lanesRef.current;
    const ph = playheadRef.current;
    if (!body || !lanes || !ph) return;
    const b = body.getBoundingClientRect();
    const l = lanes.getBoundingClientRect();
    const offset = l.left - b.left;
    const pct = duration > 0 ? clamp(getPlayhead() / duration, 0, 1) : 0;
    ph.style.transform = `translateX(${offset + pct * l.width}px)`;

    const guide = guideRef.current;
    if (guide) {
      if (snapTime == null) {
        guide.style.display = "none";
      } else {
        const gpct = duration > 0 ? clamp(snapTime / duration, 0, 1) : 0;
        guide.style.display = "block";
        guide.style.transform = `translateX(${offset + gpct * l.width}px)`;
      }
    }
  });

  const scrubFromClientX = (clientX: number) => {
    const lanes = lanesRef.current;
    if (!lanes) return;
    const rect = lanes.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekTo(pct * duration);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!visible || e.button !== 0) return;
    const lanes = lanesRef.current;
    const body = bodyRef.current;
    if (!lanes || !body) return;
    const rect = lanes.getBoundingClientRect();
    const target = e.target as HTMLElement;
    const clip = target.closest ? (target.closest(".tl-clip") as HTMLElement | null) : null;
    if (clip && rect.width > 0) {
      const handle = target.closest(".tl-handle") as HTMLElement | null;
      if (clip.dataset.music === "1") {
        const music = state.music;
        if (!music) return;
        let kind: "musicMove" | "musicTrimL" | "musicTrimR" = "musicMove";
        if (handle) kind = handle.classList.contains("tl-handle-l") ? "musicTrimL" : "musicTrimR";
        interactionRef.current = {
          kind,
          startX: e.clientX,
          width: rect.width,
          origStart: music.start,
          origEnd: music.end,
          origAudioStart: music.audioStart,
          viewDuration: duration,
        };
        setFrozenDuration(duration);
        try {
          body.setPointerCapture(e.pointerId);
        } catch {
          /* best effort */
        }
        e.preventDefault();
        return;
      }
      const id = clip.dataset.id;
      const obj = state.objects.find((o) => o.id === id);
      if (!obj) return;
      dispatch({ type: "selectObject", id: obj.id });
      let kind: "moveTime" | "trimL" | "trimR" = "moveTime";
      if (handle) kind = handle.classList.contains("tl-handle-l") ? "trimL" : "trimR";
      interactionRef.current = {
        kind,
        id: obj.id,
        startX: e.clientX,
        width: rect.width,
        origStart: obj.tStart == null ? 0 : obj.tStart,
        origEnd: obj.tEnd == null ? duration : obj.tEnd,
        viewDuration: duration,
      };
      setFrozenDuration(duration);
      try {
        body.setPointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
      e.preventDefault();
      return;
    }
    if (e.clientX > rect.right) return;
    interactionRef.current = { kind: "scrub" };
    try {
      body.setPointerCapture(e.pointerId);
    } catch {
      /* best effort */
    }
    scrubFromClientX(e.clientX);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const it = interactionRef.current;
    if (!it) return;
    if (it.kind === "scrub") {
      scrubFromClientX(e.clientX);
      return;
    }
    if (it.width <= 0) return;
    const vd = it.viewDuration;
    if (vd <= 0) return;
    const dT = ((e.clientX - it.startX) / it.width) * vd;
    const minLen = Math.min(0.05, vd);
    const threshold = (TIMELINE_SNAP_PX / it.width) * vd;

    if (it.kind === "musicMove" || it.kind === "musicTrimL" || it.kind === "musicTrimR") {
      const music = state.music;
      if (!music) return;
      // Music snaps to the timeline bounds and every object edge, but not to
      // itself (that would fight every drag).
      const targets = timelineSnapTargets(vd, state.objects, "");
      let patch: Partial<MusicTrack> | null = null;
      if (it.kind === "musicMove") {
        const len = it.origEnd - it.origStart;
        const snapped = snapMove(it.origStart + dT, len, targets, threshold);
        const s = clamp(snapped.value, 0, Math.max(0, vd - len));
        patch = { start: round2(s), end: round2(s + len) };
        setSnapTime(snapped.guide);
        seekTo(s);
      } else if (it.kind === "musicTrimL") {
        // Dragging the left edge trims into (or back out of) the song, so the
        // source offset moves with the clip start.
        const minStart = Math.max(0, it.origStart - it.origAudioStart);
        const snapped = snapValue(it.origStart + dT, targets, threshold);
        const s = clamp(snapped.value, minStart, it.origEnd - minLen);
        const audioStart = clamp(it.origAudioStart + (s - it.origStart), 0, music.duration);
        patch = { start: round2(s), audioStart: round2(audioStart) };
        setSnapTime(snapped.guide);
        seekTo(s);
      } else {
        const cap = Math.min(vd, musicMaxEnd(music, it.origAudioStart));
        const snapped = snapValue(it.origEnd + dT, targets, threshold);
        const v = clamp(snapped.value, it.origStart + minLen, Math.max(it.origStart + minLen, cap));
        patch = { end: round2(v) };
        setSnapTime(snapped.guide);
        seekTo(v);
      }
      if (patch) dispatch({ type: "updateMusic", patch });
      return;
    }

    if (!("id" in it)) return;
    const obj = state.objects.find((o) => o.id === it.id) as EditorObject | undefined;
    if (!obj) return;
    const targets = timelineSnapTargets(vd, state.objects, it.id);
    if (state.music) targets.push(state.music.start, state.music.end);

    let patch: Partial<EditorObject> | null = null;
    if (it.kind === "moveTime") {
      const len = it.origEnd - it.origStart;
      const snapped = snapMove(it.origStart + dT, len, targets, threshold);
      const s = clamp(snapped.value, 0, Math.max(0, vd - len));
      patch = { tStart: round2(s), tEnd: round2(s + len) };
      setSnapTime(snapped.guide);
      seekTo(s);
    } else if (it.kind === "trimL") {
      const snapped = snapValue(it.origStart + dT, targets, threshold);
      const s = clamp(snapped.value, 0, it.origEnd - minLen);
      patch = { tStart: round2(s) };
      setSnapTime(snapped.guide);
      seekTo(s);
    } else {
      const snapped = snapValue(it.origEnd + dT, targets, threshold);
      const v = clamp(snapped.value, it.origStart + minLen, vd);
      patch = { tEnd: round2(v) };
      setSnapTime(snapped.guide);
      seekTo(v);
    }
    if (patch) dispatch({ type: "updateObject", id: it.id, patch });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const it = interactionRef.current;
    if (!it) return;
    interactionRef.current = null;
    setSnapTime(null);
    const body = bodyRef.current;
    try {
      body?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (it.kind !== "scrub") commit();
    setFrozenDuration(null);
    e.preventDefault();
  };

  const playheadLabel = formatTime(getPlayhead());
  const music = state.music;
  const musicStart = music ? clamp(music.start, 0, duration) : 0;
  const musicEnd = music ? clamp(music.end, 0, duration) : 0;

  return (
    <section className={`timeline${visible ? "" : " hidden"}`} id="timeline">
      <div className="timeline-head">
        <button
          id="tl-play"
          className="tl-btn"
          type="button"
          title="Play / pause (Space)"
          onClick={togglePlay}
        >
          {state.video.playing ? "⏸" : "▶"}
        </button>
        <span id="tl-current" className="tl-time">
          {playheadLabel}
        </span>
        <span className="tl-time">/</span>
        <span id="tl-duration" className="tl-time">
          {formatTime(duration)}
        </span>
        <button
          id="tl-mute"
          className="tl-btn"
          type="button"
          title={state.video.muted ? "Original video audio is off" : "Original video audio is on"}
          onClick={toggleMute}
        >
          {state.video.muted ? "🔇" : "🔊"}
        </button>
        <button
          id="tl-music"
          className="tl-btn"
          type="button"
          title={music ? "Replace music" : "Add music"}
          onClick={() => void addMusicDialog()}
        >
          🎵
        </button>
        {music && (
          <button
            id="tl-music-remove"
            className="tl-btn"
            type="button"
            title="Remove music"
            onClick={removeMusic}
          >
            ✕
          </button>
        )}
        <label className="tl-check" title="Show objects that are not active at the playhead">
          <input
            type="checkbox"
            id="tl-showhidden"
            checked={state.showHiddenObjects}
            onChange={(e) => dispatch({ type: "setShowHidden", value: e.target.checked })}
          />{" "}
          Show all
        </label>
        <span className="tl-hint">
          Drag bars to retime · drag edges to trim · click the ruler to scrub
        </span>
      </div>
      <div
        className="tl-body"
        id="tl-body"
        ref={bodyRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="tl-scroll" id="tl-scroll">
          <div className="tl-ruler" id="tl-ruler">
            {ticks.map((tick) => (
              <div key={tick.t} className="tl-tick" style={{ left: `${(tick.t / duration) * 100}%` }}>
                {tick.label && <span className="tl-tick-label">{tick.label}</span>}
              </div>
            ))}
          </div>
          <div className="tl-lanes" id="tl-lanes" ref={lanesRef}>
            {music && (
              <div className="tl-lane tl-lane-music">
                <div
                  className="tl-clip clip-music"
                  data-music="1"
                  style={{
                    left: `${duration > 0 ? (musicStart / duration) * 100 : 0}%`,
                    width: `${duration > 0 ? (Math.max(0, musicEnd - musicStart) / duration) * 100 : 0}%`,
                  }}
                >
                  <div className="tl-handle tl-handle-l" />
                  <div className="tl-clip-body">
                    <span className="tl-clip-label">♪ {music.name}</span>
                  </div>
                  <div className="tl-handle tl-handle-r" />
                </div>
              </div>
            )}
            {state.objects
              .slice()
              .reverse()
              .map((obj) => {
                const s = clamp(obj.tStart == null ? 0 : obj.tStart, 0, duration);
                const e = clamp(obj.tEnd == null ? duration : obj.tEnd, 0, duration);
                const active = isObjectActiveAt(obj, getPlayhead(), state.mediaType);
                const selected = obj.id === state.selectedObjectId;
                return (
                  <div className="tl-lane" key={obj.id}>
                    <div
                      className={`tl-clip clip-${obj.type}${selected ? " selected" : ""}${
                        active ? " active-now" : ""
                      }`}
                      data-id={obj.id}
                      style={{
                        left: `${duration > 0 ? (s / duration) * 100 : 0}%`,
                        width: `${duration > 0 ? (Math.max(0, e - s) / duration) * 100 : 0}%`,
                      }}
                    >
                      <div className="tl-handle tl-handle-l" />
                      <div className="tl-clip-body">
                        <span className="tl-clip-label">{clipLabel(obj)}</span>
                      </div>
                      <div className="tl-handle tl-handle-r" />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
        <div className="tl-playhead" id="tl-playhead" ref={playheadRef}>
          <div className="tl-playhead-handle" />
        </div>
        <div className="tl-guide" id="tl-guide" ref={guideRef} />
      </div>
    </section>
  );
}
