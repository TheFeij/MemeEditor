import { useEditor } from "../state/EditorContext";
import { NumberField } from "./NumberField";

export function StartOverlay() {
  const { state, dispatch, openImageDialog, openVideoDialog, startEmpty } = useEditor();
  const sc = state.startCanvas;

  return (
    <div className={`start-overlay${state.started ? " hidden" : ""}`} id="start-overlay">
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
