"use client";

import { useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface GraphModalProps {
  nodes: string[][];
  edges: [string[], string[]][];
  onClose: () => void;
}

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

export default function GraphModal({ nodes, edges, onClose }: GraphModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphNodes = useRef<GraphNode[]>([]);
  const graphEdges = useRef<GraphEdge[]>([]);

  useEffect(() => {
    const nodeMap = new Map<string, GraphNode>();
    const count = nodes.length;

    nodes.forEach((clique, i) => {
      const label = clique.filter(v => !v.startsWith("_")).join(", ") || clique.join(", ");
      const id = JSON.stringify(clique.sort());
      const angle = (2 * Math.PI * i) / count;
      const radius = Math.min(250, count * 40);
      nodeMap.set(id, {
        id,
        label,
        x: 400 + radius * Math.cos(angle),
        y: 300 + radius * Math.sin(angle),
      });
    });

    graphNodes.current = Array.from(nodeMap.values());
    graphEdges.current = edges.map(([s, t]) => ({
      source: JSON.stringify(s.sort()),
      target: JSON.stringify(t.sort()),
    }));

    draw();
  }, [nodes, edges]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Edges
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    for (const edge of graphEdges.current) {
      const src = graphNodes.current.find(n => n.id === edge.source);
      const tgt = graphNodes.current.find(n => n.id === edge.target);
      if (src && tgt) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.stroke();
      }
    }

    // Nodes
    for (const node of graphNodes.current) {
      ctx.fillStyle = "#eff6ff";
      ctx.beginPath();
      ctx.arc(node.x, node.y, 32, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = node.label.split(", ");
      lines.forEach((line, i) => {
        ctx.fillText(line, node.x, node.y + (i - (lines.length - 1) / 2) * 14);
      });
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-3xl p-8 w-[90%] max-w-4xl max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-black text-slate-900">Junction Tree Graph</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="w-full h-auto rounded-2xl border border-slate-100"
        />
      </div>
    </div>
  );
}
