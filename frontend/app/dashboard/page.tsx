"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../lib/context";
import { getInspectOptions } from "../lib/cartesi";
import { getOutputs } from "../backend-libs/cim/lib";
import { fmt } from "../lib/format";
import {
  buildMarkets,
  informativeVars,
  collapseRows,
  type Market,
  type Selection,
} from "../lib/market";
import { ammQuery } from "../lib/useAmmQuery";
import type { QueryResult } from "../lib/cartesi";
import { BalanceChart } from "../components/ui/Charts";
import { LiquidationCard } from "../components/market/ReportPanel";
import WithdrawalsCard from "../components/WithdrawalsCard";
import { setExplorerPrefill } from "../lib/prefill";
import { RefreshCw, Info, ArrowUpRight } from "lucide-react";

interface BalancePoint {
  free_funds: number;
  expected: number;
  timestamp: number;
}

export default function DashboardPage() {
  const {
    config,
    walletAddress,
    appAddress,
    userFreeFunds,
    userExpected,
    refreshUserInfo,
    variables,
    infoMap,
    graphNodes,
    ammB,
  } = useApp();
  const router = useRouter();

  const allMarkets = useMemo(
    () => buildMarkets(variables, infoMap, graphNodes, ammB),
    [variables, infoMap, graphNodes, ammB],
  );

  const [history, setHistory] = useState<BalancePoint[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Positions: one expected-value table per informative clique ────────────
  interface PositionTable {
    key: string;
    vars: string[];
    rows: { assignment: Record<string, number>; value: number }[];
  }
  const [positions, setPositions] = useState<PositionTable[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  // ── Liquidation query: rows from any position table can be applied as
  // targets or evidence; we re-run ammQuery whenever the selection changes.
  const [liqTargets, setLiqTargets] = useState<Selection[]>([]);
  const [liqEvidence, setLiqEvidence] = useState<Selection[]>([]);
  const [liqResult, setLiqResult] = useState<QueryResult | null>(null);
  const [liqLoading, setLiqLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!appAddress || !walletAddress) return;
    setLoading(true);
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
      const points: BalancePoint[] = result.data
        .filter((d: any) => d.user !== undefined)
        .map((d: any) => ({
          free_funds: Number(d.free_funds ?? 0) / 1e18,
          expected: Number(d.expected ?? 0) / 1e18,
          timestamp: Number(d.timestamp ?? d._blockTimestamp ?? 0),
        }));
      setHistory(points);
    } catch (err) {
      console.error("balance history fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [appAddress, walletAddress, config]);

  useEffect(() => {
    if (walletAddress && appAddress) {
      refreshUserInfo();
      fetchHistory();
    }
  }, [walletAddress, appAddress, refreshUserInfo, fetchHistory]);

  // Fetch expected-value tables for every (real) clique.
  const fetchPositions = useCallback(async () => {
    if (!walletAddress || !appAddress || graphNodes.length === 0) {
      setPositions([]);
      return;
    }
    setPositionsLoading(true);
    try {
      const results = await Promise.all(
        graphNodes.map(async (clique): Promise<PositionTable | null> => {
          const real = clique.filter((a) => !a.startsWith("_"));
          if (real.length === 0) return null;
          try {
            const res = await ammQuery(config, {
              varAliases: real,
              varStates: real.map(() => 0),
              userAddress: walletAddress,
            });
            const rows = (res.user_expected_value || []) as Array<
              Record<string, any>
            >;
            if (rows.length === 0) return null;
            const informative = informativeVars(rows, real);
            if (informative.length === 0) return null;
            const collapsed = collapseRows(rows, informative);
            return {
              key: [...real].sort().join(","),
              vars: informative,
              rows: collapsed,
            };
          } catch {
            return null;
          }
        }),
      );
      // Dedup cliques that pruned to the same variable set.
      const seen = new Set<string>();
      const unique = (results.filter(Boolean) as PositionTable[]).filter((p) => {
        const k = [...p.vars].sort().join(",");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setPositions(unique);
    } finally {
      setPositionsLoading(false);
    }
  }, [walletAddress, appAddress, graphNodes, config]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Liquidation query — runs whenever the user selects rows from the position
  // tables. The backend requires at least one target; evidence is optional.
  useEffect(() => {
    if (!walletAddress || !appAddress || liqTargets.length === 0) {
      setLiqResult(null);
      return;
    }
    let cancelled = false;
    setLiqLoading(true);
    ammQuery(config, {
      varAliases: liqTargets.map((t) => t.alias),
      varStates: liqTargets.map((t) => t.stateIdx),
      evidenceAliases: liqEvidence.map((e) => e.alias),
      evidenceStates: liqEvidence.map((e) => e.stateIdx),
      userAddress: walletAddress,
    })
      .then((res) => {
        if (!cancelled) setLiqResult(res);
      })
      .catch(() => {
        if (!cancelled) setLiqResult(null);
      })
      .finally(() => {
        if (!cancelled) setLiqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [liqTargets, liqEvidence, walletAddress, appAddress, config]);

  const expected = userExpected ?? 0;
  const free = userFreeFunds ?? 0;
  const locked = Math.max(0, expected - free);

  const { pnl24h, pnlAll } = useMemo(() => {
    if (history.length < 2) return { pnl24h: 0, pnlAll: 0 };
    const latest = history[history.length - 1];
    const first = history[0];
    const cutoff = Date.now() / 1000 - 24 * 3600;
    let base = first;
    for (const h of history) {
      if (h.timestamp <= cutoff) base = h;
      else break;
    }
    return {
      pnl24h: latest.expected - base.expected,
      pnlAll: latest.expected - first.expected,
    };
  }, [history]);

  const balanceData = useMemo(
    () =>
      history.map((h) => ({
        label:
          h.timestamp > 0
            ? new Date(h.timestamp * 1000).toLocaleDateString("en", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
              })
            : "",
        expected: h.expected,
        free: h.free_funds,
      })),
    [history],
  );

  if (!walletAddress) {
    return (
      <div className="max-w-[700px] mx-auto py-24 px-7 text-center">
        <h2 className="text-xl font-semibold text-ink">Connect your wallet</h2>
        <p className="mt-2 text-ink3">
          Connect your wallet to view your portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-7 pt-10 pb-14 max-w-[1500px] mx-auto flex flex-col gap-6 animate-in">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight leading-none text-ink">
            Portfolio
          </h1>
          <p className="mt-2.5 text-sm text-ink2 font-mono">
            {fmt.addr(walletAddress)} · {history.length} balance events
          </p>
        </div>
        <button
          onClick={() => {
            refreshUserInfo();
            fetchHistory();
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-line text-xs font-medium text-ink2 hover:bg-line2 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Hero KPI card */}
      <div className="bg-surface rounded-3xl border border-line p-7">
        <div className="flex justify-between items-end mb-5 flex-wrap gap-4">
          <div>
            <div className="text-xs text-ink3 font-medium">Expected value</div>
            <div className="flex items-baseline gap-4 mt-1 flex-wrap">
              <div className="text-[56px] font-semibold font-mono tracking-tighter leading-none">
                {fmt.eth(expected, 4)}
              </div>
              <div className="text-lg text-ink3">ETH</div>
              {pnlAll !== 0 && (
                <div
                  className={`text-[15px] font-semibold ${
                    pnlAll >= 0 ? "text-accent" : "text-no"
                  }`}
                >
                  {fmt.signed(pnlAll, 4)} ETH all-time
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-[220px]">
          {balanceData.length > 0 ? (
            <BalanceChart data={balanceData} valueFormatter={(v) => v.toFixed(3)} />
          ) : (
            <div className="h-full grid place-items-center text-ink3 text-xs">
              {loading ? "Loading balance history…" : "No balance history yet"}
            </div>
          )}
        </div>
        <div className="mt-2 flex justify-end gap-4 text-[11px] font-mono text-ink3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[3px] bg-accent rounded-full" />
            Expected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[1.5px] border-t-2 border-dashed border-ink2" />
            Free funds
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mt-5 border-t border-line pt-5">
          {[
            ["Free funds", `${fmt.eth(free, 4)} ETH`, "Available"],
            ["Locked", `${fmt.eth(locked, 4)} ETH`, "In open positions"],
            ["Today", `${fmt.signed(pnl24h, 4)} ETH`, "Expected Δ 24h"],
            ["Balance events", String(history.length), "Recorded"],
          ].map(([k, v, sub], i) => (
            <div
              key={k}
              className={i ? "pl-6 border-l border-line" : ""}
            >
              <div className="text-xs text-ink3 font-medium">{k}</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tracking-tight">
                {v}
              </div>
              <div className="mt-0.5 text-[11px] text-ink3">{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Withdrawals — claim vouchers from withdraw requests */}
      <WithdrawalsCard />

      {/* Positions — expected value per joint assignment, one table per clique */}
      {positions.length > 0 && (
        <div className="bg-surface rounded-card border border-line overflow-hidden">
          <div className="px-[22px] py-4 border-b border-line flex justify-between items-center">
            <div>
              <div className="text-sm font-semibold">Positions</div>
              <div className="text-[11px] text-ink3 mt-0.5">
                Expected value per joint assignment, grouped by junction-tree
                clique. Variables that don't change the value are dropped.
              </div>
            </div>
            {positionsLoading && (
              <RefreshCw size={14} className="animate-spin text-ink3" />
            )}
          </div>
          <div className="divide-y divide-line">
            {positions.map((p) => (
              <PositionTable
                key={p.key}
                table={p}
                markets={allMarkets}
                baselineExpected={userExpected}
                liqTargets={liqTargets}
                liqEvidence={liqEvidence}
                setLiqTargets={setLiqTargets}
                setLiqEvidence={setLiqEvidence}
              />
            ))}
          </div>
        </div>
      )}

      {/* Liquidation simulation */}
      {(liqTargets.length > 0 || liqEvidence.length > 0) && (
        <div className="bg-surface rounded-card border border-line p-[22px] flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm font-semibold">Liquidation simulation</div>
              <div className="text-[11px] text-ink3 mt-0.5">
                Pick rows from the tables above; each row goes in as a target or
                as evidence.
              </div>
            </div>
            <button
              onClick={() => {
                setLiqTargets([]);
                setLiqEvidence([]);
              }}
              className="text-[11px] font-medium text-ink3 hover:text-ink"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {liqTargets.map((t, i) => {
              const m = allMarkets.find((m) => m.alias === t.alias);
              return (
                <span
                  key={`t-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft border border-accent text-accent-deep text-[11px] font-medium"
                >
                  T · {m?.short || t.alias} = {m?.states[t.stateIdx]?.name ?? t.stateIdx}
                </span>
              );
            })}
            {liqEvidence.map((e, i) => {
              const m = allMarkets.find((m) => m.alias === e.alias);
              return (
                <span
                  key={`e-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-line2 border border-ink4 text-ink text-[11px] font-medium"
                >
                  E · {m?.short || e.alias} = {m?.states[e.stateIdx]?.name ?? e.stateIdx}
                </span>
              );
            })}
          </div>
          {liqLoading && (
            <div className="text-[11px] text-ink3 font-mono">
              <span className="cim-spinner" /> querying…
            </div>
          )}
          {liqResult?.user_liquidation && (
            <LiquidationCard
              liquidation={liqResult.user_liquidation}
              markets={allMarkets}
              baselineExpected={userExpected}
              onOpenExplorer={() => {
                setExplorerPrefill({
                  targets: liqTargets,
                  evidence: liqEvidence,
                  value:
                    typeof liqResult.user_liquidation!.report?.value === "number"
                      ? liqResult.user_liquidation!.report.value
                      : undefined,
                });
                router.push("/explorer");
              }}
            />
          )}
          {!liqResult && !liqLoading && liqTargets.length === 0 && (
            <div className="text-[11px] text-ink3">
              Add at least one row as a target to run a liquidation query.
            </div>
          )}
        </div>
      )}

      {/* About positions */}
      <div className="bg-surface rounded-card border border-line p-[22px] flex gap-3 items-start">
        <Info size={18} className="text-ink3 shrink-0 mt-0.5" />
        <div className="text-[13px] text-ink2 leading-relaxed">
          <span className="font-semibold text-ink">About positions.</span> In CIM
          a forecast is a report over a joint assignment of variables, not a
          single-market share. The tables above show your expected value across
          every joint assignment of each junction-tree clique. Select a row as a
          target or evidence to run a liquidation query, then forward the result
          to the Explorer for further composition.
        </div>
      </div>

      {/* Balance events table */}
      {history.length > 0 && (
        <div className="bg-surface rounded-card border border-line overflow-hidden">
          <div className="px-[22px] py-4 border-b border-line">
            <div className="text-sm font-semibold">Balance events</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-ink3 text-[11px]">
                  <th className="px-[22px] py-2.5 text-left font-medium">Time</th>
                  <th className="px-[22px] py-2.5 text-right font-medium">
                    Free funds
                  </th>
                  <th className="px-[22px] py-2.5 text-right font-medium">
                    Expected
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h, i) => (
                  <tr key={i} className="border-t border-line2">
                    <td className="px-[22px] py-3 text-ink3 font-mono whitespace-nowrap">
                      {h.timestamp > 0
                        ? new Date(h.timestamp * 1000).toLocaleString()
                        : "-"}
                    </td>
                    <td className="px-[22px] py-3 text-right font-mono font-semibold">
                      {fmt.eth(h.free_funds, 6)}
                    </td>
                    <td className="px-[22px] py-3 text-right font-mono font-semibold">
                      {fmt.eth(h.expected, 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Position table (one per junction-tree clique) ──────────────────────────

function PositionTable({
  table,
  markets,
  baselineExpected,
  liqTargets,
  liqEvidence,
  setLiqTargets,
  setLiqEvidence,
}: {
  table: {
    key: string;
    vars: string[];
    rows: { assignment: Record<string, number>; value: number }[];
  };
  markets: Market[];
  // User's overall expected balance in ETH. We compute each row's
  // expected value minus this baseline — positive = the assignment is
  // favorable for the user's current position, negative = unfavorable.
  baselineExpected?: number;
  liqTargets: Selection[];
  liqEvidence: Selection[];
  setLiqTargets: (s: Selection[]) => void;
  setLiqEvidence: (s: Selection[]) => void;
}) {
  const lookup = (alias: string) => markets.find((m) => m.alias === alias);

  // Per-cell three-state toggle: off → target → evidence → off. A variable can
  // hold at most one state across both lists; clicking a different state of
  // the same variable replaces it.
  const cellRole = (alias: string, stateIdx: number) => {
    if (liqTargets.some((t) => t.alias === alias && t.stateIdx === stateIdx))
      return "target" as const;
    if (liqEvidence.some((e) => e.alias === alias && e.stateIdx === stateIdx))
      return "evidence" as const;
    return "off" as const;
  };
  const toggleCell = (alias: string, stateIdx: number) => {
    const role = cellRole(alias, stateIdx);
    const stripT = liqTargets.filter((t) => t.alias !== alias);
    const stripE = liqEvidence.filter((e) => e.alias !== alias);
    if (role === "off") {
      setLiqTargets([...stripT, { alias, stateIdx }]);
      setLiqEvidence(stripE);
    } else if (role === "target") {
      setLiqTargets(stripT);
      setLiqEvidence([...stripE, { alias, stateIdx }]);
    } else {
      setLiqTargets(stripT);
      setLiqEvidence(stripE);
    }
  };

  return (
    <div className="p-[22px]">
      <div className="text-[11px] font-bold tracking-widest uppercase text-ink3 mb-3">
        {table.vars.map((v) => lookup(v)?.short || v).join(" × ")}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-ink3 text-[11px]">
              {table.vars.map((v) => (
                <th
                  key={v}
                  className="text-left font-medium pr-4 py-2 whitespace-nowrap"
                >
                  {lookup(v)?.short || v}
                </th>
              ))}
              <th className="text-right font-medium pr-4 py-2 whitespace-nowrap">
                Expected (ETH)
              </th>
              {baselineExpected !== undefined && (
                <th
                  className="text-right font-medium py-2 whitespace-nowrap"
                  title="Row's expected value − your overall expected balance"
                >
                  Δ vs expected
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, idx) => {
              const expectedEth = r.value / 1e18;
              const gain =
                baselineExpected !== undefined
                  ? expectedEth - baselineExpected
                  : undefined;
              return (
                <tr key={idx} className="border-t border-line2">
                  {table.vars.map((v) => {
                    const m = lookup(v);
                    const stateIdx = r.assignment[v];
                    const sname = m?.states[stateIdx]?.name ?? stateIdx;
                    const role = cellRole(v, stateIdx);
                    const cls =
                      role === "target"
                        ? "bg-accent-soft text-accent-deep border border-accent"
                        : role === "evidence"
                          ? "bg-line2 text-ink border border-ink4"
                          : "border border-transparent text-ink hover:bg-line2";
                    const tooltip =
                      role === "off"
                        ? "Click to add as target"
                        : role === "target"
                          ? "Click to switch to evidence"
                          : "Click to clear";
                    return (
                      <td key={v} className="pr-3 py-1.5 whitespace-nowrap">
                        <button
                          onClick={() => toggleCell(v, stateIdx)}
                          title={tooltip}
                          className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${cls}`}
                        >
                          {sname}
                        </button>
                      </td>
                    );
                  })}
                  <td className="pr-4 py-1.5 text-right font-mono font-semibold text-ink whitespace-nowrap">
                    {fmt.eth(expectedEth, 6)}
                  </td>
                  {gain !== undefined && (
                    <td
                      className={`py-1.5 text-right font-mono font-semibold whitespace-nowrap ${
                        gain >= 0 ? "text-accent" : "text-no"
                      }`}
                    >
                      {fmt.signed(gain, 6)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[10px] text-ink3 font-mono">
        Click a cell to toggle: off → <span className="text-accent-deep">target</span>{" "}
        → <span className="text-ink">evidence</span> → off.
      </div>
    </div>
  );
}
