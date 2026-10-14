import { useEditor } from "../state/EditorContext";

export function TopBar({ onRestart }: { onRestart: () => void }) {
  const { state, openImageDialog, openVideoDialog, replaceImageDialog, exportMedia, undo, redo } =
    useEditor();
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;
  const isVideo = state.mediaType === "video";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">ME</span>
        <span className="brand-name">Meme Editor</span>
      </div>
      <div className="topbar-actions">
        <button
          id="btn-undo"
          className="btn btn-icon"
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
        >
          ↶
        </button>
        <button
          id="btn-redo"
          className="btn btn-icon"
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          ↷
        </button>
        <button id="btn-open" className="btn" type="button" onClick={() => void openImageDialog()}>
          Open Image
        </button>
        <button
          id="btn-open-video"
          className="btn"
          type="button"
          onClick={() => void openVideoDialog()}
        >
          Open Video
        </button>
        <button
          id="btn-replace"
          className="btn"
          type="button"
          disabled={!state.started}
          onClick={() => void (isVideo ? openVideoDialog() : replaceImageDialog())}
        >
          {isVideo ? "Replace Video" : "Replace Image"}
        </button>
        <button
          id="btn-save"
          className="btn btn-primary"
          type="button"
          onClick={() => void exportMedia()}
        >
          {isVideo ? "Save Video" : "Save Image"}
        </button>
        <button
          id="btn-restart"
          className="btn btn-danger"
          type="button"
          title="Discard everything and start over"
          onClick={onRestart}
        >
          Restart
        </button>
      </div>
    </header>
  );
}
