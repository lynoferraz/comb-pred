"use client";

import { useRef, useEffect } from "react";

const CHART_COLORS = [
  "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface LineChartProps {
  title: string;
  data: { label: string; values: number[] }[];
  labels?: string[];
  width?: number;
  height?: number;
  stacked?: boolean;
}

export default function SimpleChart({
  title,
  data,
  labels,
  width = 600,
  height = 250,
  stacked = false,
}: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0 || data[0].values.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const pad = { top: 30, right: 20, bottom: 30, left: 60 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const numPoints = data[0].values.length;
    if (numPoints === 0) return;

    // Compute y range — zoom to data span
    let yMin = Infinity;
    let yMax = -Infinity;
    if (stacked) {
      for (let i = 0; i < numPoints; i++) {
        let sum = 0;
        for (const series of data) sum += series.values[i] || 0;
        yMin = Math.min(yMin, 0);
        yMax = Math.max(yMax, sum);
      }
    } else {
      for (const series of data) {
        for (const v of series.values) {
          yMin = Math.min(yMin, v);
          yMax = Math.max(yMax, v);
        }
      }
    }
    if (!isFinite(yMin)) yMin = 0;
    if (!isFinite(yMax)) yMax = 1;
    const span = yMax - yMin || 1;
    yMin = yMin - span * 0.05;
    yMax = yMax + span * 0.05;
    if (stacked && yMin > 0) yMin = 0;
    const yRange = yMax - yMin;

    const xStep = numPoints > 1 ? chartW / (numPoints - 1) : chartW;

    // Title
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(title.toUpperCase(), pad.left, 16);

    // Axes
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + chartH);
    ctx.lineTo(pad.left + chartW, pad.top + chartH);
    ctx.stroke();

    // Y labels with smart formatting
    const formatTick = (val: number): string => {
      const abs = Math.abs(val);
      if (abs === 0) return "0";
      if (abs >= 1e6) return val.toExponential(1);
      if (abs >= 1) return val.toFixed(Math.max(0, 2 - Math.floor(Math.log10(abs))));
      if (abs >= 0.01) return val.toFixed(3);
      return val.toExponential(1);
    };

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const val = yMin + (yRange * i) / nTicks;
      const y = pad.top + chartH - (chartH * i) / nTicks;
      ctx.fillText(formatTick(val), pad.left - 5, y + 3);
      ctx.strokeStyle = "#f1f5f9";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
    }

    // X labels
    if (labels) {
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.font = "10px system-ui";
      const step = Math.max(1, Math.floor(numPoints / 6));
      for (let i = 0; i < numPoints; i += step) {
        const x = pad.left + (numPoints > 1 ? (i * chartW) / (numPoints - 1) : chartW / 2);
        ctx.fillText(labels[i] || String(i), x, pad.top + chartH + 16);
      }
    }

    if (stacked) {
      const cumulative: number[][] = [];
      for (let s = 0; s < data.length; s++) {
        cumulative[s] = [];
        for (let i = 0; i < numPoints; i++) {
          cumulative[s][i] = (data[s].values[i] || 0) + (s > 0 ? cumulative[s - 1][i] : 0);
        }
      }

      for (let s = data.length - 1; s >= 0; s--) {
        ctx.fillStyle = CHART_COLORS[s % CHART_COLORS.length] + "30";
        ctx.strokeStyle = CHART_COLORS[s % CHART_COLORS.length];
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const x = pad.left + (numPoints > 1 ? (i * chartW) / (numPoints - 1) : chartW / 2);
          const y = pad.top + chartH - ((cumulative[s][i] - yMin) / yRange) * chartH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = numPoints - 1; i >= 0; i--) {
          const x = pad.left + (numPoints > 1 ? (i * chartW) / (numPoints - 1) : chartW / 2);
          const bottomVal = s > 0 ? cumulative[s - 1][i] : yMin;
          const y = pad.top + chartH - ((bottomVal - yMin) / yRange) * chartH;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      for (let s = 0; s < data.length; s++) {
        const series = data[s];
        ctx.strokeStyle = CHART_COLORS[s % CHART_COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const x = pad.left + (numPoints > 1 ? (i * chartW) / (numPoints - 1) : chartW / 2);
          const y = pad.top + chartH - ((series.values[i] - yMin) / yRange) * chartH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Legend
    ctx.textAlign = "left";
    ctx.font = "bold 10px system-ui";
    let lx = pad.left + chartW - data.length * 80;
    for (let s = 0; s < data.length; s++) {
      ctx.fillStyle = CHART_COLORS[s % CHART_COLORS.length];
      ctx.fillRect(lx, 8, 10, 10);
      ctx.fillStyle = "#64748b";
      ctx.fillText(data[s].label, lx + 14, 17);
      lx += 80;
    }
  }, [data, labels, width, height, title, stacked]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-auto rounded-2xl border border-slate-100"
      style={{ width, height, background: "#f8fafc" }}
    />
  );
}
