"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "../../lib/context";
import { getRelatedVariables, getInspectOptions, getVarName, getStateName, PRECISION_FACTOR } from "../../lib/cartesi";
import { getOutputs } from "../../backend-libs/cim/lib";
import QueryPanel from "../../components/QueryPanel";
import SimpleChart from "../../components/SimpleChart";
import { Activity, Layers, TrendingUp, RefreshCw, ArrowLeft, Hash } from "lucide-react";

interface ProbEvent {
  probabilities: number[];
  volume: number;
  volume_ss: number;
  timestamp: number;
  inputIndex: number;
}

export default function VariableDetailPage() {
  const params = useParams();
  const alias = decodeURIComponent(params.alias as string);
  const {
    variables, graphNodes, config, walletAddress, appAddress, infoMap,
  } = useApp();

  const variable = variables.find((v) => v.alias === alias);
  const info = infoMap[alias] ?? null;
  const relatedAliases = getRelatedVariables(alias, graphNodes);
  const allowedAliases = [alias, ...relatedAliases];

  const [probHistory, setProbHistory] = useState<ProbEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!appAddress) return;
    setHistoryLoading(true);
    try {
      const opts = { ...getInspectOptions(config) };
      const result = await getOutputs(
        {
          tags: [alias],
          type: "notice",
          order_by: "input_index",
          order_dir: "asc",
          page_size: 100,
        },
        opts,
      );

      const events: ProbEvent[] = result.data
        .filter((d: any) => d.probabilities !== undefined)
        .map((d: any) => ({
          probabilities: (d.probabilities as number[]).map(
            (p: number) => Number(p) / PRECISION_FACTOR,
          ),
          volume: Number(d.volume ?? 0),
          volume_ss: Number(d.volume_ss ?? 0),
          timestamp: Number(d._blockTimestamp ?? 0),
          inputIndex: Number(d._inputIndex ?? 0),
        }));

      setProbHistory(events);
    } catch (err) {
      console.error("Failed to fetch probability history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [appAddress, alias, config]);

  useEffect(() => {
    if (appAddress) fetchHistory();
  }, [appAddress, fetchHistory]);

  const nStates = variable ? variable.states_probs.length : 0;

  const volumeChartData = probHistory.length > 0
    ? [
        { label: "Volume", values: probHistory.map((e) => e.volume / 1e18) },
        { label: "Short Sell", values: probHistory.map((e) => e.volume_ss / 1e18) },
      ]
    : [];

  const probChartData = nStates > 0
    ? Array.from({ length: nStates }, (_, stateIdx) => ({
        label: getStateName(info, stateIdx),
        values: probHistory.length > 0
          ? probHistory.map((e) => e.probabilities[stateIdx] ?? 0)
          : [variable!.states_probs[stateIdx]],
      }))
    : [];

  const chartLabels = probHistory.map((e) =>
    e.timestamp > 0
      ? new Date(e.timestamp * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })
      : ""
  );

  const displayName = getVarName(info, alias);

  if (!variable) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
          <Layers size={40} />
        </div>
        <h3 className="text-xl font-black text-slate-900">Variable not found</h3>
        <p className="text-slate-400 max-w-xs font-medium">
          Variable &quot;{alias}&quot; not found. Make sure the market is loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-12 items-start">
      <div className="flex-1 min-w-0 w-full space-y-8 animate-in">
        {/* Back link */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors no-underline"
        >
          <ArrowLeft size={14} /> Back to Markets
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-tighter">Active Market</span>
            {info?.category && (
              <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{info.category}</span>
            )}
          </div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-none">{displayName}</h2>
          {displayName !== alias && (
            <div className="text-sm text-slate-400 font-mono">{alias}</div>
          )}
          {info?.description && (
            <p className="text-lg text-slate-500 font-medium max-w-2xl leading-relaxed">{info.description}</p>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Volume", value: `${((variable.volume + variable.volume_ss) / 1e18).toFixed(4)} ETH`, Icon: Activity },
            { label: "Buy", value: `${(variable.volume / 1e18).toFixed(4)} ETH`, Icon: TrendingUp },
            { label: "Short Sell", value: `${(variable.volume_ss / 1e18).toFixed(4)} ETH`, Icon: Layers },
            { label: "Operations", value: String(variable.n_operations), Icon: Hash },
            { label: "Updates", value: String(probHistory.length), Icon: RefreshCw },
          ].map((stat, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <stat.Icon size={14} className="text-slate-400" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</span>
              </div>
              <div className="text-lg font-black text-slate-900">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Probabilities + Chart */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-8">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Market Probabilities</h3>
            <div className="space-y-6">
              {variable.states_probs.map((prob, i) => (
                <div key={i} className="space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="text-sm font-black text-slate-900">{getStateName(info, i)}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">State {i + 1}</div>
                    </div>
                    <div className="text-2xl font-black text-slate-900">{(prob * 100).toFixed(1)}%</div>
                  </div>
                  <div className="h-4 w-full bg-slate-50 rounded-xl overflow-hidden border border-slate-100 p-0.5">
                    <div
                      className={`h-full rounded-lg transition-all duration-1000 ${i === 0 ? "bg-blue-600" : "bg-slate-900"}`}
                      style={{ width: `${prob * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Price Action</h3>
            <div className="h-[240px] w-full">
              {probChartData.length > 0 && probChartData[0].values.length > 0 ? (
                <SimpleChart
                  title="Probability Evolution"
                  data={probChartData}
                  labels={chartLabels}
                  width={400}
                  height={220}
                  stacked
                />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                  No probability history available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Volume Chart */}
        {volumeChartData.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Volume Evolution</h3>
            <SimpleChart
              title="Volume (ETH)"
              data={volumeChartData}
              labels={chartLabels}
              width={800}
              height={220}
            />
          </div>
        )}

        {/* Additional Info */}
        {info && (
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Additional Information</h3>
            <div className="divide-y divide-slate-100">
              {Object.entries(info)
                .filter(([key]) => !["alias", "name", "description", "states"].includes(key))
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between py-3 text-sm">
                    <span className="text-slate-400 font-bold">{key}</span>
                    <span className="text-slate-900 font-mono text-xs">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Probability History Table */}
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Probability Log</h3>
            <button
              onClick={fetchHistory}
              disabled={historyLoading}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={historyLoading ? "animate-spin" : ""} />
              {historyLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {probHistory.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="bg-slate-50/50 text-slate-400 uppercase text-[10px] font-black">
                <tr>
                  <th className="px-8 py-4 text-left">Time</th>
                  {Array.from({ length: nStates }, (_, i) => (
                    <th key={i} className="px-8 py-4 text-left">{getStateName(info, i)}</th>
                  ))}
                  <th className="px-8 py-4 text-right">Volume</th>
                  <th className="px-8 py-4 text-right">Short Sell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {probHistory.map((ev, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-5 text-slate-400 font-mono">
                      {ev.timestamp > 0
                        ? new Date(ev.timestamp * 1000).toLocaleString()
                        : "-"}
                    </td>
                    {ev.probabilities.map((p, j) => (
                      <td key={j} className="px-8 py-5 text-slate-900 font-black">{(p * 100).toFixed(1)}%</td>
                    ))}
                    <td className="px-8 py-5 text-right text-slate-500 font-mono">{(ev.volume / 1e18).toFixed(4)} ETH</td>
                    <td className="px-8 py-5 text-right text-slate-500 font-mono">{(ev.volume_ss / 1e18).toFixed(4)} ETH</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !historyLoading && (
              <div className="px-8 py-12 text-center text-slate-400 text-sm">No history yet</div>
            )
          )}
        </div>
      </div>

      {/* Query Panel */}
      {appAddress && (
        <QueryPanel
          config={config}
          variables={variables.filter((v) => allowedAliases.includes(v.alias))}
          nodes={graphNodes}
          walletAddress={walletAddress}
          allowedAliases={allowedAliases}
        />
      )}
    </div>
  );
}
