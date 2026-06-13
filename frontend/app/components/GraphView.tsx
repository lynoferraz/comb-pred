"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import dagre from "@dagrejs/dagre";
import { Maximize2 } from "lucide-react";

interface GraphViewProps {
  nodes: string[][];
  edges: [string[], string[]][];
  height?: number;
}

interface LaidNode {
  id: string;
  vars: string[];
  x: number; // center
  y: number;
  w: number;
  h: number;
}

interface LaidEdge {
  source: string;
  target: string;
  separator: string[]; // real vars shared by the two cliques
  dummy: boolean; // dummy separator (_x*) = independence link
}

const FONT = 11;
const CHAR_W = 6.8; // ~width per char at 11px mono-ish
const LINE_H = 16;
const PAD_X = 14;
const PAD_Y = 10;

const cliqueId = (c: string[]) => JSON.stringify([...c].sort());

function layout(nodes: string[][], edges: [string[], string[]][]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 48, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));

  const laidNodes = new Map<string, LaidNode>();
  for (const clique of nodes) {
    const id = cliqueId(clique);
    if (laidNodes.has(id)) continue;
    const vars = clique.filter((v) => !v.startsWith("_"));
    const shown = vars.length > 0 ? vars : clique;
    const w = Math.max(...shown.map((v) => v.length)) * CHAR_W + PAD_X * 2;
    const h = shown.length * LINE_H + PAD_Y * 2;
    laidNodes.set(id, { id, vars: shown, x: 0, y: 0, w, h });
    g.setNode(id, { width: w, height: h });
  }

  const laidEdges: LaidEdge[] = [];
  for (const [s, t] of edges) {
    const sId = cliqueId(s);
    const tId = cliqueId(t);
    const sSet = new Set(s);
    const separator = t.filter((v) => sSet.has(v) && !v.startsWith("_"));
    const dummy = separator.length === 0;
    laidEdges.push({ source: sId, target: tId, separator, dummy });
    g.setEdge(sId, tId);
  }

  dagre.layout(g);
  for (const n of laidNodes.values()) {
    const pos = g.node(n.id);
    n.x = pos.x;
    n.y = pos.y;
  }

  // Overall bounds with a margin, used as the fit-to-view viewBox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of laidNodes.values()) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  if (!isFinite(minX)) [minX, minY, maxX, maxY] = [0, 0, 100, 100];
  const m = 24;
  const bounds = {
    x: minX - m,
    y: minY - m,
    w: maxX - minX + 2 * m,
    h: maxY - minY + 2 * m,
  };

  return { laidNodes: Array.from(laidNodes.values()), laidEdges, bounds };
}

// Junction-tree visualization (admin page). dagre computes a tree layout;
// rendering is plain SVG with wheel zoom, drag pan and a fit-to-view button,
// so it stays usable when the market has many cliques.
export default function GraphView({ nodes, edges, height = 460 }: GraphViewProps) {
  const { laidNodes, laidEdges, bounds } = useMemo(
    () => layout(nodes, edges),
    [nodes, edges],
  );

  const [viewBox, setViewBox] = useState(bounds);
  useEffect(() => setViewBox(bounds), [bounds]);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Convert a pointer event to coordinates in the SVG's viewBox space.
  const toLocal = useCallback(
    (e: { clientX: number; clientY: number }, vb: typeof bounds) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: vb.x + ((e.clientX - rect.left) / rect.width) * vb.w,
        y: vb.y + ((e.clientY - rect.top) / rect.height) * vb.h,
      };
    },
    [],
  );

  // React registers onWheel as a passive listener, which can't
  // preventDefault() page scrolling — attach a non-passive one instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setViewBox((vb) => {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const w = Math.min(Math.max(vb.w * factor, bounds.w / 12), bounds.w * 3);
        const h = (w / vb.w) * vb.h;
        const p = toLocal(e, vb);
        return {
          x: p.x - ((p.x - vb.x) / vb.w) * w,
          y: p.y - ((p.y - vb.y) / vb.h) * h,
          w,
          h,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [bounds, toLocal]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * viewBox.w;
    const dy = ((e.clientY - drag.current.y) / rect.height) * viewBox.h;
    drag.current = { x: e.clientX, y: e.clientY };
    setViewBox((vb) => ({ ...vb, x: vb.x - dx, y: vb.y - dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const nodeById = useMemo(() => {
    const map = new Map<string, LaidNode>();
    for (const n of laidNodes) map.set(n.id, n);
    return map;
  }, [laidNodes]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        style={{ height, touchAction: "none" }}
        className="w-full rounded-2xl border border-line bg-surface cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Edges with separator labels */}
        {laidEdges.map((e, i) => {
          const s = nodeById.get(e.source);
          const t = nodeById.get(e.target);
          if (!s || !t) return null;
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          const label = e.dummy ? "" : e.separator.join(", ");
          return (
            <g key={i}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="var(--color-ink4)"
                strokeWidth={1.5}
                strokeDasharray={e.dummy ? "4 4" : undefined}
              />
              {label && (
                <g>
                  <rect
                    x={mx - (label.length * CHAR_W * 0.85) / 2 - 4}
                    y={my - 9}
                    width={label.length * CHAR_W * 0.85 + 8}
                    height={18}
                    rx={9}
                    fill="var(--color-surface2)"
                    stroke="var(--color-line)"
                  />
                  <text
                    x={mx}
                    y={my}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={FONT - 1.5}
                    fill="var(--color-ink2)"
                    fontFamily="var(--font-mono)"
                  >
                    {label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Clique nodes */}
        {laidNodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x - n.w / 2}
              y={n.y - n.h / 2}
              width={n.w}
              height={n.h}
              rx={12}
              fill="var(--color-accent-soft)"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
            />
            {n.vars.map((v, i) => (
              <text
                key={v}
                x={n.x}
                y={n.y - n.h / 2 + PAD_Y + LINE_H * i + LINE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={FONT}
                fontWeight={600}
                fill="var(--color-ink)"
                fontFamily="var(--font-sans)"
              >
                {v}
              </text>
            ))}
          </g>
        ))}
      </svg>

      <button
        onClick={() => setViewBox(bounds)}
        title="Fit to view"
        className="absolute top-3 right-3 p-2 rounded-full border border-line bg-surface text-ink3 hover:text-ink hover:bg-line2 transition-colors"
      >
        <Maximize2 size={14} />
      </button>
      <div className="absolute bottom-3 left-3 text-[10px] text-ink3 font-mono pointer-events-none">
        scroll to zoom · drag to pan · dashed = independence link
      </div>
    </div>
  );
}
