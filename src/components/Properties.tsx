import { useEffect, useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useToast } from "./Toasts";
import { ColorField } from "./ColorField";
import { NumberField } from "./NumberField";
import { RichTextField } from "./RichTextField";
import { Select } from "./Select";
import { getSelectedObject } from "../lib/render";
import { textPresetPatch, uid, round2 } from "../lib/object";
import { DEFAULT_FONT, DEFAULT_TEXT_DIRECTION } from "../lib/constants";
import type { Align, Direction, EditorObject, TextPreset } from "../types";

function Range({
  id,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  id: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--range-progress" as string]: `${pct}%` }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  );
}

function commitKey(obj: EditorObject, patch: Partial<EditorObject>): string {
  return `${obj.id}:${Object.keys(patch).sort().join(",")}`;
}

function TextProperties({ obj }: { obj: EditorObject }) {
  const { updateObject, commit, fontFamilies } = useEditor();

  const set = (patch: Partial<EditorObject>, snap = true) => {
    updateObject(obj.id, patch);
    if (snap) commit(commitKey(obj, patch));
  };

  const families = Array.from(
    new Set([obj.fontFamily ?? "", ...fontFamilies, DEFAULT_FONT]),
  ).filter(Boolean);

  return (
    <section className="prop-section" id="prop-text">
      <h3 className="section-title">Text</h3>
      <div className="field">
        <label>Content</label>
        <RichTextField
          id="text-content"
          dir={obj.direction === "ltr" ? "ltr" : "rtl"}
          value={obj.text ?? ""}
          onChange={(v) => set({ text: v })}
        />
      </div>
      <div className="field">
        <label>Font</label>
        <Select
          id="text-font"
          value={obj.fontFamily ?? DEFAULT_FONT}
          options={families.map((f) => ({ value: f, label: f }))}
          onChange={(v) => set({ fontFamily: v })}
        />
      </div>
      <p className="hint">
        Want your own fonts? Drop <code>.ttf</code> / <code>.otf</code> files into the{" "}
        <code>fonts</code> folder next to the app and restart.
      </p>
      <div className="field">
        <label>
          Size <span>{(obj.autoFit ? obj.maxFontSize : obj.fontSize) ?? 48}</span>
        </label>
        {obj.autoFit ? (
          <Range
            id="text-maxsize-range"
            min={8}
            max={400}
            value={obj.maxFontSize ?? 24}
            onChange={(v) => set({ maxFontSize: Math.round(v) })}
          />
        ) : (
          <Range
            id="text-size"
            min={8}
            max={400}
            value={obj.fontSize ?? 48}
            onChange={(v) => set({ fontSize: Math.round(v) })}
          />
        )}
      </div>
      <label className="check">
        <input
          type="checkbox"
          id="text-autofit"
          checked={!!obj.autoFit}
          onChange={(e) => set({ autoFit: e.target.checked })}
        />{" "}
        Auto-fit to width
      </label>
      {obj.autoFit && (
        <div className="field">
          <label>Max size</label>
          <NumberField
            id="text-maxsize"
            min={8}
            max={400}
            value={obj.maxFontSize ?? 24}
            onChange={(v) => set({ maxFontSize: v })}
            ariaLabel="max size"
          />
        </div>
      )}
      <div className="field">
        <label>Alignment</label>
        <div className="seg" id="text-align">
          {(["left", "center", "right"] as Align[]).map((a) => (
            <button
              key={a}
              type="button"
              className={obj.align === a ? "active" : ""}
              data-align={a}
              onClick={() => set({ align: a })}
            >
              {a[0].toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Direction</label>
        <div className="seg" id="text-direction">
          {(
            [
              ["rtl", "RTL (فارسی)"],
              ["ltr", "LTR"],
            ] as [Direction, string][]
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              className={obj.direction === d ? "active" : ""}
              data-dir={d}
              onClick={() => set({ direction: d })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Text color</label>
        <ColorField
          id="text-color"
          value={obj.color ?? "#ffffff"}
          onChange={(v) => set({ color: v })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          id="text-outline-enabled"
          checked={!!obj.outlineEnabled}
          onChange={(e) => set({ outlineEnabled: e.target.checked })}
        />{" "}
        Outline
      </label>
      <div className="field">
        <label>Outline color</label>
        <ColorField
          id="text-outline-color"
          value={obj.outlineColor ?? "#000000"}
          onChange={(v) => set({ outlineColor: v })}
        />
      </div>
      <div className="field">
        <label>
          Outline width <span>{obj.outlineWidth ?? 4}</span>
        </label>
        <Range
          id="text-outline-width"
          min={0}
          max={40}
          value={obj.outlineWidth ?? 4}
          onChange={(v) => set({ outlineWidth: Math.round(v) })}
        />
      </div>

      <TextPresets obj={obj} />
    </section>
  );
}

function TextPresets({ obj }: { obj: EditorObject }) {
  const { state, dispatch, updateObject, commit } = useEditor();
  const { toast } = useToast();
  const [presetId, setPresetId] = useState(state.defaultPresetId ?? "");
  const [name, setName] = useState("");

  useEffect(() => {
    const match = state.textPresets.find((p) => p.fontFamily === obj.fontFamily);
    setPresetId(match ? match.id : state.defaultPresetId ?? "");
    // Re-sync only when the selected object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id]);

  const selected = state.textPresets.find((p) => p.id === presetId) ?? null;

  const saveCurrent = () => {
    const presetName =
      name.trim() || `Preset ${state.textPresets.length + 1}`;
    const preset: TextPreset = {
      id: uid(),
      name: presetName,
      fontFamily: obj.fontFamily ?? DEFAULT_FONT,
      maxFontSize: obj.maxFontSize || obj.fontSize || 48,
      align: obj.align ?? "center",
      direction: obj.direction ?? DEFAULT_TEXT_DIRECTION,
      color: obj.color ?? "#ffffff",
      outlineColor: obj.outlineColor ?? "#000000",
      outlineWidth: obj.outlineWidth ?? 4,
      outlineEnabled: !!obj.outlineEnabled,
    };
    dispatch({ type: "addTextPreset", preset });
    setPresetId(preset.id);
    setName("");
    toast(`Saved preset "${presetName}"`);
  };

  const apply = () => {
    if (!selected) {
      toast("No preset selected", "error");
      return;
    }
    updateObject(obj.id, textPresetPatch(selected));
    commit();
    toast(`Applied "${selected.name}"`);
  };

  const rename = () => {
    if (!selected) {
      toast("No preset selected", "error");
      return;
    }
    const next = name.trim();
    if (!next) {
      toast("Enter a new name", "error");
      return;
    }
    dispatch({ type: "updateTextPreset", id: selected.id, patch: { name: next } });
    setName("");
    toast("Preset renamed");
  };

  const remove = () => {
    if (!selected) {
      toast("No preset selected", "error");
      return;
    }
    dispatch({ type: "removeTextPreset", id: selected.id });
    setPresetId("");
    toast("Preset deleted");
  };

  const setDefault = () => {
    if (!selected) {
      toast("No preset selected", "error");
      return;
    }
    dispatch({ type: "setDefaultPreset", id: selected.id });
    toast(`"${selected.name}" is now the default for new text`);
  };

  return (
    <div className="presets">
      <h4>Text presets</h4>
      <Select
        id="preset-select"
        value={presetId}
        options={
          state.textPresets.length === 0
            ? [{ value: "", label: "No presets saved" }]
            : state.textPresets.map((p) => ({
                value: p.id,
                label: p.id === state.defaultPresetId ? `${p.name} (default)` : p.name,
              }))
        }
        onChange={(v) => setPresetId(v)}
      />
      <div className="row gap">
        <button id="preset-apply" className="btn btn-sm" type="button" onClick={apply}>
          Apply
        </button>
        <button
          id="preset-delete"
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={remove}
        >
          Delete
        </button>
      </div>
      <div className="row gap">
        <input
          type="text"
          id="preset-name"
          placeholder="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button id="preset-save" className="btn btn-sm" type="button" onClick={saveCurrent}>
          Save current
        </button>
      </div>
      <button
        id="preset-rename"
        className="btn btn-sm btn-ghost"
        type="button"
        onClick={rename}
      >
        Rename selected
      </button>
      <button
        id="preset-set-default"
        className="btn btn-sm btn-ghost"
        type="button"
        onClick={setDefault}
      >
        Set as default for new text
      </button>
    </div>
  );
}

function ShapeProperties({ obj }: { obj: EditorObject }) {
  const { updateObject, commit } = useEditor();
  const set = (patch: Partial<EditorObject>) => {
    updateObject(obj.id, patch);
    commit(commitKey(obj, patch));
  };
  const mode = obj.mode === "blur" ? "blur" : "fill";
  return (
    <section className="prop-section" id="prop-shape">
      <h3 className="section-title">Shape</h3>
      <div className="field">
        <label>Paint</label>
        <div className="seg" id="shape-mode">
          {(
            [
              ["fill", "Color"],
              ["blur", "Blur"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "active" : ""}
              data-mode={m}
              onClick={() => set({ mode: m })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "fill" && (
        <div className="field">
          <label>Fill</label>
          <ColorField
            id="shape-fill"
            value={obj.fill ?? "#232733"}
            onChange={(v) => set({ fill: v })}
          />
        </div>
      )}
      {mode === "blur" && (
        <div className="field">
          <label>
            Blur strength <span>{obj.blurRadius ?? 16}</span>
          </label>
          <Range
            id="shape-blur"
            min={1}
            max={150}
            value={obj.blurRadius ?? 16}
            onChange={(v) => set({ blurRadius: Math.round(v) })}
          />
        </div>
      )}
      {obj.type === "rect" && mode === "fill" && (
        <div className="field">
          <label>
            Corner radius <span>{obj.radius ?? 12}</span>
          </label>
          <Range
            id="shape-radius"
            min={0}
            max={200}
            value={obj.radius ?? 12}
            onChange={(v) => set({ radius: Math.round(v) })}
          />
        </div>
      )}
    </section>
  );
}

function ImageProperties({ obj }: { obj: EditorObject }) {
  const { state, updateObject, commit, startImageCrop, applyImageCrop, cancelImageCrop } =
    useEditor();
  const set = (patch: Partial<EditorObject>) => {
    updateObject(obj.id, patch);
    commit(commitKey(obj, patch));
  };
  const cropping = state.imageCrop?.objectId === obj.id;
  const r = state.imageCrop?.rect;
  return (
    <section className="prop-section" id="prop-image">
      <h3 className="section-title">Image layer</h3>
      <div className="field">
        <label>
          Opacity <span>{Math.round((obj.opacity ?? 1) * 100)}</span>%
        </label>
        <Range
          id="image-opacity"
          min={0}
          max={100}
          value={Math.round((obj.opacity ?? 1) * 100)}
          onChange={(v) => set({ opacity: v / 100 })}
        />
      </div>
      <div className="pad-grid">
        <label>
          Width
          <NumberField
            id="image-width"
            min={1}
            value={Math.round(obj.width ?? 0)}
            onChange={(v) => set({ width: v })}
            ariaLabel="width"
          />
        </label>
        <label>
          Height
          <NumberField
            id="image-height"
            min={1}
            value={Math.round(obj.height ?? 0)}
            onChange={(v) => set({ height: v })}
            ariaLabel="height"
          />
        </label>
      </div>
      {!cropping ? (
        <div className="field">
          <button id="image-crop-start" className="btn btn-sm" type="button" onClick={startImageCrop}>
            Crop image
          </button>
        </div>
      ) : (
        <div>
          <p className="hint">Drag over the image to choose the area to keep.</p>
          <div className="row gap">
            <button
              id="image-crop-apply"
              className="btn btn-sm btn-primary"
              type="button"
              disabled={!r || r.width < 2 || r.height < 2}
              onClick={applyImageCrop}
            >
              Apply crop
            </button>
            <button
              id="image-crop-cancel"
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={cancelImageCrop}
            >
              Cancel
            </button>
          </div>
          <p className="hint">
            {r && r.width >= 2 && r.height >= 2
              ? `${Math.round(r.width)} × ${Math.round(r.height)} px`
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function BrushProperties() {
  const { state, dispatch } = useEditor();
  const brush = state.brush;
  return (
    <section className="prop-section" id="prop-brush">
      <h3 className="section-title">Brush</h3>
      <div className="field">
        <label>Mode</label>
        <Select
          id="brush-mode"
          value={brush.mode}
          options={[
            { value: "draw", label: "Draw" },
            { value: "cover", label: "Cover / Remove" },
            { value: "blur", label: "Blur background" },
          ]}
          onChange={(v) => dispatch({ type: "setBrush", patch: { mode: v as never } })}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorField
          id="brush-color"
          value={brush.color}
          onChange={(v) => dispatch({ type: "setBrush", patch: { color: v } })}
        />
      </div>
      <div className="field">
        <label>
          Size <span>{brush.size}</span>
        </label>
        <Range
          id="brush-size"
          min={1}
          max={120}
          value={brush.size}
          onChange={(v) => dispatch({ type: "setBrush", patch: { size: Math.round(v) } })}
        />
      </div>
      {brush.mode === "blur" && (
        <div className="field">
          <label>
            Blur strength <span>{brush.blurRadius}</span>
          </label>
          <Range
            id="brush-blur"
            min={1}
            max={150}
            value={brush.blurRadius}
            onChange={(v) => dispatch({ type: "setBrush", patch: { blurRadius: Math.round(v) } })}
          />
        </div>
      )}
      <button
        id="btn-cover-bg"
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => dispatch({ type: "setBrush", patch: { color: state.background } })}
      >
        Use background color
      </button>
    </section>
  );
}

function ArrangeProperties({ obj }: { obj: EditorObject }) {
  const { deleteSelected, bringForward, sendBackward, updateObject, commit } = useEditor();
  const setRotation = (rotation: number) => {
    updateObject(obj.id, { rotation });
    commit(`${obj.id}:rotation`);
  };
  return (
    <>
      <section className="prop-section" id="prop-transform">
        <h3 className="section-title">Transform</h3>
        <div className="field">
          <label>
            Rotation <span>{Math.round(obj.rotation ?? 0)}</span>°
          </label>
          <Range
            id="rotation-range"
            min={-180}
            max={180}
            value={Math.round(obj.rotation ?? 0)}
            onChange={(v) => setRotation(v)}
          />
        </div>
        <div className="row gap">
          <NumberField
            id="rotation-input"
            min={-360}
            max={360}
            value={Math.round(obj.rotation ?? 0)}
            onChange={(v) => setRotation(v)}
            ariaLabel="rotation"
          />
          <button
            id="rotation-reset"
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => setRotation(0)}
          >
            Reset
          </button>
        </div>
      </section>
      <section className="prop-section" id="prop-order">
        <h3 className="section-title">Arrange</h3>
        <div className="row gap">
          <button id="order-forward" className="btn btn-sm" type="button" onClick={bringForward}>
            Bring forward
          </button>
          <button id="order-backward" className="btn btn-sm" type="button" onClick={sendBackward}>
            Send backward
          </button>
        </div>
        <div className="row gap">
          <button id="btn-delete" className="btn btn-sm btn-danger" type="button" onClick={deleteSelected}>
            Delete selected
          </button>
        </div>
      </section>
    </>
  );
}

function TimingProperties({ obj }: { obj: EditorObject }) {
  const { state, updateObject, commit, getPlayhead } = useEditor();
  const duration = state.video.duration || 0;
  const start = obj.tStart ?? 0;
  const end = obj.tEnd ?? duration;
  const set = (patch: Partial<EditorObject>) => {
    updateObject(obj.id, patch);
    commit(`${obj.id}:timing`);
  };
  const clampT = (v: number) => Math.max(0, Math.min(duration, v));

  return (
    <section className="prop-section" id="prop-time">
      <h3 className="section-title">Timing</h3>
      <p className="hint">When this object shows during the video.</p>
      <div className="pad-grid">
        <label>
          Start (s)
          <NumberField
            id="time-start"
            min={0}
            max={duration}
            step={0.1}
            value={round2(start)}
            onChange={(v) => set({ tStart: clampT(v) })}
            ariaLabel="start time"
          />
        </label>
        <label>
          End (s)
          <NumberField
            id="time-end"
            min={0}
            max={duration}
            step={0.1}
            value={round2(end)}
            onChange={(v) => set({ tEnd: clampT(v) })}
            ariaLabel="end time"
          />
        </label>
      </div>
      <div className="row gap">
        <button
          id="time-start-here"
          className="btn btn-sm"
          type="button"
          onClick={() => set({ tStart: round2(clampT(getPlayhead())) })}
        >
          Start at playhead
        </button>
        <button
          id="time-end-here"
          className="btn btn-sm"
          type="button"
          onClick={() => set({ tEnd: round2(clampT(getPlayhead())) })}
        >
          End at playhead
        </button>
      </div>
      <div className="row gap">
        <button
          id="time-whole"
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={() => set({ tStart: 0, tEnd: duration })}
        >
          Whole clip
        </button>
      </div>
    </section>
  );
}

function CropProperties() {
  const { state, applyCrop, cancelCrop, resetVideoCrop } = useEditor();
  const r = state.cropRect;
  const isVideo = state.mediaType === "video";
  return (
    <section className="prop-section" id="prop-crop">
      <h3 className="section-title">Crop</h3>
      <p className="hint">
        Drag over the {isVideo ? "video" : "base image"} to choose the area to keep.
      </p>
      {isVideo && (
        <p className="hint">
          The original video is untouched — only the selected part is shown and saved.
        </p>
      )}
      <div className="row gap">
        <button
          id="crop-apply"
          className="btn btn-sm btn-primary"
          type="button"
          disabled={!r || r.width < 2 || r.height < 2}
          onClick={applyCrop}
        >
          Apply crop
        </button>
        <button id="crop-cancel" className="btn btn-sm btn-ghost" type="button" onClick={cancelCrop}>
          Cancel
        </button>
      </div>
      {isVideo && state.videoCrop && (
        <div className="row gap">
          <button
            id="crop-reset"
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={resetVideoCrop}
          >
            Reset crop
          </button>
        </div>
      )}
      <p className="hint">
        {r && r.width >= 2 && r.height >= 2
          ? `${Math.round(r.width)} × ${Math.round(r.height)} px`
          : ""}
      </p>
    </section>
  );
}

export function Properties() {
  const { state } = useEditor();
  const selected = getSelectedObject(state);

  if (state.cropActive) {
    return (
      <aside className="properties" id="properties">
        <CropProperties />
      </aside>
    );
  }

  return (
    <aside className="properties" id="properties">
      {state.activeTool === "brush" && <BrushProperties />}

      {state.activeTool !== "brush" && !selected && (
        <section className="prop-section" id="prop-empty">
          <h3 className="section-title">Properties</h3>
          <p className="muted">
            {state.started ? "Nothing selected." : "Start a project to begin editing."}
          </p>
        </section>
      )}

      {state.activeTool !== "brush" && selected?.type === "text" && <TextProperties obj={selected} />}
      {state.activeTool !== "brush" &&
        (selected?.type === "rect" || selected?.type === "ellipse") && (
          <ShapeProperties obj={selected} />
        )}
      {state.activeTool !== "brush" && selected?.type === "image" && <ImageProperties obj={selected} />}
      {state.activeTool !== "brush" && state.mediaType === "video" && selected && (
        <TimingProperties obj={selected} />
      )}
      {state.activeTool !== "brush" && selected && <ArrangeProperties obj={selected} />}
    </aside>
  );
}
