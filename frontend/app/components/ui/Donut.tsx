"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// Probability ring. Uses recharts PieChart for the arc (avoids stroke-cap
// distortion on small/large values) and an HTML overlay for the center text
// so CSS variables resolve reliably even on dark backgrounds.
export default function Donut({
  p,
  size = 64,
  strokeW = 8,
  label,
  color = "var(--color-accent)",
  trackColor = "var(--color-line)",
  textColor = "var(--color-ink)",
  subTextColor = "var(--color-ink3)",
}: {
  p: number;
  size?: number;
  strokeW?: number;
  label?: string;
  color?: string;
  trackColor?: string;
  textColor?: string;
  subTextColor?: string;
}) {
  const safe = Math.max(0, Math.min(1, isFinite(p) ? p : 0));
  // recharts can't render a single full slice cleanly when one slice is 0,
  // so nudge both values to avoid a degenerate pie at p=0 or p=1.
  const a = Math.max(1e-4, safe);
  const b = Math.max(1e-4, 1 - safe);
  const data = [
    { name: "yes", value: a },
    { name: "no", value: b },
  ];
  const outerR = size / 2;
  const innerR = Math.max(0, outerR - strokeW);
  return (
    <div
      style={{ width: size, height: size, position: "relative" }}
      className="shrink-0"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            innerRadius={innerR}
            outerRadius={outerR}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={color} />
            <Cell fill={trackColor} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div
        className="absolute inset-0 grid place-items-center pointer-events-none"
        style={{ color: textColor }}
      >
        <div className="flex flex-col items-center leading-none">
          <span style={{ fontSize: size * 0.28, fontWeight: 600 }}>
            {Math.round(safe * 100)}
            <span style={{ fontSize: size * 0.16, opacity: 0.7 }}>%</span>
          </span>
          {label && (
            <span
              className="mt-1"
              style={{ fontSize: size * 0.12, color: subTextColor }}
            >
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
