import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

// Themed replacement for a native <select> (native option lists can't be
// styled), matching the `.dropdown` markup in style.css.
export function Select({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`dropdown${open ? " open" : ""}`} ref={rootRef}>
      <button
        id={id}
        type="button"
        className="dropdown-toggle"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dropdown-label">{selected?.label ?? value}</span>
        <span className="dropdown-chevron">▾</span>
      </button>
      <div className="dropdown-menu" role="listbox">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            className={`dropdown-option${o.value === value ? " selected" : ""}`}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
