import { useEditor } from "../state/EditorContext";
import { NumberField } from "./NumberField";

export function StartOverlay() {
  const { state, dispatch, openImageDialog, openVideoDialog, startEmpty } = useEditor();
  const sc = state.startCanvas;

  return (
    <div className={`start-overlay${state.started ? " hidden" : ""}`} id="start-overlay">
      <div className="start-bg" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
        <div className="grid-floor" />
        {[
          { e: "😂", x: "8%",  size: 34, dur: 19, delay: 0 },
          { e: "🐸", x: "22%", size: 28, dur: 23, delay: 4 },
          { e: "🔥", x: "38%", size: 30, dur: 17, delay: 8 },
          { e: "💀", x: "55%", size: 36, dur: 21, delay: 2 },
          { e: "🗿", x: "70%", size: 32, dur: 25, delay: 6 },
          { e: "😎", x: "84%", size: 28, dur: 18, delay: 10 },
          { e: "🤡", x: "93%", size: 34, dur: 22, delay: 13 },
        ].map((f, i) => (
            <span
                key={i}
                className="float-emoji"
                style={{ "--x": f.x, "--size": `${f.size}px`, "--dur": `${f.dur}s`, "--delay": `${f.delay}s` } as React.CSSProperties}
            >
      {f.e}
    </span>
        ))}
      </div>

      <div className="start-page">
        <header className="start-head">
          <span className="brand-mark">ME</span>
          <div>
            <h1>Meme Editor</h1>
            <p className="muted">Choose how you want to start.</p>
          </div>
        </header>
        <div className="start-grid">
          <button
            id="start-open"
            className="start-option start-option-action"
            type="button"
            onClick={() => void openImageDialog()}
          >
            <span className="start-option-icon">🖼️</span>
            <h3>Open an image</h3>
            <p className="muted">Edit a meme from a photo on your computer.</p>
          </button>
          <button
            id="start-open-video"
            className="start-option start-option-action"
            type="button"
            onClick={() => void openVideoDialog()}
          >
            <span className="start-option-icon">🎬</span>
            <h3>Open a video</h3>
            <p className="muted">Make a video meme with timed text, shapes and stickers.</p>
          </button>
          <div className="start-option" id="start-empty-card">
            <span className="start-option-icon">▦</span>
            <h3>Empty canvas</h3>
            <p className="muted">Start from scratch with a blank, black canvas.</p>
            <div className="pad-grid">
              <label>
                Width
                <NumberField
                  id="start-width"
                  min={1}
                  max={10000}
                  step={1}
                  value={sc.width}
                  onChange={(v) => dispatch({ type: "setStartCanvas", patch: { width: v } })}
                  ariaLabel="canvas width"
                />
              </label>
              <label>
                Height
                <NumberField
                  id="start-height"
                  min={1}
                  max={10000}
                  step={1}
                  value={sc.height}
                  onChange={(v) => dispatch({ type: "setStartCanvas", patch: { height: v } })}
                  ariaLabel="canvas height"
                />
              </label>
            </div>
            <button
              id="start-empty"
              className="btn btn-primary start-option-cta"
              type="button"
              onClick={() => startEmpty(sc.width, sc.height, sc.background)}
            >
              Create canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
