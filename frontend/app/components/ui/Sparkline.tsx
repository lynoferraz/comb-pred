// Tiny trend line. Inline SVG is the right tool for a sparkline this small.

export default function Sparkline({
  values,
  w = 64,
  h = 36,
  color = "var(--color-accent)",
  fill = false,
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}) {
  if (!values || values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className="block overflow-visible">
      {fill && (
        <polygon
          points={`0,${h} ${pts.join(" ")} ${w},${h}`}
          fill={color}
          fillOpacity={0.12}
        />
      )}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
