import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { initialState } from "./defaults";
import { reducer, type Action } from "./reducer";
import { useToast } from "../components/Toasts";
import { loadImageElement, blobToDataURL } from "../lib/image";
import { installFonts } from "../lib/fonts";
import { renderToPNG, getSelectedObject, renderBackgroundPatternPng } from "../lib/render";
import { computeDocumentSize } from "../lib/document";
import { getObjectBounds, uid } from "../lib/object";
import {
  computeOutputSize,
  containerForCodec,
  defaultTimingPatch,
  formatTime,
  isBlurObject,
  isVideoFile,
  renderBlurMaskPng,
  renderObjectPng,
  timelineDuration,
} from "../lib/video";
import { PREFERENCES_VERSION } from "../lib/constants";
import type {
  EditorObject,
  EditorState,
  MusicTrack,
  Tool,
  VideoExportLayer,
} from "../types";

interface Preferences {
  version: number;
  background: string;
  backgroundStyle: EditorState["backgroundStyle"];
  padding: EditorState["padding"];
  brush: EditorState["brush"];
  startCanvas: EditorState["startCanvas"];
  textPresets: EditorState["textPresets"];
  defaultPresetId: string | null;
  logoDataURL: string | null;
  videoExport: Pick<
    EditorState["video"],
    "exportFps" | "resolution" | "codec" | "hardware"
  >;
}

interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<Action>;
  prefsReady: boolean;
  fontFamilies: string[];
  fontsRevision: number;
  openImageDialog: () => Promise<void>;
  openImageFromPath: (path: string) => Promise<void>;
  openImageFile: (file: File) => Promise<void>;
  replaceImageDialog: () => Promise<void>;
  addImageLayerDialog: () => Promise<void>;
  addImageLayerFile: (file: File) => Promise<void>;
  startEmpty: (width: number, height: number, background: string) => void;
  resetProject: () => void;
  setActiveTool: (tool: Tool) => void;
  exportImage: () => Promise<void>;
  exportMedia: () => Promise<void>;
  commit: (key?: string) => void;
  undo: () => void;
  redo: () => void;
  updateObject: (id: string, patch: Partial<EditorObject>) => void;
  deleteSelected: () => void;
  bringForward: () => void;
  sendBackward: () => void;

  // Video
  openVideoDialog: () => Promise<void>;
  openVideoFile: (file: File) => Promise<void>;
  togglePlay: () => void;
  toggleMute: () => void;
  seekTo: (t: number) => void;
  getPlayhead: () => number;
  subscribeVideo: (fn: () => void) => () => void;
  videoTick: number;
  addMusicDialog: () => Promise<void>;
  removeMusic: () => void;
  exporting: boolean;
  exportProgress: number | null;
  exportDialogOpen: boolean;
  confirmExportVideo: () => Promise<void>;
  cancelExportVideo: () => void;

  // Crop
  applyCrop: () => void;
  cancelCrop: () => void;
  resetVideoCrop: () => void;
  startImageCrop: () => void;
  applyImageCrop: () => void;
  cancelImageCrop: () => void;

  // Eyedropper
  eyedropperActive: boolean;
  startEyedropper: (apply: (hex: string) => void) => void;
  stopEyedropper: () => void;
  applyEyedropper: (hex: string) => void;

  // Logo
  placeLogo: () => void;
  changeLogo: () => void;
  setLogoFile: (file: File) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

function collectPreferences(state: EditorState): Preferences {
  return {
    version: PREFERENCES_VERSION,
    background: state.background,
    backgroundStyle: state.backgroundStyle,
    padding: state.padding,
    brush: state.brush,
    startCanvas: state.startCanvas,
    textPresets: state.textPresets,
    defaultPresetId: state.defaultPresetId,
    logoDataURL: state.logoDataURL,
    videoExport: {
      exportFps: state.video.exportFps,
      resolution: state.video.resolution,
      codec: state.video.codec,
      hardware: state.video.hardware,
    },
  };
}

