import { useEditor } from "../state/EditorContext";

export function StartOverlay() {
  const { state, dispatch, openImageDialog, openVideoDialog, startEmpty } = useEditor();
  const sc = state.startCanvas;

  const clampInt = (value: string, fallback: number): number => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(1, Math.min(10000, n));
  };

  return (
    <div className={`start-overlay${state.started ? " hidden" : ""}`} id="start-overlay">
      <div className="start-card">
        <div className="start-head">
          <span className="brand-mark">ME</span>
          <div>
            <h2>Start a project</h2>
            <p className="muted">Open an image or video, or begin with an empty canvas.</p>
          </div>
        </div>
        <div className="start-grid">
          <div className="start-option">
            <h3>Open an image</h3>
            <p className="muted">Edit a meme from a photo on your computer.</p>
            <button id="start-open" className="btn btn-primary" type="button" onClick={() => void openImageDialog()}>
              Open image
            </button>
          </div>
          <div className="start-option">
            <h3>Open a video</h3>
            <p className="muted">Make a video meme with timed text, shapes and stickers.</p>
            <button
              id="start-open-video"
              className="btn"
              type="button"
              onClick={() => void openVideoDialog()}
            >
              Open video
            </button>
          </div>
          <div className="start-option">
            <h3>Empty canvas</h3>
            <div className="pad-grid">
              <label>
                Width{" "}
                <input
                  type="number"
                  id="start-width"
                  min={1}
                  max={10000}
                  step={1}
                  value={sc.width}
                  onChange={(e) =>
                    dispatch({ type: "setStartCanvas", patch: { width: clampInt(e.target.value, 800) } })
                  }
                />
              </label>
              <label>
                Height{" "}
                <input
                  type="number"
                  id="start-height"
                  min={1}
                  max={10000}
                  step={1}
                  value={sc.height}
                  onChange={(e) =>
                    dispatch({ type: "setStartCanvas", patch: { height: clampInt(e.target.value, 600) } })
                  }
                />
              </label>
            </div>
            <div className="field">
              <label>Background</label>
              <input
                type="color"
                id="start-bg"
                value={sc.background}
                onChange={(e) => dispatch({ type: "setStartCanvas", patch: { background: e.target.value } })}
              />
            </div>
            <button
              id="start-empty"
              className="btn"
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
