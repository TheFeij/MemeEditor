# Migrating Meme Editor to Electron + TypeScript + React

This is the desktop app. It replaced the original Wails (Go + vanilla JS) app,
which has been removed — the Electron app now lives at the repository root and
is the one built and released.

## Why this stack

- **Bundled Chromium** — identical behaviour on every OS, with
  hardware-accelerated decode, WebCodecs, WebGL and WebGPU available.
- **TypeScript + React** — the most agent-friendly stack; large training corpus
  means tools can write and debug it reliably.
- **ffmpeg sidecar** — encoding stays a single native pass (fast, keeps original
  audio) exactly like the old backend, without shipping a Go runtime.
- The cost is install size (~150 MB+) and RAM, which is acceptable for a video
  editor.

## Layout

```
electron/              # Main process (Node)
  main.ts              # Window + app lifecycle
  preload.ts           # contextBridge -> window.meme
  ipc.ts               # IPC handlers (dialogs, file IO, ffmpeg, blur, fonts, prefs)
  config.ts            # Preferences + last-save-dir (userData JSON)
  blur.ts              # Box blur via nativeImage + worker_threads
  fonts.ts             # Drop-in font discovery
  ffmpeg.ts            # Single-pass overlay/blur export
src/                   # Renderer (React)
  main.tsx
  App.tsx
  components/          # TopBar, Toolbar, Stage, Properties, StartOverlay, Toasts, ConfirmDialog
  state/               # Reducer store + EditorContext (preferences persistence)
  lib/                 # constants, document geometry, rendering, image helpers
  styles/style.css     # Themed styling
  assets/fonts/        # Bundled fonts (Zain, Vazirmatn)
resources/fonts/       # Drop-in fonts shipped with packaged builds
```

The bridge surface (`window.meme`) is declared in `src/types.ts` and implemented
in `electron/preload.ts`; keep the two in sync when adding channels.

## Commands

```bash
npm install
npm run dev        # Vite dev server + Electron with HMR
npm run build      # Compile renderer (Vite) and main/preload (tsc)
npm start          # Build then launch the compiled app
npm run typecheck  # tsc for renderer and main
npm run package    # electron-builder (AppImage/zip on Linux, zip on Windows)
```

The renderer is served at `http://localhost:5173` in dev; `electron/main.ts`
loads `dist/renderer/index.html` otherwise. ffmpeg is looked up on `PATH`
(bundled builds can drop a binary into `resources/`).

## Milestone 1 — shipped here

- Project scaffold: Vite + React + TypeScript + Electron, dev/build/package
  scripts, typechecking, CSP injection per mode.
- App shell ported: top bar, tool rail, stage, properties panel, zoom controls,
  start overlay, restart confirmation and toasts.
- Renderer store (reducer + context) for the document and preferences, with
  debounced persistence to the per-user config file.
- Backend ports: file open/save dialogs, media read as data URLs, image export,
  native box blur (worker-threaded), drop-in font discovery, and the full
  single-pass ffmpeg export pipeline.
- Base-image editing: open via dialog / drag-and-drop / clipboard, padding,
  background colour and PNG export.

## Milestone 2 — shipped here

- Object model (`src/types.ts`) and a geometry/rendering engine
  (`src/lib/object.ts`): text metrics with auto-fit (cached), bounds,
  hit-testing, resize/rotate handles and alignment snapping.
- Canvas interaction layer in `Stage`: create rectangles/ellipses and text,
  add image layers, drag/move with guide snapping, resize, rotate, select and
  double-click to edit.
- Properties panel: text (content, font, size, auto-fit, align, RTL/LTR,
  colour, outline), shapes (fill, corner radius), image layers (opacity,
  width/height) and a transform/arrange section.
- Undo/redo history in the reducer with top-bar buttons and Ctrl/Cmd+Z,
  Ctrl+Shift+Z, Delete/Backspace shortcuts.
- PNG export now renders every object, and the brush tool records freehand
  strokes.

## Milestone 3 — shipped here

- Font registration (`src/lib/fonts.ts`): every bundled face (Zain, Vazirmatn)
  is resolved to a hashed Vite asset and loaded with the CSS Font Loading API,
  and the drop-in user fonts from `listUserFonts()` (data URLs) are registered
  the same way. The text font picker now lists the real, loaded families.
