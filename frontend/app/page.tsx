"use client";

import { useState } from "react";
import { useApp } from "./lib/context";
import VariableCard from "./components/VariableCard";
import GraphModal from "./components/GraphModal";
import QueryPanel from "./components/QueryPanel";
import { Search, Filter, RefreshCw, Share2 } from "lucide-react";

export default function Home() {
  const { variables, graphNodes, graphEdges, loading, error, fetchSummary, appAddress, config, walletAddress, infoMap } = useApp();
  const [showGraph, setShowGraph] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVariables = variables.filter((v) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const info = infoMap[v.alias];
    return (
      v.alias.toLowerCase().includes(q) ||
      info?.name?.toLowerCase().includes(q) ||
      info?.category?.toLowerCase().includes(q) ||
      info?.description?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-12 items-start">
        <div className="flex-1 min-w-0 w-full space-y-8 animate-in">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Browse Markets</h2>
              <p className="text-sm text-slate-500 font-medium">Predict outcomes with Bayesian precision.</p>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs focus:ring-2 ring-blue-500/10 outline-none transition-all"
                  placeholder="Search variables..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {graphNodes.length > 0 && (
                <button
                  onClick={() => setShowGraph(true)}
                  className="bg-white border border-slate-200 p-2 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors"
                  title="View Graph"
                >
                  <Share2 size={18} />
                </button>
              )}
              <button
                onClick={fetchSummary}
                disabled={loading || !appAddress}
                className="bg-white border border-slate-200 p-2 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* Grid */}
          {filteredVariables.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredVariables.map((v) => (
                <VariableCard key={v.alias} variable={v} info={infoMap[v.alias]} />
              ))}
            </div>
          ) : (
            !loading && !error && (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
                  <Filter size={40} />
                </div>
                <h3 className="text-xl font-black text-slate-900">No variables found</h3>
                <p className="text-slate-400 max-w-xs font-medium">
                  {searchQuery
                    ? "Try a different search term."
                    : "Connect to a running Cartesi node to view the market."}
                </p>
              </div>
            )
          )}
        </div>

        {/* Query Panel */}
        {appAddress && (
          <QueryPanel
            config={config}
            variables={variables}
            nodes={graphNodes}
            walletAddress={walletAddress}
          />
        )}
      </div>

      {showGraph && (
        <GraphModal
          nodes={graphNodes}
          edges={graphEdges}
          onClose={() => setShowGraph(false)}
        />
      )}
    </>
  );
}
