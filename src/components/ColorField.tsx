import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "../state/EditorContext";

// Custom colour picker ported from the Wails app: a swatch button opens a
// popover with a saturation/value square, a hue slider, a hex field, an
// eyedropper and a row of preset swatches. All of the styling lives in
// style.css (`.color-field`, `.cp-*`).

const PRESET_COLORS = [
  "#ffffff",
  "#000000",
  "#ff0000",
  "#ff8c00",
  "#ffd400",
  "#22c55e",
  "#0ea5e9",
  "#6c8cff",
  "#a855f7",
  "#ec4899",
];

interface HSV {
  h: number;
  s: number;
  v: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  let s = String(hex).trim().replace(/^#/, "");
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

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
  const fieldRef = useRef<HTMLDivElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const hexFocused = useRef(false);
  const lastEmitted = useRef(value);

  const initialRgb = hexToRgb(value) ?? { r: 0, g: 0, b: 0 };
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b));
  const hsvRef = useRef(hsv);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [hexText, setHexText] = useState(value);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

  hsvRef.current = hsv;

  // Adopt the parent value when it changes from the outside (e.g. a preset or
  // the eyedropper) without clobbering the live hue while dragging.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const parsed = hexToRgb(value);
    if (!parsed) return;
    lastEmitted.current = value;
    const next = rgbToHsv(parsed.r, parsed.g, parsed.b);
    hsvRef.current = next;
    setHsv(next);
  }, [value]);

  useEffect(() => {
    if (!hexFocused.current) setHexText(hex);
  }, [hex]);

  const emit = (next: HSV) => {
    hsvRef.current = next;
    setHsv(next);
    const c = hsvToRgb(next.h, next.s, next.v);
    const nextHex = rgbToHex(c.r, c.g, c.b);
    lastEmitted.current = nextHex;
    onChange(nextHex);
  };

  const applyHex = (raw: string) => {
    const parsed = hexToRgb(raw);
    if (!parsed) return;
    const next = rgbToHsv(parsed.r, parsed.g, parsed.b);
    lastEmitted.current = rgbToHex(parsed.r, parsed.g, parsed.b);
    hsvRef.current = next;
    setHsv(next);
    onChange(lastEmitted.current);
  };

  const position = () => {
    const swatch = swatchRef.current;
    const pop = popRef.current;
    if (!swatch || !pop) return;
    const r = swatch.getBoundingClientRect();
    const h = pop.offsetHeight || 320;
    const left = clamp(r.left, 8, Math.max(8, window.innerWidth - 240));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight && r.top - 8 - h > 0) top = r.top - 8 - h;
    setPos({ left, top });
  };

  useLayoutEffect(() => {
    if (open) position();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (fieldRef.current && !fieldRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest(".color-popover")) return;
      setOpen(false);
    };
    const onResize = () => position();
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const beginDrag = (
    el: HTMLElement | null,
    compute: (x: number, y: number) => void,
  ) => (e: ReactPointerEvent) => {
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    compute(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => compute(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onSvDown = beginDrag(svRef.current, (x, y) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    emit({
      ...hsvRef.current,
      s: clamp((x - r.left) / r.width, 0, 1),
      v: 1 - clamp((y - r.top) / r.height, 0, 1),
    });
  });

  const onHueDown = beginDrag(hueRef.current, (x) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    emit({ ...hsvRef.current, h: clamp((x - r.left) / r.width, 0, 1) * 360 });
  });

  return (
    <div className={`color-field${open ? " open" : ""}`} ref={fieldRef}>
      <button
        type="button"
        className="color-swatch"
        ref={swatchRef}
        style={{ background: value }}
        title={value}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          const parsed = hexToRgb(value);
          if (parsed) {
            const next = rgbToHsv(parsed.r, parsed.g, parsed.b);
            hsvRef.current = next;
            setHsv(next);
          }
          position();
          setOpen(true);
        }}
      />
      <input
        id={id}
        type="color"
        className="color-native"
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => applyHex(e.target.value)}
      />
      <div className="color-popover" ref={popRef} style={pos ? { left: pos.left, top: pos.top } : undefined}>
        <div
          className="cp-sv"
          ref={svRef}
          style={{
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
          }}
          onPointerDown={onSvDown}
        >
          <div className="cp-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div className="cp-hue" ref={hueRef} onPointerDown={onHueDown}>
          <div className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="cp-row">
          <input
            type="text"
            className="cp-hex"
            maxLength={7}
            spellCheck={false}
            value={hexText}
            onFocus={() => {
              hexFocused.current = true;
            }}
            onBlur={() => {
              hexFocused.current = false;
              const parsed = hexToRgb(hexText);
              if (parsed) applyHex(hexText);
              setHexText(hex);
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setHexText(raw);
              if (hexToRgb(raw)) applyHex(raw);
            }}
          />
          <button
            type="button"
            className="cp-eyedropper"
            title="Pick a color from the canvas"
            aria-label="Pick a color from the canvas"
            onClick={(e) => {
              e.stopPropagation();
              startEyedropper((picked) => {
                applyHex(picked);
                setOpen(false);
              });
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m2 22 1-1h3l9-9" />
              <path d="M3 21v-3l9-9" />
              <path d="m15 6 3-3a2.1 2.1 0 0 1 3 3l-3 3" />
              <path d="m11 10 4 4" />
            </svg>
          </button>
        </div>
        <div className="cp-swatches">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`cp-swatch${hex.toLowerCase() === c ? " active" : ""}`}
              style={{ background: c }}
              onClick={(e) => {
                e.stopPropagation();
                applyHex(c);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
