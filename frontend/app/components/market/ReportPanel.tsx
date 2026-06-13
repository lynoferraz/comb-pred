"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toHex } from "viem";
import { useApp } from "../../lib/context";
import type { Market, Selection } from "../../lib/market";
import { plainEnglishEvidence } from "../../lib/market";
import { fmt, simReport, pFromSpend } from "../../lib/format";
import { ammQuery } from "../../lib/useAmmQuery";
import { editVariable } from "../../backend-libs/cim/lib";
import type { QueryResult } from "../../lib/cartesi";
import { setExplorerPrefill, liquidationToPrefill } from "../../lib/prefill";
import { useToast } from "../ui/Toast";

function strToBytes32(s: string): string {
  const hex = Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex.padEnd(64, "0");
}

export default function ReportPanel({
  market,
  baselineProbs,
  evidence,
  relatedMarkets,
  conditionalLoading,
  onReported,
}: {
  market: Market;
  baselineProbs: number[];
  evidence: Selection[];
  relatedMarkets: Market[];
  conditionalLoading: boolean;
  onReported: () => void;
}) {
  const {
    config,
    walletAddress,
    walletClient,
    appAddress,
    userFreeFunds,
    userExpected,
    refreshUserInfo,
  } = useApp();
  const router = useRouter();
  const { toast, updateToast } = useToast();
  const isBinary = market.states.length === 2;
  const isConditional = evidence.length > 0;
  const b = market.b || 0;
  const userBalance = userFreeFunds ?? 0;

  const [mode, setMode] = useState<"beginner" | "pro">("beginner");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stateIdx, setStateIdx] = useState(0);
  const [amount, setAmount] = useState("0.0005");
  const [pNew, setPNew] = useState(0.5);
  const [marginPct, setMarginPct] = useState(5);
  const [showAdv, setShowAdv] = useState(false);

  const [bounds, setBounds] = useState<[number, number] | undefined>();
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStateIdx = isBinary ? (side === "yes" ? 0 : 1) : stateIdx;
  const pOld = baselineProbs[currentStateIdx] ?? 0.5;
  const stateName = market.states[currentStateIdx]?.name ?? "";
  const otherProbs = useMemo(
    () => baselineProbs.filter((_, i) => i !== currentStateIdx),
    [baselineProbs, currentStateIdx],
  );

  // ── Edit-bounds query (no value) ────────────────────────────────────────────
  // Runs whenever the (target, state, evidence) tuple changes and a wallet is
  // connected. Bounds clamp the slider and beginner amount; without a wallet
  // we just don't clamp.
  const evKey = JSON.stringify(evidence);
  useEffect(() => {
    if (!walletAddress || !appAddress) {
      setBounds(undefined);
      return;
    }
    let cancelled = false;
    ammQuery(config, {
      varAliases: [market.alias],
      varStates: [currentStateIdx],
      evidenceAliases: evidence.map((e) => e.alias),
      evidenceStates: evidence.map((e) => e.stateIdx),
      userAddress: walletAddress,
    })
      .then((res) => {
        if (cancelled) return;
        const eb = res.user_edit_bounds;
        if (eb && eb.length === 2) setBounds([Number(eb[0]), Number(eb[1])]);
        else setBounds(undefined);
      })
      .catch(() => {
        if (!cancelled) setBounds(undefined);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.alias, currentStateIdx, walletAddress, appAddress, evKey]);

  // Effective clamping bounds: backend bounds when available, otherwise
  // generous defaults.
  const loBound = bounds ? bounds[0] : 0.005;
  const hiBound = bounds ? bounds[1] : 0.995;

  // ── Reset slider when context changes ──────────────────────────────────────
  useEffect(() => {
    const desired = pOld + 0.05;
    setPNew(Math.min(hiBound, Math.max(loBound, desired)));
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStateIdx,
    market.alias,
    JSON.stringify(baselineProbs),
    loBound,
    hiBound,
  ]);

  // ── Live simulation (client-side fallback for the preview) ────────────────
  const amountNum = Math.max(0, parseFloat(amount) || 0);
  const beginnerRawTarget = pFromSpend(b, pOld, amountNum, otherProbs);
  // Clamp beginner target to bounds so the simulation never displays an
  // unreachable push.
  const targetP = Math.min(hiBound, Math.max(loBound, beginnerRawTarget));
  const reportValue = mode === "beginner" ? targetP : pNew;

  const sim = useMemo(
    () => simReport(b, pOld, reportValue, otherProbs),
    [b, pOld, reportValue, otherProbs],
  );

  // ── Authoritative preview (value + user_address): real cost/revenue ───────
  useEffect(() => {
    if (!walletAddress || !appAddress || reportValue <= 0 || reportValue >= 1) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      setPreviewLoading(true);
      ammQuery(config, {
        varAliases: [market.alias],
        varStates: [currentStateIdx],
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
  }, [
    market.alias,
    currentStateIdx,
    reportValue,
    walletAddress,
    appAddress,
    evKey,
  ]);

  // Prefer backend numbers when present; fall back to client sim otherwise.
  const costEth =
    preview?.user_cost_delta !== undefined
      ? Number(preview.user_cost_delta) / 1e18
      : sim.costDelta;
  const revenueEth =
    preview?.user_revenue_delta !== undefined
      ? Number(preview.user_revenue_delta) / 1e18
      : sim.revenueDelta;
  const shares = sim.shares;

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);
    if (!walletClient || !appAddress) {
      setError("Connect wallet first");
      return;
    }
    if (reportValue <= 0 || reportValue >= 1) {
      setError("Pick a probability strictly between 0 and 1");
      return;
    }
    if (bounds && (reportValue < bounds[0] || reportValue > bounds[1])) {
      setError(
        `Outside edit bounds [${bounds[0].toFixed(4)}, ${bounds[1].toFixed(4)}]`,
      );
      return;
    }
    setSubmitting(true);
    const toastId = toast(
      "pending",
      "Submitting forecast…",
      `${market.short || market.name} → ${stateName} at ${fmt.pct(reportValue)}`,
    );
    try {
      // Fund threshold from the cost preview minus the safety margin.
      const threshold = costEth - Math.abs(costEth) * (marginPct / 100);
      const payload = {
        value: toHex(Math.round(reportValue * 1e6)),
        fund_threshold: BigInt(Math.round(threshold * 1e18)),
        var_aliases: [strToBytes32(market.alias)],
        var_states: [toHex(currentStateIdx)],
        evidence_aliases: evidence.map((e) => strToBytes32(e.alias)),
        evidence_states: evidence.map((e) => toHex(e.stateIdx)),
      };
      await editVariable(payload as any, {
        applicationAddress: appAddress,
        client: walletClient,
      });
      updateToast(toastId, "success", "Forecast submitted");
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
      await refreshUserInfo();
      onReported();
    } catch (err: any) {
      updateToast(
        toastId,
        "error",
        "Forecast failed",
        err.message || "Submit report failed",
      );
      setError(err.message || "Submit report failed");
    } finally {
      setSubmitting(false);
    }
  };

  const pushUp = reportValue >= pOld;

  return (
    <div
      className={`bg-surface rounded-[20px] p-[22px] flex flex-col gap-3.5 sticky top-20 transition-colors ${
        isConditional ? "border border-accent" : "border border-line"
      } ${conditionalLoading ? "opacity-65" : ""}`}
    >
      <div className="flex justify-between items-center">
        <div className="text-base font-semibold">Place a forecast</div>
        <div className="flex bg-line2 p-0.5 rounded-full text-[11px]">
          {(["beginner", "pro"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-full capitalize transition-colors ${
                mode === m
                  ? "bg-surface text-ink font-semibold shadow-sm"
                  : "text-ink3"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {isConditional && (
        <div className="bg-accent-soft text-accent-deep border border-accent rounded-xl px-3 py-2.5 text-xs leading-snug">
          <span className="font-semibold">
            Reporting a conditional forecast.
          </span>{" "}
          You're saying what P should be{" "}
          {plainEnglishEvidence(evidence, relatedMarkets)}.
        </div>
      )}

      {/* Multi-state picker */}
      {!isBinary && (
        <div>
          <div className="text-xs font-medium text-ink2 mb-2">
            Pick an outcome to back
          </div>
          <div className="flex flex-col gap-1.5">
            {market.states.map((s, i) => {
              const sel = i === stateIdx;
              return (
                <button
                  key={i}
                  onClick={() => setStateIdx(i)}
                  className={`px-3.5 py-2.5 rounded-xl flex justify-between items-center text-[13px] transition-colors ${
                    sel
                      ? "bg-accent-soft text-accent-deep border border-accent font-semibold"
                      : "bg-line2 text-ink2 border border-transparent font-medium"
                  }`}
                >
                  <span>{s.name}</span>
                  <span className="font-mono font-semibold">
                    {fmt.pct(baselineProbs[i] ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Binary Yes/No */}
      {isBinary && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide("yes")}
            className={`px-3 py-3.5 rounded-[14px] text-left flex flex-col gap-0.5 transition-colors ${
              side === "yes" ? "bg-accent text-ink" : "bg-line2 text-ink2"
            }`}
          >
            <span className="text-[13px]">
              {market.states[0].name}
              {isConditional && " (cond.)"}
            </span>
            <span className="text-[22px] font-mono font-semibold">
              {fmt.pct(baselineProbs[0] ?? 0)}
            </span>
          </button>
          <button
            onClick={() => setSide("no")}
            className={`px-3 py-3.5 rounded-[14px] text-left flex flex-col gap-0.5 transition-colors ${
              side === "no" ? "bg-no text-white" : "bg-line2 text-ink2"
            }`}
          >
            <span className="text-[13px]">
              {market.states[1].name}
              {isConditional && " (cond.)"}
            </span>
            <span className="text-[22px] font-mono font-semibold">
              {fmt.pct(baselineProbs[1] ?? 0)}
            </span>
          </button>
        </div>
      )}

      {/* BEGINNER */}
      {mode === "beginner" && (
        <>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-medium text-ink2">You spend</span>
              <span className="text-[11px] text-ink3">
                Balance:{" "}
                <span className="text-ink2 font-mono">
                  {fmt.eth(userBalance, 4)}
                </span>
              </span>
            </div>
            <div className="bg-line2 rounded-[14px] p-4 flex justify-between items-center">
              <input
                type="number"
                step="0.0001"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent border-0 text-2xl font-semibold font-mono text-ink w-3/5 outline-none p-0"
              />
              <span className="text-sm text-ink2 font-mono">ETH</span>
            </div>
            <div className="flex gap-1.5 mt-2">
              {[
                {
                  l: "25%",
                  v: Math.min(
                    userBalance || b * market.states.length * 0.25,
                    b * market.states.length * 0.25,
                  ),
                },
                {
                  l: "50%",
                  v: Math.min(
                    userBalance || b * market.states.length * 0.5,
                    b * market.states.length * 0.5,
                  ),
                },
                {
                  l: "Max",
                  v: Math.min(
                    userBalance || b * market.states.length * 0.99,
                    b * market.states.length * 0.99,
                  ),
                },
              ].map((p) => (
                <button
                  key={p.l}
                  onClick={() => setAmount(p.v.toFixed(4))}
                  className="px-2.5 py-1 rounded-full bg-line2 text-[11px] font-medium text-ink2"
                >
                  {p.l}
                </button>
              ))}
            </div>
            {bounds && beginnerRawTarget > hiBound && (
              <div className="mt-2 text-[11px] text-ink3 font-mono">
                Capped at edit-bounds upper limit {hiBound.toFixed(4)}.
              </div>
            )}
          </div>

          <div
            className={`p-4 rounded-[14px] flex flex-col gap-2.5 ${
              side === "no" && isBinary ? "bg-no-soft" : "bg-accent-soft"
            }`}
          >
            <div className="flex justify-between items-baseline">
              <span
                className={`text-xs font-medium ${
                  side === "no" && isBinary
                    ? "text-no-deep"
                    : "text-accent-deep"
                }`}
              >
                If{" "}
                {isBinary ? (side === "yes" ? "Yes" : "No") : `"${stateName}"`}{" "}
                wins
                {isConditional && (
                  <span className="opacity-70"> · given evidence</span>
                )}
              </span>
              <span
                className={`text-[22px] font-semibold font-mono whitespace-nowrap ${
                  side === "no" && isBinary
                    ? "text-no-deep"
                    : "text-accent-deep"
                }`}
              >
                +{fmt.eth(Math.max(0, revenueEth), 4)}{" "}
                <span className="text-[13px]">ETH</span>
              </span>
            </div>
            <div className="h-px bg-black/10" />
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-ink2">You'd get</span>
              <span className="font-mono text-ink font-semibold whitespace-nowrap">
                {fmt.eth(shares * 1000000, 1)}u shares
              </span>
            </div>
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-ink2">Cost now</span>
              <span className="font-mono text-ink font-semibold whitespace-nowrap">
                {fmt.eth(Math.abs(costEth), 5)} ETH
              </span>
            </div>
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-ink2">
                Pushes {isConditional ? "conditional " : ""}probability to
              </span>
              <span className="font-mono text-[13px] font-semibold whitespace-nowrap">
                <span className="text-ink3">{fmt.pct(pOld, 1)}</span>
                <span className="text-ink3 mx-1">→</span>
                <span
                  className={
                    side === "no" && isBinary
                      ? "text-no-deep"
                      : "text-accent-deep"
                  }
                >
                  {fmt.pct(targetP, 1)}
                </span>
              </span>
            </div>
          </div>
        </>
      )}

      {/* PRO */}
      {mode === "pro" && (
        <>
          <div>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-xs font-medium text-ink2">
                Target {isConditional ? "conditional " : ""}probability
              </span>
              <span className="font-mono text-[11px] text-ink3">
                p₀ = <span className="text-ink2">{pOld.toFixed(4)}</span>
              </span>
            </div>
            <div className="bg-line2 rounded-[14px] px-4 py-3 flex items-baseline gap-2">
              <input
                type="number"
                step={0.01}
                min={loBound}
                max={hiBound}
                value={pNew.toFixed(4)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isFinite(v)) return;
                  setPNew(Math.min(hiBound, Math.max(loBound, v)));
                }}
                className="bg-transparent border-0 outline-none font-mono text-[28px] font-semibold text-ink tracking-tight flex-1 min-w-0 p-0"
              />
              <span
                className={`font-mono text-xs font-semibold whitespace-nowrap ${
                  pushUp ? "text-accent" : "text-no"
                }`}
              >
                {pushUp ? "+" : ""}
                {((pNew - pOld) * 100).toFixed(2)}pp
              </span>
            </div>
            <input
              type="range"
              min={loBound}
              max={hiBound}
              step={0.0001}
              value={pNew}
              onChange={(e) => setPNew(parseFloat(e.target.value))}
              className="w-full mt-3 accent-[var(--color-accent)]"
            />
            <div className="flex justify-between text-[10px] font-mono text-ink3 mt-0.5">
              <span>{loBound.toFixed(2)}</span>
              <span>{((loBound + hiBound) / 2).toFixed(2)}</span>
              <span>{hiBound.toFixed(2)}</span>
            </div>
            {bounds && (
              <div className="mt-1 text-[10px] font-mono text-ink3">
                Edit bounds: [{bounds[0].toFixed(4)}, {bounds[1].toFixed(4)}]
              </div>
            )}
          </div>

          <div className="bg-line2 rounded-[14px] p-3.5 flex flex-col gap-2">
            {[
              [
                "Shares received",
                fmt.eth(shares * 1000000, 1) + "u",
                "text-ink",
              ],
              ["Cost now", fmt.eth(Math.abs(costEth), 5) + " ETH", "text-ink"],
              [
                "Revenue if right",
                (revenueEth >= 0 ? "+" : "−") +
                  fmt.eth(Math.abs(revenueEth), 5) +
                  " ETH",
                revenueEth >= 0 ? "text-accent" : "text-no",
              ],
            ].map(([k, v, color]) => (
              <div key={k} className="flex justify-between text-xs gap-2">
                <span className="text-ink2">{k}</span>
                <span
                  className={`font-mono font-semibold whitespace-nowrap ${color}`}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowAdv((v) => !v)}
            className="text-ink3 text-[11px] font-medium flex items-center gap-1 self-start"
          >
            {showAdv ? "▾" : "▸"} Fund threshold & safety margin
          </button>
          {showAdv && (
            <div className="p-3.5 border border-line rounded-[14px] flex flex-col gap-2.5">
              <div className="flex justify-between text-xs gap-2">
                <span className="text-ink2">Auto-revert if cost exceeds</span>
                <span className="font-mono font-semibold text-ink whitespace-nowrap">
                  {fmt.eth(Math.abs(costEth) * (1 + marginPct / 100), 5)} ETH
                </span>
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-ink3 mb-1">
                  <span>Margin</span>
                  <span className="font-mono">{marginPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={marginPct}
                  onChange={(e) => setMarginPct(+e.target.value)}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            </div>
          )}

          {/* Current position / liquidation — discrete, from the live preview */}
          {preview?.user_liquidation && (
            <LiquidationCard
              liquidation={preview.user_liquidation}
              markets={relatedMarkets}
              baselineExpected={userExpected}
              onOpenExplorer={() => {
                const prefill = liquidationToPrefill(
                  preview.user_liquidation!.report,
                );
                setExplorerPrefill(prefill);
                router.push("/explorer");
              }}
            />
          )}
        </>
      )}

      {error && (
        <div className="text-no text-xs font-medium bg-no-soft border border-no/30 rounded-xl px-3 py-2.5">
          {error}
        </div>
      )}

      {submitted ? (
        <div className="bg-accent-soft text-accent-deep px-4 py-4 rounded-[14px] flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-accent text-ink grid place-items-center font-bold">
            ✓
          </div>
          <div>
            <div className="text-[13px] font-semibold">Forecast submitted</div>
            <div className="text-[11px] opacity-80 font-mono mt-0.5">
              reported P({stateName}) = {reportValue.toFixed(4)}
              {isConditional && ` · conditional on ${evidence.length}`}
            </div>
          </div>
        </div>
      ) : walletAddress ? (
        <button
          onClick={handleSubmit}
          disabled={submitting || previewLoading}
          className="bg-ink text-accent px-4 py-4 rounded-[14px] text-[15px] font-semibold disabled:opacity-60 transition-opacity hover:opacity-90"
        >
          {submitting
            ? "Submitting…"
            : mode === "beginner"
              ? `Buy ${fmt.eth(shares * 1000000, 1)}u ${stateName} shares`
              : `Submit at ${pNew.toFixed(4)}`}
        </button>
      ) : (
        <div className="text-center text-xs text-ink3 py-3">
          Connect a wallet to report.
        </div>
      )}

      <div className="text-[10px] text-ink3 text-center font-mono">
        Settled by AMM · LMSR scoring rule
        {b > 0 ? ` · b = ${b.toFixed(4)} ETH` : ""}
      </div>
    </div>
  );
}

// ── Liquidation card (shared between ReportPanel and Explorer) ─────────────
//
// `liquidation` is the backend's user_liquidation:
//   { report: {variables: {alias: stateIdx}, evidence: {alias: stateIdx}, value?},
//     expected_free_funds: <wei> }
function LiquidationCard({
  liquidation,
  markets,
  baselineExpected,
  onOpenExplorer,
  onApply,
}: {
  liquidation: { report: any; expected_free_funds: number };
  markets: Market[];
  // User's overall expected balance in ETH; when present we show the delta
  // vs. that baseline so the sign reflects favorable/unfavorable, not just
  // "shares had liquidation value" (which is always non-negative).
  baselineExpected?: number;
  onOpenExplorer?: () => void;
  onApply?: () => void;
}) {
  const report = liquidation.report || {};
  const free = Number(liquidation.expected_free_funds || 0) / 1e18;
  const delta =
    baselineExpected !== undefined ? free - baselineExpected : undefined;
  const lookup = (alias: string) => markets.find((m) => m.alias === alias);
  const varEntries = Object.entries(report.variables ?? {});
  const evEntries = Object.entries(report.evidence ?? {});
  const fmtPair = (alias: string, state: any) => {
    const m = lookup(alias);
    const name = m?.short || alias;
    const sname = m?.states[Number(state)]?.name ?? String(state);
    return `${name} = ${sname}`;
  };
  return (
    <div className="rounded-[14px] border border-line p-3.5 flex flex-col gap-2 bg-line2/60">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold tracking-widest uppercase text-ink3">
          Liquidation
        </span>
        <div className="flex items-baseline gap-2">
          {delta !== undefined && (
            <span
              title="Liquidation value − your overall expected balance"
              className={`font-mono text-[11px] font-semibold ${
                delta >= 0 ? "text-accent" : "text-no"
              }`}
            >
              {fmt.signed(delta, 5)} <span className="text-ink3">vs exp.</span>
            </span>
          )}
          <span className="font-mono text-xs font-semibold text-accent-deep">
            {fmt.eth(free, 5)} ETH
          </span>
        </div>
      </div>
      {varEntries.length > 0 && (
        <div className="text-[11px] text-ink2 leading-snug">
          <span className="text-ink3">At </span>
          {varEntries.map(([a, s]) => fmtPair(a, s)).join(", ")}
          {typeof report.value === "number" && (
            <span className="text-ink3"> · p={report.value.toFixed(4)}</span>
          )}
        </div>
      )}
      {evEntries.length > 0 && (
        <div className="text-[11px] text-ink2 leading-snug">
          <span className="text-ink3">Given </span>
          {evEntries.map(([a, s]) => fmtPair(a, s)).join(", ")}
        </div>
      )}
      <div className="flex gap-2 mt-1">
        {onApply && (
          <button
            onClick={onApply}
            className="flex-1 bg-line2 border border-line text-ink text-[12px] font-semibold py-2 rounded-lg hover:bg-line transition-colors"
          >
            Apply liquidation
          </button>
        )}
        {onOpenExplorer && (
          <button
            onClick={onOpenExplorer}
            className="flex-1 bg-ink text-accent text-[12px] font-semibold py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Open in Explorer →
          </button>
        )}
      </div>
    </div>
  );
}

export { LiquidationCard };
