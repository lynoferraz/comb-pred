"use client";

import { useEffect, useMemo, useState } from "react";
import { toHex } from "viem";
import { useApp } from "../lib/context";
import {
  buildMarkets,
  composePhrase,
  cliqueCandidates,
  type Market,
  type Selection,
} from "../lib/market";
import { fmt } from "../lib/format";
import { useJoint, useAnimatedNumber, ammQuery } from "../lib/useAmmQuery";
import type { QueryResult } from "../lib/cartesi";
import { editVariable } from "../backend-libs/cim/lib";
import Pill from "../components/ui/Pill";
import { LiquidationCard } from "../components/market/ReportPanel";
import { takeExplorerPrefill } from "../lib/prefill";

function strToBytes32(s: string): string {
  const hex = Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex.padEnd(64, "0");
}

export default function ExplorerPage() {
  const { variables, infoMap, graphNodes, ammB, config, walletAddress, walletClient, appAddress, userExpected } =
    useApp();
  const markets = useMemo(
    () => buildMarkets(variables, infoMap, graphNodes, ammB),
    [variables, infoMap, graphNodes, ammB],
  );

  const [targets, setTargets] = useState<Selection[]>([]);
  const [evidence, setEvidence] = useState<Selection[]>([]);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Handoff from another screen (Detail report panel or Dashboard) ─────────
  // sessionStorage payload is consumed once.
  useEffect(() => {
    const p = takeExplorerPrefill();
    if (!p) return;
    if (p.targets) setTargets(p.targets);
    if (p.evidence) setEvidence(p.evidence);
    if (typeof p.value === "number") setValue(p.value.toFixed(4));
  }, []);

  const joint = useJoint(targets, evidence);
  const marginalJoint = useJoint(targets, []);
  const delta = joint.cellProb - marginalJoint.cellProb;
  const isConditional = evidence.length > 0;

  // Effective probability to report (typed value, defaulting to cellProb).
  const reportValue = value !== "" ? parseFloat(value) : joint.cellProb;
  const validReportValue =
    Number.isFinite(reportValue) && reportValue > 0 && reportValue < 1;

  // ── Backend preview: cost, revenue, edit_bounds, etc. (needs wallet) ──────
  const tKey = JSON.stringify(targets);
  const evKey = JSON.stringify(evidence);
  useEffect(() => {
    if (
      !walletAddress ||
      !appAddress ||
      targets.length === 0 ||
      !validReportValue
    ) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      setPreviewLoading(true);
      ammQuery(config, {
        varAliases: targets.map((t) => t.alias),
        varStates: targets.map((t) => t.stateIdx),
        evidenceAliases: evidence.map((e) => e.alias),
        evidenceStates: evidence.map((e) => e.stateIdx),
        value: reportValue,
        userAddress: walletAddress,
      })
        .then((res) => {
          if (!cancelled) setPreview(res);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey, evKey, reportValue, walletAddress, appAddress, validReportValue]);

  const bounds = preview?.user_edit_bounds as [number, number] | undefined;
  const costEth =
    preview?.user_cost_delta !== undefined
      ? Number(preview.user_cost_delta) / 1e18
      : undefined;
  const revenueEth =
    preview?.user_revenue_delta !== undefined
      ? Number(preview.user_revenue_delta) / 1e18
      : undefined;
  // shares = winDelta = revenueDelta + costDelta (signed; costDelta is
  // negative when paying, so shares = revenue + cost = revenue - |cost|).
  const shares =
    costEth !== undefined && revenueEth !== undefined
      ? revenueEth + costEth
      : undefined;
  const outOfBounds =
    !!bounds && validReportValue && (reportValue < bounds[0] || reportValue > bounds[1]);

  const handleSubmit = async () => {
    setError(null);
    if (!walletClient || !appAddress) {
      setError("Connect wallet first");
      return;
    }
    if (!validReportValue) {
      setError("Pick a probability strictly between 0 and 1");
      return;
    }
    if (outOfBounds && bounds) {
      setError(
        `Outside edit bounds [${bounds[0].toFixed(4)}, ${bounds[1].toFixed(4)}]`,
      );
      return;
    }
    setSubmitting(true);
    try {
      // Use the live preview's cost for the fund threshold (5% safety margin).
      const c = costEth ?? 0;
      const threshold = c - Math.abs(c) * 0.05;

      const payload = {
        value: toHex(Math.round(reportValue * 1e6)),
        fund_threshold: BigInt(Math.round(threshold * 1e18)),
        var_aliases: targets.map((t) => strToBytes32(t.alias)),
        var_states: targets.map((t) => toHex(t.stateIdx)),
        evidence_aliases: evidence.map((e) => strToBytes32(e.alias)),
        evidence_states: evidence.map((e) => toHex(e.stateIdx)),
      };
      await editVariable(payload as any, {
        applicationAddress: appAddress,
        client: walletClient,
      });
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4500);
    } catch (err: any) {
      setError(err.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-7 pt-9 pb-14 max-w-[1400px] mx-auto flex flex-col gap-6 animate-in">
      {/* Hero */}
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <Pill tone="accent">◆ Joint forecasts</Pill>
          <h1 className="mt-2 text-[40px] font-semibold tracking-tight leading-none text-ink">
            Explorer
          </h1>
          <p className="mt-2.5 text-base text-ink2 max-w-[620px] leading-snug">
            Ask any question of the market. Predict the joint of multiple
            outcomes, condition on what you already know.
          </p>
        </div>
        {targets.length === 0 && markets.length >= 2 && (
          <button
            onClick={() => {
              // Pick a clique with ≥2 non-underscore variables so the
              // example respects the same junction-tree constraint as the
              // picker; fall back to the first two markets if no such
              // clique exists.
              const pair = (() => {
                for (const clique of graphNodes) {
                  const real = clique.filter((a) => !a.startsWith("_"));
                  if (real.length >= 2) {
                    const m1 = markets.find((m) => m.alias === real[0]);
                    const m2 = markets.find((m) => m.alias === real[1]);
                    if (m1 && m2) return [m1.alias, m2.alias];
                  }
                }
                return [markets[0].alias, markets[1].alias];
              })();
              setTargets([
                { alias: pair[0], stateIdx: 0 },
                { alias: pair[1], stateIdx: 0 },
              ]);
            }}
            className="px-3.5 py-2 rounded-full border border-line bg-surface text-ink2 text-[13px]"
          >
            ✨ Try an example
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[520px_minmax(0,1fr)] gap-6 items-start">
        {/* LEFT: configuration */}
        <div className="flex flex-col gap-[18px]">
          <VariableSection
            kind="target"
            title="Predict the joint of"
            empty="Add one or more variables to compose a forecast."
            items={targets}
            setItems={setTargets}
            otherItems={evidence}
            markets={markets}
            graphNodes={graphNodes}
          />
          <VariableSection
            kind="evidence"
            title="Conditional on"
            empty="Optional. Add variables you want to condition on."
            items={evidence}
            setItems={setEvidence}
            otherItems={targets}
            markets={markets}
            graphNodes={graphNodes}
          />
        </div>

        {/* RIGHT: result */}
        <div className="flex flex-col gap-[18px]">
          {targets.length === 0 ? (
            <div className="bg-surface rounded-card border border-dashed border-line p-12 text-center flex flex-col gap-2">
              <div className="text-3xl opacity-50">◆</div>
              <div className="text-sm font-semibold text-ink2">
                Pick a variable to start
              </div>
              <div className="text-[13px] text-ink3 max-w-[360px] mx-auto leading-relaxed">
                Add one variable to predict its marginal probability, or two-plus
                to ask a joint question.
              </div>
            </div>
          ) : (
            <>
              <ResultCard
                targets={targets}
                evidence={evidence}
                cellProb={joint.cellProb}
                marginalProb={marginalJoint.cellProb}
                delta={delta}
                isConditional={isConditional}
                loading={joint.loading}
                markets={markets}
              />
              <JointTable
                targets={targets}
                setTargets={setTargets}
                cells={joint.cells}
                marginals={joint.marginals}
                markets={markets}
              />

              {/* Current position / liquidation — discrete, from the live preview */}
              {preview?.user_liquidation && (
                <LiquidationCard
                  liquidation={preview.user_liquidation}
                  markets={markets}
                  baselineExpected={userExpected}
                  onApply={() => {
                    const r = preview.user_liquidation!.report;
                    if (!r) return;
                    const nextTargets: Selection[] = Object.entries(
                      r.variables ?? {},
                    ).map(([alias, s]) => ({ alias, stateIdx: Number(s) }));
                    const nextEvidence: Selection[] = Object.entries(
                      r.evidence ?? {},
                    ).map(([alias, s]) => ({ alias, stateIdx: Number(s) }));
                    if (nextTargets.length > 0) setTargets(nextTargets);
                    setEvidence(nextEvidence);
                    if (typeof r.value === "number")
                      setValue(r.value.toFixed(4));
                  }}
                />
              )}

              {/* Submit */}
              <div className="bg-surface rounded-card border border-line p-[22px] flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-ink2 whitespace-nowrap">
                    Report this cell at
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    min={bounds ? bounds[0] : 0}
                    max={bounds ? bounds[1] : 1}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={joint.cellProb.toFixed(4)}
                    className="flex-1 bg-line2 border border-line rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-ink4"
                  />
                  {previewLoading && (
                    <span className="text-[11px] text-ink3 font-mono">
                      <span className="cim-spinner" /> querying…
                    </span>
                  )}
                </div>

                {/* Backend preview (cost / revenue / shares / bounds) */}
                {walletAddress && (preview || previewLoading) && (
                  <div className="bg-line2 rounded-xl p-3.5 flex flex-col gap-2">
                    {bounds && (
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-ink3">Edit bounds</span>
                        <span
                          className={`font-semibold ${
                            outOfBounds ? "text-no" : "text-ink"
                          }`}
                        >
                          [{bounds[0].toFixed(4)}, {bounds[1].toFixed(4)}]
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-ink2">Shares</span>
                      <span className="font-mono font-semibold text-ink">
                        {shares !== undefined ? fmt.eth(shares, 4) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-ink2">Cost now</span>
                      <span className="font-mono font-semibold text-ink">
                        {costEth !== undefined
                          ? fmt.eth(Math.abs(costEth), 5) + " ETH"
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-ink2">Revenue if right</span>
                      <span
                        className={`font-mono font-semibold ${
                          (revenueEth ?? 0) >= 0 ? "text-accent" : "text-no"
                        }`}
                      >
                        {revenueEth !== undefined
                          ? (revenueEth >= 0 ? "+" : "−") +
                            fmt.eth(Math.abs(revenueEth), 5) +
                            " ETH"
                          : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-no text-xs font-medium bg-no-soft border border-no/30 rounded-xl px-3 py-2.5">
                    {error}
                  </div>
                )}
                {submitted ? (
                  <div className="bg-accent-soft text-accent-deep border border-accent rounded-[14px] px-4 py-4 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-accent text-ink grid place-items-center font-bold">
                      ✓
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold">
                        Joint forecast submitted
                      </div>
                      <div className="text-[11px] opacity-85 font-mono mt-0.5">
                        joint cell across {targets.length} variable
                        {targets.length === 1 ? "" : "s"}
                        {isConditional ? ` · conditional on ${evidence.length}` : ""}
                      </div>
                    </div>
                  </div>
                ) : walletAddress ? (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || previewLoading || outOfBounds || !validReportValue}
                    className="bg-ink text-accent px-5 py-4 rounded-[14px] text-[15px] font-semibold disabled:opacity-60 hover:opacity-90 transition-opacity"
                  >
                    {submitting
                      ? "Submitting…"
                      : outOfBounds
                        ? "Out of edit bounds"
                        : `Submit forecast at ${reportValue.toFixed(4)}`}
                  </button>
                ) : (
                  <div className="text-center text-xs text-ink3 py-2">
                    Connect a wallet to submit a joint forecast.
                  </div>
                )}
                <div className="text-[11px] text-ink3 text-center font-mono">
                  Reporting pushes this cell of the joint distribution. Same LMSR
                  scoring rule as individual markets.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Variable section ────────────────────────────────────────────────────────

function VariableSection({
  kind,
  title,
  empty,
  items,
  setItems,
  otherItems,
  markets,
  graphNodes,
}: {
  kind: "target" | "evidence";
  title: string;
  empty: string;
  items: Selection[];
  setItems: (s: Selection[]) => void;
  otherItems: Selection[];
  markets: Market[];
  graphNodes: string[][];
}) {
  const isTarget = kind === "target";
  // Candidates: variables that share a junction-tree clique with every alias
  // already selected (across targets + evidence). With no selection yet, the
  // helper returns every market.
  const required = useMemo(
    () => [...items.map((x) => x.alias), ...otherItems.map((x) => x.alias)],
    [items, otherItems],
  );
  const available = useMemo(
    () => cliqueCandidates(required, markets, graphNodes),
    [required, markets, graphNodes],
  );
  const [picking, setPicking] = useState(false);

  return (
    <div className="bg-surface rounded-card border border-line p-[18px] flex flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: isTarget ? "var(--color-accent)" : "var(--color-ink4)" }}
        />
        <div className="text-[11px] font-bold tracking-widest uppercase text-ink3">
          {title}
        </div>
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-ink3">· {items.length}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-ink3 leading-snug">{empty}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => {
            const m = markets.find((x) => x.alias === it.alias);
            if (!m) return null;
            return (
              <div
                key={it.alias}
                className={`flex items-center rounded-xl ${
                  isTarget
                    ? "bg-accent-soft border border-accent"
                    : "bg-line2 border border-ink4"
                }`}
              >
                <div className="flex-1 px-3.5 py-2.5 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-ink">{m.short}</span>
                  <select
                    value={it.stateIdx}
                    onChange={(e) =>
                      setItems(
                        items.map((x, idx) =>
                          idx === i ? { ...x, stateIdx: Number(e.target.value) } : x,
                        ),
                      )
                    }
                    className={`bg-transparent text-[12px] font-semibold outline-none cursor-pointer ${
                      isTarget ? "text-accent-deep" : "text-ink"
                    }`}
                  >
                    {m.states.map((s, si) => (
                      <option key={si} value={si}>
                        = {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="px-3 py-2.5 text-ink3 hover:text-ink text-base leading-none"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!picking && available.length > 0 && (
        <button
          onClick={() => setPicking(true)}
          className={`px-3 py-2 rounded-lg border border-dashed text-xs font-medium text-left ${
            isTarget ? "border-accent text-accent-deep" : "border-ink4 text-ink2"
          }`}
        >
          + Add {isTarget ? "variable" : "evidence"}
        </button>
      )}

      {picking && (
        <div className="p-3 border border-line rounded-lg bg-bg flex flex-col gap-1 max-h-72 overflow-y-auto">
          <div className="flex justify-between items-center px-1 pb-1.5">
            <span className="text-[11px] font-semibold text-ink3 uppercase tracking-wide">
              Pick a variable
            </span>
            <button onClick={() => setPicking(false)} className="text-ink3 text-base">
              ×
            </button>
          </div>
          {available.map((m) => (
            <button
              key={m.alias}
              onClick={() => {
                setItems([...items, { alias: m.alias, stateIdx: 0 }]);
                setPicking(false);
              }}
              className="flex justify-between items-center px-2.5 py-2 rounded-md hover:bg-line2 text-left"
            >
              <div>
                <div className="text-[13px] font-medium text-ink">{m.short}</div>
                <div className="text-[10px] font-mono text-ink3 mt-px">
                  {m.category} · {m.states.length} states
                </div>
              </div>
              <span className="text-[11px] font-mono text-ink3">
                {m.states.length === 2
                  ? `${Math.round((m.states[0]?.prob ?? 0) * 100)}% YES`
                  : `${m.states.length}-way`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Result card ─────────────────────────────────────────────────────────────

function ResultCard({
  targets,
  evidence,
  cellProb,
  marginalProb,
  delta,
  isConditional,
  loading,
  markets,
}: {
  targets: Selection[];
  evidence: Selection[];
  cellProb: number;
  marginalProb: number;
  delta: number;
  isConditional: boolean;
  loading: boolean;
  markets: Market[];
}) {
  const v = useAnimatedNumber(cellProb);
  const targetPhrase = composePhrase(targets, markets, "and");
  const evidencePhrase = composePhrase(evidence, markets, "and");
  const up = delta >= 0;
  const showDelta = isConditional && Math.abs(delta) > 1e-6;

  return (
    <div
      className={`bg-surface rounded-[18px] p-7 flex flex-col gap-3 relative transition-colors ${
        isConditional ? "border border-accent" : "border border-line"
      }`}
    >
      {loading && (
        <span className="absolute top-3.5 right-4 text-[11px] text-ink3 font-mono">
          <span className="cim-spinner" /> querying…
        </span>
      )}
      <div className="flex flex-col gap-1">
        <div
          className={`text-[11px] font-bold tracking-widest uppercase ${
            isConditional ? "text-accent-deep" : "text-ink3"
          }`}
        >
          {isConditional ? "Conditional joint probability" : "Joint probability"}
        </div>
        <div className="text-sm text-ink2 leading-snug text-pretty">
          <span className="font-semibold text-ink">{targetPhrase}</span>
          {evidencePhrase && (
            <>
              {" — "}
              <span className="text-accent-deep font-medium">given {evidencePhrase}</span>
            </>
          )}
        </div>
      </div>

      <div
        className={`font-mono text-[72px] font-semibold tracking-tighter leading-none mt-1.5 transition-colors ${
          isConditional ? "text-accent-deep" : "text-ink"
        }`}
      >
        {v.toFixed(4)}
      </div>

      {showDelta ? (
        <div className="flex items-baseline gap-2 font-mono text-xs text-ink3">
          <span>Marginal · {marginalProb.toFixed(4)}</span>
          <span>·</span>
          <span className={up ? "text-accent" : "text-no"}>
            {up ? "↑" : "↓"} {Math.abs(delta * 100).toFixed(2)}pp
          </span>
        </div>
      ) : (
        <div className="font-mono text-xs text-ink3">
          {targets.length === 1
            ? "Single-variable forecast"
            : `${targets.length}-way joint`}
        </div>
      )}
    </div>
  );
}

// ── Joint table ─────────────────────────────────────────────────────────────

function JointTable({
  targets,
  setTargets,
  cells,
  marginals,
  markets,
}: {
  targets: Selection[];
  setTargets: (s: Selection[]) => void;
  cells: { indices: number[]; prob: number }[];
  marginals: number[][];
  markets: Market[];
}) {
  if (targets.length === 1) {
    const m = markets.find((x) => x.alias === targets[0].alias);
    if (!m) return null;
    const dist = marginals[0] || [];
    return (
      <div className="bg-surface rounded-card border border-line p-[22px]">
        <div className="text-[11px] font-bold tracking-widest uppercase text-ink3 mb-3.5">
          Probability over states
        </div>
        <div className="flex flex-col gap-2.5">
          {m.states.map((s, i) => {
            const p = dist[i] ?? 0;
            const sel = i === targets[0].stateIdx;
            return (
              <button
                key={i}
                onClick={() => setTargets([{ ...targets[0], stateIdx: i }])}
                className={`grid items-center gap-3 p-2 rounded-lg text-left ${
                  sel ? "bg-accent-soft" : ""
                }`}
                style={{ gridTemplateColumns: "160px 1fr 80px" }}
              >
                <span className={`text-[13px] ${sel ? "font-semibold" : "font-medium"}`}>
                  {s.name}
                </span>
                <div className="h-2 bg-line2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${p * 100}%`,
                      background: sel ? "var(--color-accent)" : "var(--color-ink4)",
                    }}
                  />
                </div>
                <span className="font-mono text-[13px] font-semibold text-right">
                  {(p * 100).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (targets.length === 2) {
    const m1 = markets.find((x) => x.alias === targets[0].alias);
    const m2 = markets.find((x) => x.alias === targets[1].alias);
    if (!m1 || !m2) return null;
    const cellProb = (i: number, j: number) =>
      cells.find((c) => c.indices[0] === i && c.indices[1] === j)?.prob ?? 0;
    return (
      <div className="bg-surface rounded-card border border-line p-[22px] overflow-hidden">
        <div className="flex justify-between items-baseline mb-3.5">
          <div className="text-[11px] font-bold tracking-widest uppercase text-ink3">
            Full joint distribution
          </div>
          <div className="text-[11px] text-ink3">Click a cell to select it</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate [border-spacing:4px] font-mono text-xs">
            <thead>
              <tr>
                <th />
                {m2.states.map((s, j) => (
                  <th key={j} className="px-2 py-1.5 text-center text-ink2 font-medium text-[10px]">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m1.states.map((s1, i) => (
                <tr key={i}>
                  <th className="px-2.5 py-1.5 text-right font-medium text-ink2 font-sans text-[11px] whitespace-nowrap">
                    {s1.name}
                  </th>
                  {m2.states.map((_, j) => {
                    const p = cellProb(i, j);
                    const sel = i === targets[0].stateIdx && j === targets[1].stateIdx;
                    return (
                      <td key={j} className="p-0">
                        <button
                          onClick={() =>
                            setTargets([
                              { ...targets[0], stateIdx: i },
                              { ...targets[1], stateIdx: j },
                            ])
                          }
                          className={`w-full h-14 rounded-lg flex flex-col justify-center items-center gap-0.5 font-mono text-xs transition-transform ${
                            sel ? "border-2 border-ink font-bold" : "border border-line"
                          }`}
                          style={{
                            background: `color-mix(in srgb, var(--color-accent) ${Math.min(85, p * 220)}%, transparent)`,
                          }}
                        >
                          {p.toFixed(3)}
                          {sel && (
                            <span className="text-[9px] font-bold tracking-wide">
                              ● SELECTED
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3.5 pt-3 border-t border-line2 flex flex-col gap-1.5 font-mono text-[11px] text-ink3">
          <div>
            <span className="text-ink2 font-semibold">{m1.short}:</span>{" "}
            {m1.states
              .map((s, i) => `${s.name} ${((marginals[0]?.[i] ?? 0) * 100).toFixed(0)}%`)
              .join("  ·  ")}
          </div>
          <div>
            <span className="text-ink2 font-semibold">{m2.short}:</span>{" "}
            {m2.states
              .map((s, j) => `${s.name} ${((marginals[1]?.[j] ?? 0) * 100).toFixed(0)}%`)
              .join("  ·  ")}
          </div>
        </div>
      </div>
    );
  }

  // 3+ targets: top cells
  const sorted = [...cells].sort((a, b) => b.prob - a.prob).slice(0, 10);
  const selectedKey = targets.map((x) => x.stateIdx).join("-");
  return (
    <div className="bg-surface rounded-card border border-line p-[22px]">
      <div className="flex justify-between text-[11px] font-bold tracking-widest uppercase text-ink3 mb-3.5">
        <span>Top cells by probability</span>
        <span className="text-ink3 font-mono normal-case tracking-normal">
          {cells.length} total cells
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((cell) => {
          const key = cell.indices.join("-");
          const sel = key === selectedKey;
          return (
            <button
              key={key}
              onClick={() =>
                setTargets(targets.map((tg, i) => ({ ...tg, stateIdx: cell.indices[i] })))
              }
              className={`flex justify-between gap-3 px-3 py-2 rounded-lg items-center text-left ${
                sel ? "bg-accent-soft" : ""
              }`}
            >
              <span
                className={`text-xs ${sel ? "font-semibold text-accent-deep" : "font-medium text-ink2"}`}
              >
                {targets
                  .map((tg, i) => {
                    const m = markets.find((x) => x.alias === tg.alias);
                    return `${m?.short ?? tg.alias}=${m?.states[cell.indices[i]]?.name ?? cell.indices[i]}`;
                  })
                  .join(" · ")}
              </span>
              <span className="font-mono text-xs font-semibold">{cell.prob.toFixed(4)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
