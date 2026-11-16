import { useEditor } from "../state/EditorContext";
import { ColorField } from "./ColorField";
import { NumberField } from "./NumberField";
import { Range } from "./Range";
import { Select } from "./Select";
import type { BackgroundPattern, BackgroundStyle, Tool } from "../types";

const TOOLS: { tool: Tool; icon: string; label: string; title: string }[] = [
  { tool: "select", icon: "▲", label: "Select", title: "Select (V)" },
  { tool: "text", icon: "T", label: "Text", title: "Text (T)" },
  { tool: "image", icon: "▣", label: "Image", title: "Add logo / image" },
  { tool: "rect", icon: "▭", label: "Rect", title: "Rectangle (R)" },
  { tool: "ellipse", icon: "◯", label: "Ellipse", title: "Ellipse (E)" },
  { tool: "crop", icon: "⛶", label: "Crop", title: "Crop image or video (C)" },
  { tool: "brush", icon: "✎", label: "Brush", title: "Brush (B)" },
];

function clampPadding(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(200, v));
}

export function Toolbar() {
  const { state, dispatch, addImageLayerDialog, commit } = useEditor();
  const bgStyle = state.backgroundStyle;

  const setPad = (key: keyof typeof state.padding, value: number) => {
    dispatch({ type: "setPadding", padding: { [key]: clampPadding(value) } });
    commit(`padding:${key}`);
  };

  const applyPaddingPreset = (padding: typeof state.padding) => {
    dispatch({ type: "setPadding", padding });
    commit("padding:preset");
  };

  const setBackground = (color: string) => {
    dispatch({ type: "setBackground", color });
    commit("background");
  };

  const setBackgroundStyle = (patch: Partial<BackgroundStyle>, key: string) => {
    dispatch({ type: "setBackgroundStyle", patch });
    commit(`background:${key}`);
  };

  return (
    <aside className="toolbar">
      <section className="tool-section">
        <h3 className="section-title">Tools</h3>
        <div className="tool-grid" id="tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={`tool${state.activeTool === t.tool ? " active" : ""}`}
              data-tool={t.tool}
              type="button"
              title={t.title}
              onClick={() => {
                if (t.tool === "image") {
                  void addImageLayerDialog();
                } else {
                  dispatch({ type: "setActiveTool", tool: t.tool });
                }
              }}
            >
              <span className="tool-icon">{t.icon}</span>
              <span className="tool-label">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tool-section">
        <h3 className="section-title">Padding</h3>
        <div className="row gap">
          <button
            id="preset-none"
            className="btn btn-sm"
            type="button"
            onClick={() => applyPaddingPreset({ top: 0, right: 0, bottom: 0, left: 0 })}
          >
            None
          </button>
          <button
            id="preset-classic"
            className="btn btn-sm"
            type="button"
            onClick={() => applyPaddingPreset({ top: 20, right: 0, bottom: 0, left: 0 })}
          >
            Classic
          </button>
          <button
            id="preset-modern"
            className="btn btn-sm"
            type="button"
            onClick={() => applyPaddingPreset({ top: 20, right: 5, bottom: 5, left: 5 })}
          >
            Modern
          </button>
        </div>
        <div className="pad-grid">
          <label>
            Top
            <NumberField
              id="pad-top"
              min={0}
              max={200}
              step={1}
              value={state.padding.top}
              onChange={(v) => setPad("top", v)}
              ariaLabel="top padding"
            />
          </label>
          <label>
            Right
            <NumberField
              id="pad-right"
              min={0}
              max={200}
              step={1}
              value={state.padding.right}
              onChange={(v) => setPad("right", v)}
              ariaLabel="right padding"
            />
          </label>
          <label>
            Bottom
            <NumberField
              id="pad-bottom"
              min={0}
              max={200}
              step={1}
              value={state.padding.bottom}
              onChange={(v) => setPad("bottom", v)}
              ariaLabel="bottom padding"
            />
          </label>
          <label>
            Left
            <NumberField
              id="pad-left"
              min={0}
              max={200}
              step={1}
              value={state.padding.left}
              onChange={(v) => setPad("left", v)}
              ariaLabel="left padding"
            />
          </label>
        </div>
        <p className="hint">Values are percentages of the image size.</p>
      </section>

      <section className="tool-section">
        <h3 className="section-title">Background</h3>
        <div className="field">
          <label>Mode</label>
          <div className="seg" id="bg-mode">
            {(
              [
                ["solid", "Solid"],
                ["lines", "Lines"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={bgStyle.mode === mode ? "active" : ""}
                data-mode={mode}
                onClick={() => setBackgroundStyle({ mode }, "mode")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="row gap">
          <button
            id="bg-white"
            className="btn btn-sm swatch-btn"
            type="button"
            title="White"
            onClick={() => setBackground("#ffffff")}
          >
            <span className="swatch" style={{ background: "#ffffff" }} /> White
          </button>
          <button
            id="bg-black"
            className="btn btn-sm swatch-btn"
            type="button"
            title="Black"
            onClick={() => setBackground("#000000")}
          >
            <span className="swatch" style={{ background: "#000000" }} /> Black
          </button>
        </div>
        <div className="field">
          <label>Custom</label>
          <ColorField
            id="bg-color"
            value={state.background}
            onChange={(v) => setBackground(v)}
          />
        </div>
        {bgStyle.mode === "lines" && (
          <>
            <div className="field">
              <label>Pattern</label>
              <Select
                id="bg-pattern"
                value={bgStyle.pattern}
                options={[
                  { value: "diagonal", label: "Diagonal" },
                  { value: "grid", label: "Grid" },
                  { value: "crosshatch", label: "Crosshatch" },
                  { value: "triangles", label: "Triangles" },
                  { value: "hexagons", label: "Hexagons" },
                  { value: "isometric", label: "Isometric" },
                  { value: "waves", label: "Waves" },
                  { value: "scales", label: "Scales" },
                  { value: "rings", label: "Rings" },
                  { value: "truchet", label: "Maze" },
                ]}
                onChange={(v) =>
                  setBackgroundStyle({ pattern: v as BackgroundPattern }, "pattern")
                }
              />
            </div>
            <div className="field">
              <label>Line color</label>
              <ColorField
                id="bg-line-color"
                value={bgStyle.lineColor}
                onChange={(v) => setBackgroundStyle({ lineColor: v }, "lineColor")}
              />
            </div>
            <div className="field">
              <label>
                Spacing <span>{bgStyle.spacing}</span>
              </label>
              <Range
                id="bg-line-spacing"
                min={12}
                max={160}
                value={bgStyle.spacing}
                onChange={(v) => setBackgroundStyle({ spacing: Math.round(v) }, "spacing")}
              />
            </div>
            <div className="field">
              <label>
                Thickness <span>{Number(bgStyle.lineWidth.toFixed(1))}</span>
              </label>
              <Range
                id="bg-line-width"
                min={0.5}
                max={6}
                step={0.5}
                value={bgStyle.lineWidth}
                onChange={(v) => setBackgroundStyle({ lineWidth: v }, "lineWidth")}
              />
            </div>
            <div className="field">
              <label>
                Opacity <span>{Math.round(bgStyle.lineOpacity * 100)}%</span>
              </label>
              <Range
                id="bg-line-opacity"
                min={0}
                max={100}
                value={Math.round(bgStyle.lineOpacity * 100)}
                onChange={(v) => setBackgroundStyle({ lineOpacity: v / 100 }, "opacity")}
              />
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