function imageLayerObject(
  state: EditorState,
  img: HTMLImageElement,
  relativeWidth: number,
): EditorObject {
  const size = computeDocumentSize(state.baseImage, state.padding);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (relativeWidth < 1) {
    w = size.width * relativeWidth;
    h = Math.max(1, w * (img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.5));
  }
  const maxW = size.width * 0.8;
  const maxH = size.height * 0.8;
  if (w > maxW || h > maxH) {
    const k = Math.min(maxW / w, maxH / h);
    w *= k;
    h *= k;
  }
  return {
    id: uid(),
    type: "image",
    source: img,
    x: Math.round((size.width - w) / 2),
    y: Math.round((size.height - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
    opacity: 1,
  };
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [prefsReady, setPrefsReady] = useState(false);
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [fontsRevision, setFontsRevision] = useState(0);
  const toast = useToast().toast;
  const persistTimer = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Playback state mirrored synchronously so callbacks invoked in the same tick
  // as a play/pause dispatch see the new value.
  const playingRef = useRef(false);

  // Video playback state (the element itself is rendered by the Stage and
  // attached through this ref).
  const [videoTick, setVideoTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const eyedropperApplyRef = useRef<((hex: string) => void) | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoPathRef = useRef<string | null>(null);
  const videoBlobRef = useRef<Blob | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  // While the music outlives the video, playback is driven by a wall clock and
  // the video stays frozen on its last frame. The playhead is not tied to
  // `video.currentTime` in that region.
  const postRollRef = useRef<{ baseTime: number; wall: number } | null>(null);
  const postRollHandleRef = useRef<number | null>(null);
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const musicSrcRef = useRef<string | null>(null);
  const usingRvfcRef = useRef(false);
  const exportingRef = useRef(false);
  const videoListenersRef = useRef(new Set<() => void>());
  const tickAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    installFonts()
      .then((families) => {
        if (cancelled) return;
        setFontFamilies(families);
        setFontsRevision((v) => v + 1);
      })
      .catch(() => {
        /* fall back to the default font */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.meme
      .loadPreferences()
      .then((json) => {
        if (cancelled) return;
        let prefs: Partial<Preferences> = {};
        try {
          prefs = JSON.parse(json) as Partial<Preferences>;
        } catch {
          prefs = {};
        }
        dispatch({
          type: "loadPreferences",
          prefs: {
            background: prefs.background,
            backgroundStyle: prefs.backgroundStyle,
            padding: prefs.padding,
            brush: prefs.brush,
            startCanvas: prefs.startCanvas,
            textPresets: prefs.textPresets,
            defaultPresetId: prefs.defaultPresetId,
            logoDataURL: prefs.logoDataURL,
            videoExport: prefs.videoExport,
          },
        });
        setPrefsReady(true);
      })
      .catch(() => setPrefsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const prefsJson = useMemo(
    () => JSON.stringify(collectPreferences(state)),
    [
      state.background,
      state.backgroundStyle,
      state.padding,
      state.brush,
      state.startCanvas,
      state.textPresets,
      state.defaultPresetId,
      state.logoDataURL,
      state.video.exportFps,
      state.video.resolution,
      state.video.codec,
      state.video.hardware,
    ],
  );

  useEffect(() => {
    if (!prefsReady) return;
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      window.meme.savePreferences(prefsJson).catch(() => {
        /* ignore transient write failures */
      });
    }, 400);
    return () => {
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    };
  }, [prefsReady, prefsJson]);

  const applyImage = useCallback(
    async (src: string) => {
      try {
        const img = await loadImageElement(src);
        if (!img.naturalWidth || !img.naturalHeight) {
          toast("Image has no dimensions", "error");
          return;
        }
        dispatch({
          type: "setBaseImage",
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          mediaType: "image",
        });
      } catch {
        toast("Could not read image file", "error");
      }
    },
    [toast],
  );

  const openImageFromPath = useCallback(
    async (path: string) => {
      try {
        const dataURL = await window.meme.readMedia(path);
        await applyImage(dataURL);
      } catch {
        toast("Could not read image file", "error");
      }
    },
    [applyImage, toast],
  );

  const openImageDialog = useCallback(async () => {
    const path = await window.meme.pickMedia("image");
    if (path) await openImageFromPath(path);
  }, [openImageFromPath]);

  const openImageFile = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      try {
        await applyImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [applyImage],
  );

  const loadBaseImageKeepObjects = useCallback(
    async (img: HTMLImageElement) => {
      if (!img.naturalWidth || !img.naturalHeight) {
        toast("Image has no dimensions", "error");
        return;
      }
      dispatch({
        type: "replaceBase",
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        shiftX: 0,
        shiftY: 0,
      });
      dispatch({ type: "commit" });
      toast("Base image replaced");
    },
    [dispatch, toast],
  );

  const replaceImageDialog = useCallback(async () => {
    const path = await window.meme.pickMedia("image");
    if (!path) return;
    try {
      const dataURL = await window.meme.readMedia(path);
      await loadBaseImageKeepObjects(await loadImageElement(dataURL));
    } catch {
      toast("Could not read image file", "error");
    }
  }, [loadBaseImageKeepObjects, toast]);

  const placeImageLayer = useCallback(
    (img: HTMLImageElement, relativeWidth = 1) => {
      const st = stateRef.current;
      const object = imageLayerObject(st, img, relativeWidth);
      if (st.mediaType === "video" && videoElRef.current) {
        const pr = postRollRef.current;
        const playhead = pr
          ? pr.baseTime
          : videoElRef.current.currentTime || 0;
        object.tStart = Math.round(playhead * 100) / 100;
        object.tEnd = timelineDuration(st.video.duration, st.music);
      }
      dispatch({ type: "addObject", object });
      dispatch({ type: "setActiveTool", tool: "select" });
      dispatch({ type: "commit" });
      toast("Image added as layer");
    },
    [toast],
  );

  const addImageLayerDialog = useCallback(async () => {
    const path = await window.meme.pickMedia("image");
    if (!path) return;
    try {
      const dataURL = await window.meme.readMedia(path);
      const img = await loadImageElement(dataURL);
      placeImageLayer(img, 1);
    } catch {
      toast("Could not read image file", "error");
    }
  }, [placeImageLayer, toast]);

  const addImageLayerFile = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImageElement(url);
        placeImageLayer(img, 1);
      } catch {
        toast("Could not read image file", "error");
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [placeImageLayer, toast],
  );

  const startEmpty = useCallback((width: number, height: number, background: string) => {
    dispatch({ type: "startEmpty", width, height, background });
  }, []);

  const resetProject = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const setActiveTool = useCallback((tool: Tool) => {
    dispatch({ type: "setActiveTool", tool });
  }, []);

  const commit = useCallback((key?: string) => dispatch({ type: "commit", key }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const updateObject = useCallback((id: string, patch: Partial<EditorObject>) => {
    dispatch({ type: "updateObject", id, patch });
  }, []);

  const deleteSelected = useCallback(() => {
    const id = stateRef.current.selectedObjectId;
    if (id) {
      dispatch({ type: "removeObject", id });
      dispatch({ type: "commit" });
    }
  }, []);

  const bringForward = useCallback(() => {
    const id = stateRef.current.selectedObjectId;
    if (id) {
      dispatch({ type: "reorder", id, direction: "forward" });
      dispatch({ type: "commit" });
    }
  }, []);

  const sendBackward = useCallback(() => {
    const id = stateRef.current.selectedObjectId;
    if (id) {
      dispatch({ type: "reorder", id, direction: "backward" });
      dispatch({ type: "commit" });
    }
  }, []);

  // --- Video --------------------------------------------------------------

  const emitVideo = useCallback(() => {
    videoListenersRef.current.forEach((fn) => fn());
  }, []);

  const subscribeVideo = useCallback((fn: () => void) => {
    videoListenersRef.current.add(fn);
    return () => {
      videoListenersRef.current.delete(fn);
    };
  }, []);

  const bumpTick = useCallback(() => {
    const now = performance.now();
    if (now - tickAtRef.current < 80) return;
    tickAtRef.current = now;
    setVideoTick((v) => v + 1);
  }, []);

  const stopPostRoll = useCallback(() => {
    const handle = postRollHandleRef.current;
    postRollHandleRef.current = null;
    if (handle != null) cancelAnimationFrame(handle);
  }, []);

  const stopLoop = useCallback(() => {
    const handle = frameHandleRef.current;
    frameHandleRef.current = null;
    stopPostRoll();
    if (handle == null) return;
    const el = videoElRef.current;
    if (usingRvfcRef.current && el && el.cancelVideoFrameCallback) {
      try {
        el.cancelVideoFrameCallback(handle);
      } catch {
        /* handle may belong to rAF */
      }
    } else {
      cancelAnimationFrame(handle);
    }
  }, [stopPostRoll]);

  // The playhead can sit past the source video's end when music extends the
  // timeline, so it is not always `video.currentTime`.
  const getPlayhead = useCallback(() => {
    if (stateRef.current.mediaType !== "video") return 0;
    const pr = postRollRef.current;
    if (pr) {
      const elapsed = playingRef.current ? (performance.now() - pr.wall) / 1000 : 0;
      return Math.max(0, pr.baseTime + elapsed);
    }
    const el = videoElRef.current;
    return el?.currentTime || 0;
  }, []);

  // Keep the preview <audio> element in step with the playhead. It only plays
  // while the playhead is inside the music clip's window.
  const syncMusic = useCallback(
    (force = false) => {
      const audio = musicElRef.current;
      if (!audio) return;
      const m = stateRef.current.music;
      if (!m) {
        if (!audio.paused) audio.pause();
        return;
      }
      const t = getPlayhead();
      const inside = t >= m.start - 1e-3 && t < m.end - 1e-3;
      if (!inside) {
        if (!audio.paused) audio.pause();
        return;
      }
      const desired = Math.max(
        0,
        Math.min(
          isFinite(m.duration) && m.duration > 0 ? m.duration : Number.MAX_SAFE_INTEGER,
          m.audioStart + (t - m.start),
        ),
      );
      if (force || Math.abs(audio.currentTime - desired) > 0.3) {
        try {
          audio.currentTime = desired;
        } catch {
          /* ignore */
        }
      }
      if (playingRef.current) {
        if (audio.paused) {
          void audio.play().catch(() => {
            /* autoplay may be blocked; ignore */
          });
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    },
    [getPlayhead],
  );

  // Drive playback during the music-only tail after the video has ended.
  const startPostRoll = useCallback(
    (fromTime: number) => {
      postRollRef.current = { baseTime: fromTime, wall: performance.now() };
      if (postRollHandleRef.current != null) return;
      const step = () => {
        postRollHandleRef.current = null;
        const pr = postRollRef.current;
        const st = stateRef.current;
        const total = timelineDuration(st.video.duration, st.music);
        if (!pr || !playingRef.current || total <= 0) return;
        const t = pr.baseTime + (performance.now() - pr.wall) / 1000;
        if (t >= total - 1e-3) {
          postRollRef.current = { baseTime: total, wall: performance.now() };
          playingRef.current = false;
          dispatch({ type: "setVideoState", patch: { playing: false } });
          syncMusic(true);
          emitVideo();
          setVideoTick((v) => v + 1);
          return;
        }
        syncMusic(false);
        emitVideo();
        bumpTick();
        postRollHandleRef.current = requestAnimationFrame(step);
      };
      postRollHandleRef.current = requestAnimationFrame(step);
    },
    [bumpTick, dispatch, emitVideo, syncMusic],
  );

  const startLoop = useCallback(() => {
    if (frameHandleRef.current != null) return;
    const step = () => {
      const el = videoElRef.current;
      if (!el || el.paused || el.ended) {
        frameHandleRef.current = null;
        emitVideo();
        setVideoTick((v) => v + 1);
        return;
      }
      syncMusic(false);
      emitVideo();
      bumpTick();
      if (el.requestVideoFrameCallback) {
        usingRvfcRef.current = true;
        frameHandleRef.current = el.requestVideoFrameCallback(step);
      } else {
        usingRvfcRef.current = false;
        frameHandleRef.current = requestAnimationFrame(step);
      }
    };
    const el = videoElRef.current;
    if (el && el.requestVideoFrameCallback) {
      usingRvfcRef.current = true;
      frameHandleRef.current = el.requestVideoFrameCallback(step);
    } else {
      usingRvfcRef.current = false;
      frameHandleRef.current = requestAnimationFrame(step);
    }
  }, [bumpTick, emitVideo, syncMusic]);

  const play = useCallback(() => {
    const el = videoElRef.current;
    if (!el) return;
    const st = stateRef.current;
    const total = timelineDuration(st.video.duration, st.music);
    const videoDur = isFinite(el.duration) && el.duration > 0 ? el.duration : st.video.duration;
    let t = getPlayhead();
    if (total > 0 && t >= total - 0.05) {
      t = 0;
      postRollRef.current = null;
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    playingRef.current = true;
    dispatch({ type: "setVideoState", patch: { playing: true } });
    // Starting inside the tail: the video is already over, so freeze it and
    // let the wall clock drive the playhead.
    if (st.music && videoDur > 0 && t >= videoDur - 1e-3) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      syncMusic(true);
      startPostRoll(t);
      emitVideo();
      return;
    }
    postRollRef.current = null;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        playingRef.current = false;
        dispatch({ type: "setVideoState", patch: { playing: false } });
        stopLoop();
      });
    }
    syncMusic(true);
    startLoop();
  }, [dispatch, emitVideo, getPlayhead, startLoop, startPostRoll, stopLoop, syncMusic]);

  const pause = useCallback(() => {
    const el = videoElRef.current;
    const pr = postRollRef.current;
    if (pr) {
      // Freeze the virtual clock at the current playhead.
      postRollRef.current = { baseTime: getPlayhead(), wall: performance.now() };
    }
    playingRef.current = false;
    dispatch({ type: "setVideoState", patch: { playing: false } });
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    stopLoop();
    syncMusic(true);
    emitVideo();
  }, [dispatch, emitVideo, getPlayhead, stopLoop, syncMusic]);

  const togglePlay = useCallback(() => {
    const el = videoElRef.current;
    if (stateRef.current.mediaType !== "video" || !el) return;
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const toggleMute = useCallback(() => {
    const el = videoElRef.current;
    if (stateRef.current.mediaType !== "video" || !el) return;
    const muted = !el.muted;
    el.muted = muted;
    dispatch({ type: "setVideoState", patch: { muted } });
  }, [dispatch]);

  const seekTo = useCallback(
    (t: number) => {
      const el = videoElRef.current;
      if (!el) return;
      const st = stateRef.current;
      const total = timelineDuration(st.video.duration, st.music);
      const fallback = isFinite(el.duration) ? el.duration : 0;
      const clamped = Math.max(0, Math.min(total > 0 ? total : fallback, t));
      const videoDur = isFinite(el.duration) && el.duration > 0 ? el.duration : st.video.duration;
      stopPostRoll();
      if (st.music && videoDur > 0 && clamped >= videoDur - 1e-3) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        try {
          el.currentTime = Math.max(0, videoDur - 0.001);
        } catch {
          /* ignore */
        }
        postRollRef.current = { baseTime: clamped, wall: performance.now() };
        if (playingRef.current) startPostRoll(clamped);
      } else {
        postRollRef.current = null;
        try {
          el.currentTime = clamped;
        } catch {
          /* ignore */
        }
        if (playingRef.current) {
          const p = el.play();
          if (p && typeof p.catch === "function") p.catch(() => undefined);
          startLoop();
        }
      }
      syncMusic(true);
      emitVideo();
      setVideoTick((v) => v + 1);
    },
    [emitVideo, startLoop, startPostRoll, stopPostRoll, syncMusic],
  );

  const loadVideoSrc = useCallback(
    async (src: string, blob: Blob | null, path: string | null) => {
      const el = videoElRef.current;
      if (!el) {
        toast("Video element unavailable", "error");
        return;
      }
      stopLoop();
      postRollRef.current = null;
      playingRef.current = false;
      try {
        musicElRef.current?.pause();
      } catch {
        /* ignore */
      }
      videoPathRef.current = path;
      videoBlobRef.current = blob;
      el.muted = stateRef.current.video.muted;
      // A data: URL is used deliberately: blob: URLs are unreliable when the
      // renderer is served from file:// in the packaged app.
      el.src = src;
      el.load();
      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => finish(), 5000);
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            cleanup();
            resolve();
          };
          const onErr = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            const codes = ["", "aborted", "network", "decode", "src-not-supported"];
            const code = el.error ? codes[el.error.code] || String(el.error.code) : "unknown";
            cleanup();
            reject(new Error("media error: " + code));
          };
          const cleanup = () => {
            el.removeEventListener("loadeddata", finish);
            el.removeEventListener("canplay", finish);
            el.removeEventListener("error", onErr);
          };
          el.addEventListener("loadeddata", finish);
          el.addEventListener("canplay", finish);
          el.addEventListener("error", onErr);
        });
      } catch (err) {
        toast(
          "Could not load video: " + (err instanceof Error ? err.message : String(err)),
          "error",
        );
        return;
      }
      if (!el.videoWidth || !el.videoHeight) {
        toast("Video has no dimensions", "error");
        return;
      }
      const duration = isFinite(el.duration) ? el.duration : 0;
      dispatch({
        type: "setVideo",
        source: el,
        width: el.videoWidth,
        height: el.videoHeight,
        duration,
      });
      emitVideo();
      toast("Video loaded · " + formatTime(duration));
    },
    [dispatch, emitVideo, stopLoop, toast],
  );

  const openVideoFromPath = useCallback(
    async (path: string) => {
      try {
        const dataURL = await window.meme.readMedia(path);
        await loadVideoSrc(dataURL, null, path);
      } catch (err) {
        toast("Could not read video file: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
    [loadVideoSrc, toast],
  );

  const openVideoDialog = useCallback(async () => {
    const path = await window.meme.pickMedia("video");
    if (path) await openVideoFromPath(path);
  }, [openVideoFromPath]);

  const openVideoFile = useCallback(
    async (file: File) => {
      if (!isVideoFile(file)) {
        toast("Unsupported video type", "error");
        return;
      }
      let path: string | null = null;
      try {
        path = window.meme.getPathForFile(file) || null;
      } catch {
        path = null;
      }
      try {
        const dataURL = await blobToDataURL(file);
        await loadVideoSrc(dataURL, file, path);
      } catch (err) {
        toast("Could not read video file: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
    [loadVideoSrc, toast],
  );

  const loadMusicFromPath = useCallback(
    async (path: string) => {
      try {
        const dataUrl = await window.meme.readMedia(path);
        const probe = document.createElement("audio");
        probe.preload = "metadata";
        const duration = await new Promise<number>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("timeout")), 10000);
          const done = (value: number) => {
            window.clearTimeout(timer);
            resolve(value);
          };
          probe.addEventListener(
            "loadedmetadata",
            () => done(isFinite(probe.duration) ? probe.duration : 0),
            { once: true },
          );
          probe.addEventListener(
            "error",
            () => {
              window.clearTimeout(timer);
              reject(new Error("could not decode audio"));
            },
            { once: true },
          );
          probe.src = dataUrl;
          probe.load();
        });
        if (!duration || !isFinite(duration) || duration <= 0) {
          toast("This audio file has no usable duration", "error");
          return;
        }
        const name = path.split(/[\\/]/).pop() || "Music";
        const music: MusicTrack = {
          name,
          path,
          dataUrl,
          duration,
          // Start at the beginning; the timeline grows if the song is longer
          // than the video, and the user can trim it from the timeline.
          start: 0,
          end: duration,
          audioStart: 0,
        };
        dispatch({ type: "setMusic", music });
        dispatch({ type: "commit" });
        toast(`Music added · ${formatTime(duration)}`);
      } catch (err) {
        toast(
          "Could not read audio file: " + (err instanceof Error ? err.message : String(err)),
          "error",
        );
      }
    },
    [dispatch, toast],
  );

  const addMusicDialog = useCallback(async () => {
    if (stateRef.current.mediaType !== "video") {
      toast("Music can only be added to a video project", "error");
      return;
    }
    const path = await window.meme.pickMedia("audio");
    if (path) await loadMusicFromPath(path);
  }, [loadMusicFromPath, toast]);

  const removeMusic = useCallback(() => {
    try {
      musicElRef.current?.pause();
    } catch {
      /* ignore */
    }
    dispatch({ type: "setMusic", music: null });
    dispatch({ type: "commit" });
  }, [dispatch]);

  const exportVideo = useCallback(async () => {
    const current = stateRef.current;
    const el = videoElRef.current;
    if (current.mediaType !== "video" || !el) {
      toast("Open a video first", "error");
      return;
    }
    if (exportingRef.current) {
      toast("An export is already running", "error");
      return;
    }
    pause();

    let ok = true;
    try {
      ok = await window.meme.ffmpegAvailable();
    } catch {
      ok = true;
    }
    if (!ok) {
      toast("ffmpeg is required to export video and was not found", "error");
      return;
    }

    const size = computeDocumentSize(current.baseImage, current.padding);
    const videoDuration = current.video.duration || (isFinite(el.duration) ? el.duration : 0);
    const duration = timelineDuration(videoDuration, current.music);
    if (!isFinite(duration) || duration <= 0) {
      toast("This video has no usable duration", "error");
      return;
    }

    const layers: VideoExportLayer[] = [];
    // The line pattern shows through the padding, on top of ffmpeg's flat
    // background fill and beneath every object and the video frame itself.
    const backgroundPattern = renderBackgroundPatternPng(current);
    if (backgroundPattern) {
      layers.push({ image: backgroundPattern, start: 0, end: duration, blur: 0 });
    }
    for (const obj of current.objects) {
      const start = obj.tStart == null ? 0 : obj.tStart;
      let end = obj.tEnd == null ? duration : obj.tEnd;
      if (end > duration) end = duration;
      if (end <= start) continue;
      if (isBlurObject(obj)) {
        layers.push({
          image: renderBlurMaskPng(current, obj),
          start,
          end,
          blur: Math.round(obj.blurRadius || 16),
        });
      } else {
        layers.push({ image: renderObjectPng(current, obj), start, end, blur: 0 });
      }
    }

    let sourcePath = videoPathRef.current || "";
    let sourceData = "";
    if (!sourcePath) {
      if (!videoBlobRef.current) {
        toast("Missing video source", "error");
        return;
      }
      sourceData = await blobToDataURL(videoBlobRef.current);
    }

    const out = computeOutputSize(size.width, size.height, current.video.resolution);
    const ext = containerForCodec(current.video.codec);

    exportingRef.current = true;
    setExporting(true);
    setExportProgress(null);
    try {
      const saved = await window.meme.exportVideo({
        sourcePath,
        sourceData,
        width: Math.round(size.width),
        height: Math.round(size.height),
        padLeft: size.left,
        padTop: size.top,
        background: current.background,
        fps: current.video.exportFps,
        duration,
        filename: `meme.${ext}`,
        layers,
        crop: current.videoCrop,
        codec: current.video.codec,
        hardware: current.video.hardware,
        outWidth: out.width,
        outHeight: out.height,
        originalAudio: !current.video.muted,
        music: current.music
          ? {
              sourcePath: current.music.path || undefined,
              sourceData: current.music.path ? undefined : current.music.dataUrl,
              start: current.music.start,
              end: current.music.end,
              audioStart: current.music.audioStart,
            }
          : null,
      });
      if (saved) toast("Saved " + saved);
      else toast("Export cancelled");
    } catch (err) {
      toast("Video export failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      exportingRef.current = false;
      setExporting(false);
      setExportProgress(null);
      emitVideo();
    }
  }, [emitVideo, pause, toast]);

  const exportImage = useCallback(async () => {
    const current = stateRef.current;
    if (!current.baseImage.source && current.objects.length === 0) {
      toast("Nothing to export", "error");
      return;
    }
    try {
      const dataURL = renderToPNG(current);
      const saved = await window.meme.saveImage(dataURL);
      if (saved) toast("Saved " + saved);
      else toast("Export cancelled");
    } catch (err) {
      toast("Save failed: " + (err instanceof Error ? err.message : String(err)), "error");
    }
  }, [toast]);

  const exportMedia = useCallback(async () => {
    if (stateRef.current.mediaType === "video") {
      pause();
      setExportDialogOpen(true);
    } else {
      await exportImage();
    }
  }, [exportImage, pause]);

  const confirmExportVideo = useCallback(async () => {
    setExportDialogOpen(false);
    await exportVideo();
  }, [exportVideo]);

  const cancelExportVideo = useCallback(() => setExportDialogOpen(false), []);

  // --- Crop ---------------------------------------------------------------

  const cancelCrop = useCallback(() => {
    dispatch({ type: "setCropActive", active: false });
    dispatch({ type: "setActiveTool", tool: "select" });
  }, [dispatch]);

  const applyCrop = useCallback(() => {
    const st = stateRef.current;
    const img = st.baseImage;
    const rect = st.cropRect;
    if (!img.source || !rect || rect.width < 2 || rect.height < 2) {
      toast("Select a crop area first", "error");
      return;
    }
    const size = computeDocumentSize(img, st.padding);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const ix = clamp(Math.round(rect.x - size.left), 0, img.width - 1);
    const iy = clamp(Math.round(rect.y - size.top), 0, img.height - 1);
    const cw = clamp(Math.round(rect.width), 1, img.width - ix);
    const ch = clamp(Math.round(rect.height), 1, img.height - iy);

    if (st.mediaType === "video") {
      // Keep the original file intact: remember the source-pixel region and
      // only render/save that region. Overlays shift to stay over the video.
      const prev = st.videoCrop;
      const newSize = computeDocumentSize({ source: null, width: cw, height: ch }, st.padding);
      dispatch({
        type: "setVideoCrop",
        crop: { x: (prev?.x ?? 0) + ix, y: (prev?.y ?? 0) + iy, width: cw, height: ch },
        width: cw,
        height: ch,
        shiftX: newSize.left - size.left - ix,
        shiftY: newSize.top - size.top - iy,
      });
      dispatch({ type: "setActiveTool", tool: "select" });
      dispatch({ type: "commit" });
      toast(`Video cropped to ${cw} × ${ch}`);
      return;
    }

    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.drawImage(img.source, ix, iy, cw, ch, 0, 0, cw, ch);
    const newSize = computeDocumentSize({ source: off, width: cw, height: ch }, st.padding);
    dispatch({
      type: "replaceBase",
      source: off,
      width: cw,
      height: ch,
      shiftX: newSize.left - size.left - ix,
      shiftY: newSize.top - size.top - iy,
    });
    dispatch({ type: "setActiveTool", tool: "select" });
    dispatch({ type: "commit" });
    toast(`Cropped to ${cw} × ${ch}`);
  }, [dispatch, toast]);

  const resetVideoCrop = useCallback(() => {
    const st = stateRef.current;
    const el = videoElRef.current;
    if (st.mediaType !== "video" || !st.videoCrop || !el) return;
    const fullW = el.videoWidth;
    const fullH = el.videoHeight;
    if (!fullW || !fullH) return;
    const oldSize = computeDocumentSize(st.baseImage, st.padding);
    const newSize = computeDocumentSize({ source: null, width: fullW, height: fullH }, st.padding);
    dispatch({
      type: "setVideoCrop",
      crop: null,
      width: fullW,
      height: fullH,
      shiftX: newSize.left - oldSize.left + st.videoCrop.x,
      shiftY: newSize.top - oldSize.top + st.videoCrop.y,
    });
    dispatch({ type: "commit" });
    toast("Crop removed");
  }, [dispatch, toast]);

  const startImageCrop = useCallback(() => {
    const obj = getSelectedObject(stateRef.current);
    if (!obj || obj.type !== "image") return;
    dispatch({ type: "setImageCrop", value: { objectId: obj.id, rect: null } });
    toast("Drag over the image to choose the area to keep");
  }, [dispatch, toast]);

  const cancelImageCrop = useCallback(() => {
    dispatch({ type: "setImageCrop", value: null });
  }, [dispatch]);

  const applyImageCrop = useCallback(() => {
    const st = stateRef.current;
    const ic = st.imageCrop;
    const target = ic ? st.objects.find((o) => o.id === ic.objectId) : null;
    const r = ic?.rect;
    if (!target || !r || r.width < 2 || r.height < 2) {
      toast("Select a crop area first", "error");
      return;
    }
    const docWidth = computeDocumentSize(st.baseImage, st.padding).width;
    const b = getObjectBounds(target, docWidth);
    const src = target.source as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number } | null;
    const sw0 = src?.naturalWidth || src?.width || 0;
    const sh0 = src?.naturalHeight || src?.height || 0;
    if (!target.source || !sw0 || !sh0) return;
    const scaleX = sw0 / b.width;
    const scaleY = sh0 / b.height;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const sx = clamp(Math.round((r.x - b.x) * scaleX), 0, sw0 - 1);
    const sy = clamp(Math.round((r.y - b.y) * scaleY), 0, sh0 - 1);
    const sw = clamp(Math.round(r.width * scaleX), 1, sw0 - sx);
    const sh = clamp(Math.round(r.height * scaleY), 1, sh0 - sy);
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.drawImage(target.source, sx, sy, sw, sh, 0, 0, sw, sh);
    dispatch({
      type: "updateObject",
      id: target.id,
      patch: { source: off, x: r.x, y: r.y, width: r.width, height: r.height },
    });
    dispatch({ type: "setImageCrop", value: null });
    dispatch({ type: "commit" });
    toast(`Image cropped to ${sw} × ${sh}`);
  }, [dispatch, toast]);

  // --- Eyedropper ---------------------------------------------------------

  const startEyedropper = useCallback(
    (apply: (hex: string) => void) => {
      eyedropperApplyRef.current = apply;
      setEyedropperActive(true);
      toast("Click the canvas to pick a color");
    },
    [toast],
  );

  const stopEyedropper = useCallback(() => {
    setEyedropperActive(false);
    eyedropperApplyRef.current = null;
  }, []);

  const applyEyedropper = useCallback((hex: string) => {
    const fn = eyedropperApplyRef.current;
    setEyedropperActive(false);
    eyedropperApplyRef.current = null;
    if (fn) fn(hex);
  }, []);

  // --- Logo ---------------------------------------------------------------

  const addLogoLayer = useCallback(() => {
    const st = stateRef.current;
    const img = st.logoImage;
    if (!img) return;
    const size = computeDocumentSize(st.baseImage, st.padding);
    let w = Math.round(size.width * 0.54);
    let h = Math.max(
      1,
      Math.round(w * (img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.5)),
    );
    const maxW = size.width * 0.8;
    const maxH = size.height * 0.8;
    if (w > maxW || h > maxH) {
      const k = Math.min(maxW / w, maxH / h);
      w *= k;
      h *= k;
    }
    const obj: EditorObject = {
      id: uid(),
      type: "image",
      source: img,
      x: Math.round((size.width - w) / 2),
      y: Math.round((size.height - h) / 2),
      width: Math.round(w),
      height: Math.round(h),
      opacity: 1,
      rotation: 0,
    };
    const timing = defaultTimingPatch(
      st.mediaType,
      getPlayhead(),
      timelineDuration(st.video.duration, st.music),
    );
    if (timing) Object.assign(obj, timing);
    dispatch({ type: "addObject", object: obj });
    dispatch({ type: "setActiveTool", tool: "select" });
    dispatch({ type: "commit" });
    toast("Logo added");
  }, [dispatch, getPlayhead, toast]);

  const setLogoFile = useCallback(
    (file: File) => {
      blobToDataURL(file)
        .then(async (dataURL) => {
          const img = await loadImageElement(dataURL);
          dispatch({ type: "setLogo", dataURL, image: img });
          toast("Logo saved for quick access");
        })
        .catch(() => toast("Could not read logo image", "error"));
    },
    [dispatch, toast],
  );

  const pickLogoFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) setLogoFile(file);
    };
    input.click();
  }, [setLogoFile]);

  const placeLogo = useCallback(() => {
    if (stateRef.current.logoImage) addLogoLayer();
    else pickLogoFile();
  }, [addLogoLayer, pickLogoFile]);

  // Restore the saved logo image once preferences have loaded.
  useEffect(() => {
    if (!state.logoDataURL || state.logoImage) return;
    const dataURL = state.logoDataURL;
    loadImageElement(dataURL)
      .then((img) => dispatch({ type: "setLogo", dataURL, image: img }))
      .catch(() => {
        /* ignore unreadable logo */
      });
  }, [state.logoDataURL, state.logoImage, dispatch]);

  // The video element is created imperatively (not by React) and kept in the
  // DOM while the app runs. A detached/quickly-remounted element can be
  // deprioritised by the compositor and stall seeking, so this is deliberate.
  useEffect(() => {
    const el = document.createElement("video");
    el.className = "video-source";
    el.preload = "auto";
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.muted = stateRef.current.video.muted;
    document.body.appendChild(el);
    videoElRef.current = el;

    const onEnded = () => {
      const st = stateRef.current;
      const videoDur = isFinite(el.duration) && el.duration > 0 ? el.duration : st.video.duration;
      const total = timelineDuration(st.video.duration, st.music);
      // If music extends the timeline, keep playing over a frozen last frame
      // instead of stopping at the source video's EOF.
      if (playingRef.current && st.music && total > videoDur + 0.02) {
        postRollRef.current = { baseTime: videoDur, wall: performance.now() };
        syncMusic(false);
        emitVideo();
        setVideoTick((v) => v + 1);
        startPostRoll(videoDur);
        return;
      }
      playingRef.current = false;
      postRollRef.current = null;
      dispatch({ type: "setVideoState", patch: { playing: false } });
      stopLoop();
      syncMusic(true);
      emitVideo();
      setVideoTick((v) => v + 1);
    };
    const onSeeked = () => {
      emitVideo();
      setVideoTick((v) => v + 1);
    };
    el.addEventListener("ended", onEnded);
    el.addEventListener("seeked", onSeeked);

    return () => {
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("seeked", onSeeked);
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* ignore */
      }
      el.remove();
      videoElRef.current = null;
    };
  }, [dispatch, emitVideo, startPostRoll, stopLoop, syncMusic]);

  // Preview <audio> element for the music track. Created once, its source is
  // swapped whenever the music changes.
  useEffect(() => {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.className = "music-source";
    document.body.appendChild(el);
    musicElRef.current = el;
    return () => {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* ignore */
      }
      el.remove();
      musicElRef.current = null;
      musicSrcRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = musicElRef.current;
    if (!el) return;
    const src = state.music ? state.music.dataUrl : null;
    if (src !== musicSrcRef.current) {
      musicSrcRef.current = src;
      if (src) {
        el.src = src;
        el.load();
      } else {
        el.removeAttribute("src");
        el.load();
      }
    }
    syncMusic(true);
  }, [state.music, syncMusic]);

  // Leaving a video project (loading an image, restarting) must stop playback.
  useEffect(() => {
    if (state.mediaType !== "image") return;
    const el = videoElRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    playingRef.current = false;
    postRollRef.current = null;
    try {
      musicElRef.current?.pause();
    } catch {
      /* ignore */
    }
    stopLoop();
  }, [state.mediaType, stopLoop]);

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      dispatch,
      prefsReady,
      fontFamilies,
      fontsRevision,
      openImageDialog,
      openImageFromPath,
      openImageFile,
      replaceImageDialog,
      addImageLayerDialog,
      addImageLayerFile,
      startEmpty,
      resetProject,
      setActiveTool,
      exportImage,
      exportMedia,
      commit,
      undo,
      redo,
      updateObject,
      deleteSelected,
      bringForward,
      sendBackward,
      openVideoDialog,
      openVideoFile,
      togglePlay,
      toggleMute,
      seekTo,
      getPlayhead,
      subscribeVideo,
      videoTick,
      addMusicDialog,
      removeMusic,
      exporting,
      exportProgress,
      exportDialogOpen,
      confirmExportVideo,
      cancelExportVideo,
      applyCrop,
      cancelCrop,
      resetVideoCrop,
      startImageCrop,
      applyImageCrop,
      cancelImageCrop,
      eyedropperActive,
      startEyedropper,
      stopEyedropper,
      applyEyedropper,
      placeLogo,
      changeLogo: pickLogoFile,
      setLogoFile,
    }),
    [
      state,
      prefsReady,
      fontFamilies,
      fontsRevision,
      openImageDialog,
      openImageFromPath,
      openImageFile,
      replaceImageDialog,
      addImageLayerDialog,
      addImageLayerFile,
      startEmpty,
      resetProject,
      setActiveTool,
      exportImage,
      exportMedia,
      commit,
      undo,
      redo,
      updateObject,
      deleteSelected,
      bringForward,
      sendBackward,
      openVideoDialog,
      openVideoFile,
      togglePlay,
      toggleMute,
      seekTo,
      getPlayhead,
      subscribeVideo,
      videoTick,
      addMusicDialog,
      removeMusic,
      exporting,
      exportProgress,
      exportDialogOpen,
      confirmExportVideo,
      cancelExportVideo,
      applyCrop,
      cancelCrop,
      resetVideoCrop,
      startImageCrop,
      applyImageCrop,
      cancelImageCrop,
      eyedropperActive,
      startEyedropper,
      stopEyedropper,
      applyEyedropper,
      placeLogo,
      pickLogoFile,
      setLogoFile,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
