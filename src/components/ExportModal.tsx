import { useEffect } from "react";
import { useEditor } from "../state/EditorContext";
import { Select } from "./Select";
import { computeDocumentSize } from "../lib/document";
import {
  VIDEO_CODEC_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  computeOutputSize,
  hardwareApplies,
  hardwareOptionsFor,
} from "../lib/video";
import type { VideoCodec, VideoHardware, VideoResolution } from "../types";

// Export settings are chosen here, right before saving, instead of living in
// the properties panel.
export function ExportModal() {
  const { state, dispatch, exportDialogOpen, confirmExportVideo, cancelExportVideo, exporting } =
    useEditor();

  useEffect(() => {
    if (!exportDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelExportVideo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exportDialogOpen, cancelExportVideo]);

  const doc = computeDocumentSize(state.baseImage, state.padding);
  const out = computeOutputSize(doc.width, doc.height, state.video.resolution);
  const applies = hardwareApplies(state.video.codec);

  const setCodec = (value: string) => {
    const codec = value as VideoCodec;
    dispatch({ type: "setVideoState", patch: { codec } });
    if (!hardwareApplies(codec) && state.video.hardware !== "software") {
      dispatch({ type: "setVideoState", patch: { hardware: "software" } });
    }
  };

  return (
    <div className={`confirm-overlay${exportDialogOpen ? "" : " hidden"}`} id="export-overlay">
      <div className="confirm-card" id="export-card">
        <h3>Save video</h3>
        <p className="muted">Choose the export settings, then save.</p>
        <div className="field">
          <label>Resolution</label>
          <Select
            id="export-resolution"
            value={state.video.resolution}
            options={VIDEO_RESOLUTION_OPTIONS}
            onChange={(v) =>
              dispatch({
                type: "setVideoState",
                patch: { resolution: v as VideoResolution },
              })
            }
          />
        </div>
        <p className="hint">
          Output: {out.width} × {out.height} px
        </p>
        <div className="field">
          <label>Codec</label>
          <Select
            id="export-codec"
            value={state.video.codec}
            options={VIDEO_CODEC_OPTIONS}
            onChange={setCodec}
          />
        </div>
        <div className="field">
          <label>Hardware</label>
          <Select
            id="export-hardware"
            value={state.video.hardware}
            options={hardwareOptionsFor(state.video.codec)}
            onChange={(v) =>
              dispatch({
                type: "setVideoState",
                patch: { hardware: v as VideoHardware },
              })
            }
            disabled={!applies}
          />
        </div>
        {!applies ? (
          <p className="hint">This codec encodes on the CPU only.</p>
        ) : (
          state.video.hardware !== "software" && (
            <p className="hint">Falls back to the CPU encoder if the GPU isn&apos;t available.</p>
          )
        )}
        <div className="row gap">
          <button
            id="export-cancel"
            className="btn"
            type="button"
            onClick={cancelExportVideo}
            disabled={exporting}
          >
            Cancel
          </button>
          <button
            id="export-confirm"
            className="btn btn-primary"
            type="button"
            onClick={() => void confirmExportVideo()}
            disabled={exporting}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
