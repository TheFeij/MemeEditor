// Themed range slider. The CSS uses `--range-progress` to paint the filled
// portion of the track, so every caller gets the same look.
export function Range({
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
