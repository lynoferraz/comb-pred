"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../lib/context";
import { getInspectOptions } from "../lib/cartesi";
import { userInfo, getOutputs } from "../backend-libs/cim/lib";
import QueryPanel from "../components/QueryPanel";
import SimpleChart from "../components/SimpleChart";
import { Wallet, Activity, TrendingUp, Layers, RefreshCw } from "lucide-react";

interface UserBalanceEvent {
  user: string;
  free_funds: number;
  expected: number;
  timestamp: number;
}

interface UserInfoData {
  free_funds: number;
  expected: number;
}

export default function DashboardPage() {
  const { variables, graphNodes, config, walletAddress, appAddress } = useApp();

  const [currentInfo, setCurrentInfo] = useState<UserInfoData | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<UserBalanceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserInfo = useCallback(async () => {
    if (!appAddress || !walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const result = await userInfo(
        { user_address: walletAddress },
        {
          ...getInspectOptions(config),
          decode: true,
          decodeModel: "json",
        },
      );
      setCurrentInfo(result as UserInfoData);
    } catch (err: any) {
      setError(err.message || "Failed to fetch user info");
    } finally {
      setLoading(false);
    }
  }, [appAddress, walletAddress, config]);

  const fetchBalanceHistory = useCallback(async () => {
    if (!appAddress || !walletAddress) return;
    setHistoryLoading(true);
    try {
      const result = await getOutputs(
        {
          tags: ["balance", walletAddress],
          type: "notice",
          order_by: "input_index",
          order_dir: "asc",
          page_size: 100,
        },
        getInspectOptions(config),
      );
      console.log("balances", result);

      const events: UserBalanceEvent[] = result.data
        .filter((d: any) => d.user !== undefined)
        .map((d: any) => ({
          user: d.user || "",
          free_funds: Number(d.free_funds ?? 0),
          expected: Number(d.expected ?? 0),
          timestamp: Number(d.timestamp ?? d._blockTimestamp ?? 0),
        }));

      setBalanceHistory(events);
    } catch (err) {
      console.error("Failed to fetch balance history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [appAddress, walletAddress, config]);

  useEffect(() => {
    if (walletAddress && appAddress) {
      fetchUserInfo();
      fetchBalanceHistory();
    }
  }, [walletAddress, appAddress, fetchUserInfo, fetchBalanceHistory]);

  const chartData =
    balanceHistory.length > 0
      ? [
          {
            label: "Free Funds",
            values: balanceHistory.map((e) => e.free_funds / 1e18),
          },
          {
            label: "Expected",
            values: balanceHistory.map((e) => e.expected / 1e18),
          },
        ]
      : [];

  const chartLabels = balanceHistory.map((e) =>
    e.timestamp > 0
      ? new Date(e.timestamp * 1000).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        })
      : "",
  );

  if (!walletAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
          <Wallet size={40} />
        </div>
        <h2 className="text-xl font-black text-slate-900">Connect Your Wallet</h2>
        <p className="text-slate-400 max-w-xs font-medium">
          Connect your wallet to view your portfolio dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-12 items-start">
      <div className="flex-1 min-w-0 w-full space-y-8 animate-in">
        {/* Title */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Portfolio Dashboard</h2>
            <p className="text-sm text-slate-500 font-medium">Your market positions and balance history.</p>
          </div>
          <button
            onClick={() => { fetchUserInfo(); fetchBalanceHistory(); }}
            disabled={loading || historyLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading || historyLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={14} className="text-slate-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Free Funds</span>
            </div>
            <div className="text-lg font-black text-slate-900">
              {loading ? "..." : currentInfo ? (currentInfo.free_funds / 1e18).toFixed(6) + " ETH" : "-"}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-slate-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Expected Value</span>
            </div>
            <div className="text-lg font-black text-slate-900">
              {loading ? "..." : currentInfo ? (currentInfo.expected / 1e18).toFixed(6) + " ETH" : "-"}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Layers size={14} className="text-slate-400" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Balance Events</span>
            </div>
            <div className="text-lg font-black text-slate-900">{balanceHistory.length}</div>
          </div>
        </div>

        {error && (
          <div className="text-red-500 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Chart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Balance History</h3>
          {chartData.length > 0 ? (
            <SimpleChart
              title="Funds Evolution (ETH)"
              data={chartData}
              labels={chartLabels}
              width={800}
              height={300}
            />
          ) : (
            !historyLoading && (
              <div className="py-12 text-center text-slate-400 text-sm">
                No balance history available yet
              </div>
            )
          )}
          {historyLoading && (
            <div className="py-8 text-center text-slate-400 text-xs font-bold">Loading history...</div>
          )}
        </div>

        {/* Balance events table */}
        {balanceHistory.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Balance Events</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50/50 text-slate-400 uppercase text-[10px] font-black">
                <tr>
                  <th className="px-8 py-4 text-left">Timestamp</th>
                  <th className="px-8 py-4 text-right">Free Funds (ETH)</th>
                  <th className="px-8 py-4 text-right">Expected (ETH)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...balanceHistory].reverse().map((ev, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-5 text-slate-400 font-mono">
                      {ev.timestamp > 0 ? new Date(ev.timestamp * 1000).toLocaleString() : "-"}
                    </td>
                    <td className="px-8 py-5 text-right text-slate-900 font-black">{(ev.free_funds / 1e18).toFixed(6)}</td>
                    <td className="px-8 py-5 text-right text-slate-900 font-black">{(ev.expected / 1e18).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  );
}
