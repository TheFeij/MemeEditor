import { useEffect, useRef, useState } from "react";

// Themed number input with − / + steppers, matching the Wails app's
// `.num-input` control. Keeps a local text buffer so the field can be cleared
// and retyped, committing clamped values on input and normalising on blur.
export function NumberField({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  const decimals = (String(step).split(".")[1] || "").length;

  const round = (n: number) => {
    const r = decimals ? parseFloat(n.toFixed(decimals)) : Math.round(n);
    return Object.is(r, -0) ? 0 : r;
  };

  const clamp = (n: number) => {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return round(v);
  };

  const [text, setText] = useState(String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  const stepBy = (dir: number) => {
    const cur = parseFloat(text);
    const base = Number.isNaN(cur) ? value : cur;
    const next = clamp(base + dir * (step || 1));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="num-input">
      <button
        type="button"
        className="num-btn"
        tabIndex={-1}
        aria-label={ariaLabel ? `Decrease ${ariaLabel}` : "Decrease"}
        onClick={() => stepBy(-1)}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = parseFloat(raw);
          if (!Number.isNaN(n)) {
            const next = clamp(n);
            if (next !== value) onChange(next);
          }
        }}
        onBlur={() => {
          editing.current = false;
          const n = parseFloat(text);
          const next = Number.isNaN(n) ? value : clamp(n);
          setText(String(next));
          if (next !== value) onChange(next);
        }}
      />
      <button
        type="button"
        className="num-btn"
        tabIndex={-1}
        aria-label={ariaLabel ? `Increase ${ariaLabel}` : "Increase"}
        onClick={() => stepBy(1)}
      >
        +
      </button>
    </div>
  );
}
