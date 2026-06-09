"use client";

import { useRef, useEffect, useCallback } from "react";
import { useTheme } from "../lib/theme";

interface GraphViewProps {
  nodes: string[][];
  edges: [string[], string[]][];
  height?: number;
}

interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

// Junction-tree visualization (canvas). Lives on the Admin page.
export default function GraphView({ nodes, edges, height = 460 }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gNodes = useRef<GNode[]>([]);
  const gEdges = useRef<{ source: string; target: string }[]>([]);
  const { dark } = useTheme();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim() || "#888";
    const surface = v("--color-surface");
    const line = v("--color-ink4");
    const accent = v("--color-accent");
    const accentSoft = v("--color-accent-soft");
    const ink = v("--color-ink");

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (const e of gEdges.current) {
      const s = gNodes.current.find((n) => n.id === e.source);
      const t = gNodes.current.find((n) => n.id === e.target);
      if (s && t) {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }

    for (const node of gNodes.current) {
      ctx.fillStyle = accentSoft;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 34, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = "600 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = node.label.split(", ");
      lines.forEach((l, i) => {
        ctx.fillText(l, node.x, node.y + (i - (lines.length - 1) / 2) * 14);
      });
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const cx = W / 2;
    const cy = canvas.height / 2;
    const count = nodes.length || 1;

    const map = new Map<string, GNode>();
    nodes.forEach((clique, i) => {
      const label =
        clique.filter((x) => !x.startsWith("_")).join(", ") || clique.join(", ");
      const id = JSON.stringify([...clique].sort());
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      const radius = Math.min(cy - 60, count * 42);
      map.set(id, {
        id,
        label,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    gNodes.current = Array.from(map.values());
    gEdges.current = edges.map(([s, t]) => ({
      source: JSON.stringify([...s].sort()),
      target: JSON.stringify([...t].sort()),
    }));
    draw();
  }, [nodes, edges, draw, dark]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={height}
      className="w-full h-auto rounded-2xl border border-line"
    />
  );
}
