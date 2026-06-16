"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "../../lib/context";
import { getInspectOptions, PRECISION_FACTOR } from "../../lib/cartesi";
import {
  buildMarket,
  buildMarketsFromAliases,
  plainEnglishEvidence,
  evidenceCandidates,
  type ProbPoint,
  type Selection,
} from "../../lib/market";
import { fmt } from "../../lib/format";
import { useConditional, useAnimatedNumber } from "../../lib/useAmmQuery";
import { getOutputs } from "../../backend-libs/cim/lib";
import Pill from "../../components/ui/Pill";
import EvidenceRail from "../../components/market/EvidenceRail";
import ReportPanel from "../../components/market/ReportPanel";
import {
  ProbabilityAreaChart,
  MultiLineChart,
} from "../../components/ui/Charts";
import { RefreshCw } from "lucide-react";

export default function VariableDetailPage() {
  const params = useParams();
  const alias = decodeURIComponent(params.alias as string);
  const {
    aliases,
    marketData,
    graphNodes,
    ammB,
    infoMap,
    config,
    appAddress,
    ensureVariables,
    refreshUserInfo,
  } = useApp();

  // Deep links land before any data covers this alias; ensureVariables
  // dedupes, so this is a no-op once the data is loaded.
  useEffect(() => {
    if (appAddress) ensureVariables([alias]);
  }, [appAddress, alias, ensureVariables]);

  // Built from info immediately (state names, category); probabilities fill
  // in once the inspect above resolves.
  const market = useMemo(
    () => buildMarket(alias, marketData[alias], infoMap[alias], graphNodes, ammB),
    [marketData, infoMap, alias, graphNodes, ammB],
  );

  const allMarkets = useMemo(
    () => buildMarketsFromAliases(aliases, marketData, infoMap, graphNodes, ammB),
    [aliases, marketData, infoMap, graphNodes, ammB],
  );
  const relatedMarkets = useMemo(
    () =>
      market ? allMarkets.filter((m) => market.related.includes(m.alias)) : [],
    [allMarkets, market],
  );

  const [evidence, setEvidence] = useState<Selection[]>([]);
  useEffect(() => setEvidence([]), [alias]);

  // Related variables that can be added right now under the current evidence
  // set (i.e. share a clique with target + all existing evidence) — plus the
  // ones already in evidence so the user can remove them.
  const relatedQuickAdd = useMemo(() => {
    if (!market) return [];
    const candidates = evidenceCandidates(
      market.alias,
      evidence,
      allMarkets,
      graphNodes,
    );
    const candidateSet = new Set(candidates.map((m) => m.alias));
    return relatedMarkets.filter(
      (m) =>
        candidateSet.has(m.alias) || evidence.some((e) => e.alias === m.alias),
    );
  }, [market, evidence, allMarkets, graphNodes, relatedMarkets]);

  const safeMarket = market ?? {
    alias,
    name: alias,
    short: alias,
    category: "",
    description: "",
    states: [{ name: "—", prob: 0 }],
    volume: 0,
    volume_ss: 0,
    ops: 0,
    b: 0,
    related: [],
  };
  const { probs, loading } = useConditional(safeMarket as any, evidence);
  // True while a conditional query is in flight OR the target's marginal
  // probabilities haven't loaded yet (ensureVariables on mount) — drives the
  // fade/spinner on the probability displays.
  const probsLoading = loading || !market.probsLoaded;

  // History (ProbabilityUpdated notices) for the chart + recent activity.
  const [history, setHistory] = useState<ProbPoint[]>([]);
  const fetchHistory = useCallback(async () => {
    if (!appAddress) return;
    try {
      const result = await getOutputs(
        {
          tags: [alias],
          type: "notice",
          order_by: "input_index",
          order_dir: "asc",
          page_size: 100,
        },
        getInspectOptions(config),
      );
      const points: ProbPoint[] = result.data
        .filter((d: any) => d.probabilities !== undefined)
        .map((d: any) => ({
          probabilities: (d.probabilities as number[]).map(
            (p) => Number(p) / PRECISION_FACTOR,
          ),
          volume: Number(d.volume ?? 0) / 1e18,
          volume_ss: Number(d.volume_ss ?? 0) / 1e18,
          timestamp: Number(d._blockTimestamp ?? d.timestamp ?? 0),
        }));
      setHistory(points);
    } catch (err) {
      console.error("history fetch failed", err);
    }
  }, [appAddress, alias, config]);

  useEffect(() => {
    if (appAddress) fetchHistory();
  }, [appAddress, fetchHistory]);

  // A trade moves the target plus everything sharing its cliques (evidence
  // included), so force-refresh those and the history chart.
  const handleReported = useCallback(() => {
    fetchHistory();
    ensureVariables([alias, ...(market?.related ?? [])], { force: true });
  }, [fetchHistory, ensureVariables, alias, market]);

  // Manual reload of the displayed probabilities, volume & activity
  // (authoritative re-read), the history chart, and the header balance.
  // Useful after a report, while the backend catches up.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        ensureVariables([alias, ...(market?.related ?? [])], { force: true }),
        fetchHistory(),
        refreshUserInfo(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, ensureVariables, fetchHistory, refreshUserInfo, alias, market]);

  // Once the graph has loaded, an alias that isn't among the unresolved
  // variables is genuinely unavailable (resolved or unknown).
  if (aliases.length > 0 && !aliases.includes(alias)) {
    return (
      <div className="max-w-[700px] mx-auto my-20 px-7 text-center">
        <div className="text-xl font-semibold">Market not found</div>
        <div className="mt-2 text-ink3">
          <Link href="/" className="text-accent">
            ← Back to Markets
          </Link>
        </div>
      </div>
    );
  }

  const isBinary = market.states.length === 2;
  const isConditional = evidence.length > 0;
  const marginal = market.states.map((s) => s.prob);

  const chartLabels = history.map((h) =>
    h.timestamp > 0
      ? new Date(h.timestamp * 1000).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        })
      : "",
  );

  return (
    <div className="px-4 md:px-7 pt-6 pb-14 max-w-[1500px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-7 items-start animate-in">
      <div className="min-w-0 flex flex-col gap-[18px]">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-ink3">
            <Link href="/" className="text-ink3 no-underline">
              Markets
            </Link>
            <span className="mx-1.5">›</span>
            <span>{market.category}</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || !appAddress}
            title="Reload probabilities, volume & activity"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-[12px] font-medium text-ink2 hover:bg-line2 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Hero */}
        <div className="flex justify-between items-start gap-7">
          <div className="flex-1 min-w-0">
            <div className="flex gap-1.5 mb-3 flex-wrap">
              <Pill>{market.category}</Pill>
              {market.related.length > 0 && (
                <Pill>⇄ {market.related.length} related</Pill>
              )}
              {market.closes && (
                <Pill tone="outline">Closes {market.closes}</Pill>
              )}
            </div>
            <h1 className="text-[30px] font-semibold tracking-tight leading-tight text-ink text-pretty">
              {market.name}
            </h1>
            {market.description && (
              <p className="mt-3 text-sm text-ink2 leading-relaxed max-w-[620px]">
                {market.description}
              </p>
            )}
          </div>
          {isBinary && (
            <HeroNumber
              value={probs[0] ?? 0}
              marginal={marginal[0] ?? 0}
              isConditional={isConditional}
              loading={probsLoading}
              evidence={evidence}
              relatedMarkets={relatedMarkets}
              stateName={
                (probs[0] ?? 0) > 50
                  ? market.states[0].name
                  : market.states[1].name
              }
            />
          )}
        </div>

        {/* Evidence rail */}
        <EvidenceRail
          targetAlias={market.alias}
          evidence={evidence}
          setEvidence={setEvidence}
          allMarkets={allMarkets}
          graphNodes={graphNodes}
          loading={loading}
        />

        {/* Multi-state snapshot */}
        {!isBinary && (
          <div
            className={`bg-surface rounded-card p-[22px] transition-colors ${
              isConditional ? "border border-accent" : "border border-line"
            }`}
          >
            <div className="text-xs font-medium mb-3.5 text-ink3">
              {isConditional
                ? "Conditional probabilities"
                : "Current probabilities"}
            </div>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${market.states.length}, 1fr)`,
              }}
            >
              {market.states.map((s, i) => {
                const p = probs[i] ?? 0;
                const delta = p - (marginal[i] ?? 0);
                const up = delta >= 0;
                return (
                  <div
                    key={i}
                    className={`p-3.5 rounded-xl ${
                      i === 0
                        ? "bg-accent-soft text-accent-deep border border-accent"
                        : "bg-line2 text-ink border border-transparent"
                    }`}
                  >
                    <div className="text-[11px] font-medium opacity-80">
                      {s.name}
                    </div>
                    <div
                      className={`mt-1 font-mono text-[26px] font-semibold tracking-tight ${probsLoading ? "loading-value" : ""}`}
                    >
                      {(p * 100).toFixed(0)}
                      <span className="text-sm opacity-60">%</span>
                    </div>
                    {isConditional && (
                      <div className="mt-1 text-[10px] font-mono opacity-70">
                        was {((marginal[i] ?? 0) * 100).toFixed(0)}%{" "}
                        <span className={up ? "text-accent" : "text-no"}>
                          {up ? "↑" : "↓"}
                          {Math.abs(delta * 100).toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="bg-surface rounded-card border border-line p-[22px]">
          <div className="flex justify-between items-center mb-3">
            <div className="text-sm font-semibold">
              {isBinary ? "Price history" : "State probabilities over time"}
            </div>
            {history.length === 0 && (
              <span className="text-[11px] text-ink3 font-mono">
                no history yet
              </span>
            )}
          </div>
          <div className="h-[260px]">
            {history.length > 0 ? (
              isBinary ? (
                <ProbabilityAreaChart
                  data={history.map((h, i) => ({
                    label: chartLabels[i],
                    value: h.probabilities[0] ?? 0,
                  }))}
                />
              ) : (
                <MultiLineChart
                  labels={chartLabels}
                  series={market.states.map((s, idx) => ({
                    name: s.name,
                    values: history.map((h) => h.probabilities[idx] ?? 0),
                  }))}
                />
              )
            ) : (
              <div className="h-full grid place-items-center text-ink3 text-xs">
                No probability history available
              </div>
            )}
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Volume", `${market.volume.toFixed(4)} ETH`, "buy side"],
            ["Reports", market.ops.toLocaleString(), "total"],
            [
              "Liquidity b",
              market.b ? `${market.b.toFixed(4)} ETH` : "—",
              "LMSR",
            ],
            ["Short sell", `${market.volume_ss.toFixed(4)} ETH`, "volume"],
          ].map(([k, v, sub]) => (
            <div
              key={k}
              className="bg-surface border border-line rounded-card p-[22px]"
            >
              <div className="text-xs text-ink3 font-medium">{k}</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tracking-tight">
                {v}
              </div>
              <div className="mt-0.5 text-[11px] text-ink3">{sub}</div>
            </div>
          ))}
        </div>

        {/* Related variables (filtered to the current clique-valid candidates) */}
        {relatedQuickAdd.length > 0 && (
          <div className="bg-surface rounded-card border border-line p-[22px] flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="text-sm font-semibold">Related variables</div>
              <span className="text-[11px] text-ink3">
                Quick-add any of these as evidence ↑
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {relatedQuickAdd.map((rm) => {
                const inEv = evidence.find((e) => e.alias === rm.alias);
                return (
                  <div
                    key={rm.alias}
                    className={`flex justify-between items-center p-3.5 rounded-xl ${
                      inEv
                        ? "border border-accent bg-accent-soft"
                        : "border border-line"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/variable/${encodeURIComponent(rm.alias)}`}
                        className="no-underline text-inherit text-[13px] font-semibold block truncate"
                      >
                        {rm.short}
                      </Link>
                      <div className="text-[11px] text-ink3 mt-0.5">
                        {rm.category} · {rm.states.length} states
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        inEv
                          ? setEvidence(
                              evidence.filter((e) => e.alias !== rm.alias),
                            )
                          : setEvidence([
                              ...evidence,
                              { alias: rm.alias, stateIdx: 0 },
                            ])
                      }
                      className={`ml-2.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold shrink-0 ${
                        inEv ? "bg-accent text-ink" : "bg-line2 text-ink2"
                      }`}
                    >
                      {inEv ? "✓ evidence" : "+ Use as evidence"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent activity (from probability updates) */}
        {history.length > 1 && (
          <div className="bg-surface rounded-card border border-line overflow-hidden">
            <div className="flex justify-between items-center px-[22px] py-4 border-b border-line">
              <div className="text-sm font-semibold">Recent activity</div>
              <Pill tone="accent">● Live</Pill>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-ink3 text-[11px]">
                    {["When", "P(top) moved", "Volume", "Short sell"].map(
                      (th, i) => (
                        <th
                          key={th}
                          className={`px-[22px] py-2.5 font-medium whitespace-nowrap ${
                            i >= 2 ? "text-right" : "text-left"
                          }`}
                        >
                          {th}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...history]
                    .slice(1)
                    .reverse()
                    .slice(0, 10)
                    .map((h, idx, arr) => {
                      const realIdx = history.length - 1 - idx;
                      const prev = history[realIdx - 1];
                      const from = prev?.probabilities[0] ?? h.probabilities[0];
                      const to = h.probabilities[0];
                      const up = to >= from;
                      return (
                        <tr key={realIdx} className="border-t border-line2">
                          <td className="px-[22px] py-3 text-ink3 font-mono whitespace-nowrap">
                            {h.timestamp > 0
                              ? new Date(h.timestamp * 1000).toLocaleString()
                              : "-"}
                          </td>
                          <td className="px-[22px] py-3 font-mono text-ink2 whitespace-nowrap">
                            {fmt.pct(from, 1)}{" "}
                            <span className={up ? "text-accent" : "text-no"}>
                              →
                            </span>{" "}
                            <span className="text-ink font-semibold">
                              {fmt.pct(to, 1)}
                            </span>
                          </td>
                          <td className="px-[22px] py-3 font-mono text-right text-ink2 whitespace-nowrap">
                            {h.volume.toFixed(4)} ETH
                          </td>
                          <td className="px-[22px] py-3 font-mono text-right text-ink2 whitespace-nowrap">
                            {h.volume_ss.toFixed(4)} ETH
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Report panel */}
      <ReportPanel
        market={market}
        baselineProbs={probs}
        evidence={evidence}
        relatedMarkets={allMarkets}
        conditionalLoading={probsLoading}
        onReported={handleReported}
      />
    </div>
  );
}

function HeroNumber({
  value,
  marginal,
  isConditional,
  evidence,
  relatedMarkets,
  stateName,
  loading,
}: {
  value: number;
  marginal: number;
  isConditional: boolean;
  evidence: Selection[];
  relatedMarkets: any[];
  stateName: string;
  loading?: boolean;
}) {
  const v = useAnimatedNumber(value);
  const delta = value - marginal;
  return (
    <div className="text-right shrink-0 min-w-[200px]">
      <div
        className={`font-mono text-[56px] font-semibold tracking-tighter leading-none transition-colors ${
          isConditional ? "text-accent-deep" : "text-ink"
        } ${loading ? "loading-value" : ""}`}
      >
        {Math.round(v * 100)}
        <span className="text-[28px] text-accent">%</span>
      </div>
      {isConditional ? (
        <div className="mt-2 flex flex-col gap-1 items-end">
          <div className="text-xs text-accent-deep font-medium max-w-[240px] leading-snug text-right">
            P({stateName}) {plainEnglishEvidence(evidence, relatedMarkets)}
          </div>
          <div className="text-[11px] text-ink3 font-mono flex items-center gap-1">
            <span className={delta >= 0 ? "text-accent" : "text-no"}>
              {delta >= 0 ? "↑" : "↓"}
              {Math.abs(delta * 100).toFixed(1)}pp
            </span>
            <span>from marginal {fmt.pct(marginal, 0)}</span>
          </div>
        </div>
      ) : (
        <div className="text-[11px] mt-1 text-ink3">
          P({stateName}) · marginal
        </div>
      )}
    </div>
  );
}
