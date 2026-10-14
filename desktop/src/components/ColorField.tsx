import { useEditor } from "../state/EditorContext";

// A colour swatch plus an eyedropper button that samples the canvas.
export function ColorField({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { startEyedropper } = useEditor();
  return (
    <div className="color-row">
      <input type="color" id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        className="eyedrop-btn"
        title="Pick a color from the canvas"
        onClick={() => startEyedropper(onChange)}
      >
        ⌖
      </button>
    </div>
  );
}