- Canvas re-renders once the faces finish loading so text metrics are accurate.
- Text presets: save the selected text's styling as a named preset, apply a
  preset to any text object, rename, delete, and set a default applied to new
  text. Presets persist through the existing per-user preferences file.

## Milestone 4 — shipped here

- Coalesced history: commits carry an optional key, and consecutive commits
  sharing a key within `COMMIT_COALESCE_MS` (see `src/lib/constants.ts`) merge
  into a single undo step. Typing, colour pickers and sliders now produce one
  step per burst instead of one per event.
- Padding and background changes are now recorded in history (previously they
  were not), matching the original plan.
- Keyboard shortcuts: `Ctrl/Cmd + ]` bring forward, `Ctrl/Cmd + [` send
  backward, and `Esc` clears the selection.

## Milestone 5 — shipped here

- Video projects: open a video via the dialog, drag-and-drop or (where a path
  is available) the `webUtils` path bridge. The base source is a live
  `<video>` element drawn onto the canvas, so padding, background and overlays
  behave exactly like the image editor.
- Frame-accurate playback: play / pause (`Space`), mute, and seeking driven by
  `requestVideoFrameCallback` (rAF fallback). The canvas follows each presented
  frame; the timeline updates the playhead from a throttled tick.
- CapCut-style timeline (`src/components/Timeline.tsx`): draggable clips,
  trim handles, ruler ticks and click-to-scrub, with a "Show all" toggle
  (`showHiddenObjects`) controlling whether off-time objects stay visible.
- Timing: every object gets a `tStart`/`tEnd` in video projects (new objects
  start at the playhead and run to the end), edited through the new
  Properties → Timing section and directly on the timeline.
- Video export (`exportMedia`) renders one full-document PNG per object with
  its time window and hands the original clip + layers to the existing
  single-pass ffmpeg pipeline (`electron/ffmpeg.ts`), showing a progress
  overlay while it runs. Save routes to video or image based on the project.

## Milestone 6 — shipped here (feature parity)

- **Blur paint & shapes** (`src/lib/blur.ts`): background-blur rectangles,
  ellipses and brush strokes sample what is drawn beneath them, blur it and paint
  it back inside the shape. The heavy pass runs in the Electron main process
  (`blurPng`); a JS box-blur fallback keeps exports and previews working. Results
  are cached per object and refreshed on content or geometry changes; the shape
  panel exposes a Paint (Color/Blur) toggle and blur strength.
- **Custom dropdowns** (`src/components/Select.tsx`): themed replacement for the
  native selects (font, brush mode, presets) using the existing `.dropdown` CSS.
- **Colour picker + eyedropper** (`src/components/ColorField.tsx`): every colour
  control (text, outline, shape fill, brush, background) has an eyedropper that
  samples the canvas.
- **Crop**: the Crop tool crops the base image (dimming + rule-of-thirds grid,
  Apply/Cancel), and image layers can be cropped in place from the image panel.
  Overlay objects are shifted to stay aligned with the base image.
- **Logo quick-access**: save an image as a logo from the on-canvas Logo button;
  it persists in preferences and drops onto the canvas with one click.
- **Base-image replace now preserves overlays** (text, stickers, shapes,
  strokes).

## Roadmap

The Electron port has reached feature parity with the Wails app. Remaining
follow-ups are polish/robustness only:

1. Playback render scaling (the original dropped preview resolution while
   playing); currently the canvas renders at full editing scale.
2. Blur cache eviction is keyed by a content signature and pruned per render —
   fine for normal projects, but large documents could use an LRU.

Packaged builds now bundle a static `ffmpeg` (`scripts/fetch-ffmpeg.mjs`, run by
`npm run package`), so video export no longer depends on a system install.

## Notes / follow-ups

- `npm run dev` injects a relaxed CSP for Fast Refresh; production uses a
  stricter policy (see `vite.config.ts`).
- The colour picker uses the native `<input type="color">` swatch plus an
  eyedropper button rather than the original fully custom HSV popover.
- Text is edited in a `<textarea>` (with the object's bidi direction applied)
  rather than the original contenteditable, but the canvas output matches.
- Selection is single-object only, so `Ctrl/Cmd + A` is intentionally not wired
  to a non-existent multi-select; `Esc` clears the current selection.
- The Go/Wails backend and config have been removed; the Electron app at the
  repository root is now the only app that is built and released.
