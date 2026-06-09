"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { STATE_COLORS } from "../../lib/format";

const axisStyle = {
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  fill: "var(--color-ink3)",
};

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-surface border border-line rounded-lg px-3 py-2 shadow-lg text-xs">
      {label !== undefined && (
        <div className="text-ink3 mb-1 font-mono">{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: p.color as string }}
          />
          <span className="text-ink2">{p.name}</span>
          <span className="text-ink font-semibold ml-auto">
            {typeof p.value === "number" ? p.value.toFixed(3) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Binary probability over time (area).
export function ProbabilityAreaChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id="probArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          name="P(Yes)"
          stroke="var(--color-accent)"
          strokeWidth={2.25}
          fill="url(#probArea)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Multiple state probabilities over time (lines).
export function MultiLineChart({
  labels,
  series,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
}) {
  const rows = labels.map((label, i) => {
    const row: Record<string, number | string> = { label };
    series.forEach((s) => {
      row[s.name] = s.values[i];
    });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={<ChartTooltip />} />
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={STATE_COLORS[i % STATE_COLORS.length]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Two-series balance chart: expected (filled, accent) + free funds (line, ink2).
export function BalanceChart({
  data,
  valueFormatter = (v) => v.toFixed(4),
}: {
  data: { label: string; expected: number; free: number }[];
  valueFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="balExpected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={valueFormatter}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={64}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="expected"
          name="Expected"
          stroke="var(--color-accent)"
          strokeWidth={2.25}
          fill="url(#balExpected)"
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="free"
          name="Free funds"
          stroke="var(--color-ink2)"
          strokeWidth={1.75}
          strokeDasharray="4 4"
          fill="transparent"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Free-domain area chart (portfolio equity / balance history).
export function EquityChart({
  data,
  valueFormatter = (v) => v.toFixed(4),
}: {
  data: { label: string; value: number }[];
  valueFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="equityArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis
          tickFormatter={valueFormatter}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={64}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          name="ETH"
          stroke="var(--color-accent)"
          strokeWidth={2.25}
          fill="url(#equityArea)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
