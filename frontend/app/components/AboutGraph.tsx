"use client";

import { useApp } from "../lib/context";
import GraphView from "./GraphView";

// Live junction-tree figure for the About page. The page itself is a server
// component, so the market context is consumed here.
export default function AboutGraph() {
  const { graphNodes, graphEdges } = useApp();

  if (graphNodes.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-line bg-surface2 px-5 py-8 text-center text-[13px] text-ink3">
        Connect to a running market node to see its live junction tree here.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <GraphView nodes={graphNodes} edges={graphEdges} height={360} />
    </div>
  );
}
