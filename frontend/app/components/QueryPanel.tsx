"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  type AppConfig,
  type QueryResult,
  type LiquidationReport,
  type VariableSummary,
  PRECISION_FACTOR,
  getInspectOptions,
  getVarName,
  getStateName,
} from "../lib/cartesi";
import { useApp } from "../lib/context";
import { queryAmm, editVariable } from "../backend-libs/cim/lib";
import { toHex } from "viem";
import { X, Plus, ArrowUpRight, Search, Send, Settings } from "lucide-react";

const ETH_DECIMALS = 18;
function formatEth(value: number): string {
  return (value / 10 ** ETH_DECIMALS).toFixed(6) + " ETH";
}

interface QueryPanelProps {
  config: AppConfig;
  variables: VariableSummary[];
  nodes: string[][];
  walletAddress?: string;
  allowedAliases?: string[];
  fixedVariable?: { alias: string; state?: number };
}

interface VarSelection {
  alias: string;
  state: number;
}

export default function QueryPanel({
  config,
  variables,
  nodes,
  walletAddress,
  allowedAliases,
  fixedVariable,
}: QueryPanelProps) {
  const { walletClient, appAddress, infoMap, ammB } = useApp();

  const [varSelections, setVarSelections] = useState<VarSelection[]>(
    fixedVariable
      ? [{ alias: fixedVariable.alias, state: fixedVariable.state ?? 0 }]
      : [],
  );
  const [evidenceSelections, setEvidenceSelections] = useState<VarSelection[]>(
    [],
  );
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);

  const [newVarAlias, setNewVarAlias] = useState("");
  const [newVarState, setNewVarState] = useState(0);
  const [newEvidenceAlias, setNewEvidenceAlias] = useState("");
  const [newEvidenceState, setNewEvidenceState] = useState(0);
  const [fundThreshold, setFundThreshold] = useState<string>("");
  const [marginPct, setMarginPct] = useState<number>(5);

  // The current (old) probability from the last no-value query
  const [oldProb, setOldProb] = useState<number | null>(null);

  // b parameter from AMM config (in wei, convert to ETH for formulas)
  const bEth = ammB !== undefined ? ammB / 1e18 : null;

  const allAliases = variables.map((v) => v.alias);
  const baseAliases = allowedAliases
    ? allAliases.filter((a) => allowedAliases.includes(a))
    : allAliases;

  const selectedAliases = [
    ...varSelections.map((v) => v.alias),
    ...evidenceSelections.map((v) => v.alias),
  ];
  const availableAliases =
    selectedAliases.length === 0
      ? baseAliases
      : baseAliases.filter((a) =>
          nodes.some(
            (node) =>
              node.includes(a) &&
              selectedAliases.every((sel) => node.includes(sel)),
          ),
        );

  const addVariable = () => {
    if (!newVarAlias) return;
    if (varSelections.some((v) => v.alias === newVarAlias)) return;
    if (evidenceSelections.some((v) => v.alias === newVarAlias)) return;
    setVarSelections([
      ...varSelections,
      { alias: newVarAlias, state: newVarState },
    ]);
    setNewVarAlias("");
    setNewVarState(0);
    setNewEvidenceAlias("");
    setNewEvidenceState(0);
  };

  const removeVariable = (alias: string) => {
    if (fixedVariable && alias === fixedVariable.alias) return;
    setVarSelections(varSelections.filter((v) => v.alias !== alias));
  };

  const addEvidence = () => {
    if (!newEvidenceAlias) return;
    if (evidenceSelections.some((v) => v.alias === newEvidenceAlias)) return;
    if (varSelections.some((v) => v.alias === newEvidenceAlias)) return;
    setEvidenceSelections([
      ...evidenceSelections,
      { alias: newEvidenceAlias, state: newEvidenceState },
    ]);
    setNewEvidenceAlias("");
    setNewEvidenceState(0);
    setNewVarAlias("");
    setNewVarState(0);
  };

  const removeEvidence = (alias: string) => {
    setEvidenceSelections(evidenceSelections.filter((v) => v.alias !== alias));
  };

  const applyLiquidationReport = (report: LiquidationReport) => {
    const vars: VarSelection[] = Object.entries(report.variables).map(
      ([alias, state]) => ({ alias, state }),
    );
    const evidence: VarSelection[] = Object.entries(report.evidence || {}).map(
      ([alias, state]) => ({ alias, state }),
    );
    setVarSelections(vars);
    setEvidenceSelections(evidence);
    setValue(String(report.value));
  };

  const getVarNStates = (alias: string): number => {
    const v = variables.find((v) => v.alias === alias);
    return v ? v.states_probs.length : 2;
  };

  // ── Alternative value representations ──
  // probability p (the "value"), virtual_share = b * ln(p / old_prob), cost = b * ln((1-p) / (1-old_prob))
  const canConvert =
    bEth !== null && bEth > 0 && oldProb !== null && oldProb > 0 && oldProb < 1;

  const probToVirtualShare = (p: number): number | null => {
    if (!canConvert || p <= 0 || p >= 1) return null;
    return bEth! * Math.log(p / oldProb!);
  };

  const probToCost = (p: number): number | null => {
    if (!canConvert || p <= 0 || p >= 1) return null;
    return bEth! * Math.log((1 - p) / (1 - oldProb!));
  };

  const virtualShareToProb = (vs: number): number | null => {
    if (!canConvert) return null;
    const p = oldProb! * Math.exp(vs / bEth!);
    if (p <= 0 || p >= 1) return null;
    return p;
  };

  const costToProb = (cost: number): number | null => {
    if (!canConvert) return null;
    const p = 1 - (1 - oldProb!) * Math.exp(cost / bEth!);
    if (p <= 0 || p >= 1) return null;
    return p;
  };

  const currentProb = value ? parseFloat(value) : null;
  const currentVS =
    currentProb !== null && currentProb > 0 && currentProb < 1
      ? probToVirtualShare(currentProb)
      : null;
  const currentCost =
    currentProb !== null && currentProb > 0 && currentProb < 1
      ? probToCost(currentProb)
      : null;

  const handleVSChange = (vsStr: string) => {
    const vs = parseFloat(vsStr);
    if (isNaN(vs)) {
      setValue("");
      return;
    }
    const p = virtualShareToProb(vs);
    if (p !== null) setValue(p.toFixed(6));
  };

  const handleCostChange = (costStr: string) => {
    const cost = parseFloat(costStr);
    if (isNaN(cost)) {
      setValue("");
      return;
    }
    const p = costToProb(cost);
    if (p !== null) setValue(p.toFixed(6));
  };

  // ── Auto-fill fund threshold from cost_delta ──
  useEffect(() => {
    if (result?.user_cost_delta !== undefined) {
      const costEth = result.user_cost_delta / 1e18;
      const margin = marginPct / 100;
      const threshold = costEth - Math.abs(costEth) * margin;
      setFundThreshold(threshold.toFixed(6));
    }
  }, [result?.user_cost_delta, marginPct]);

  // ── Query logic ──
  const runQuery = async () => {
    if (varSelections.length === 0) {
      setError("Select at least one variable");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload: any = {
        var_aliases: varSelections.map((v) => v.alias),
        var_states: varSelections.map((v) => v.state),
      };

      if (evidenceSelections.length > 0) {
        payload.evidence_aliases = evidenceSelections.map((e) => e.alias);
        payload.evidence_states = evidenceSelections.map((e) => e.state);
      }

      if (value) {
        payload.value = Math.round(parseFloat(value) * PRECISION_FACTOR);
      }

      if (walletAddress) {
        payload.user_address = walletAddress;
      }

      const report = await queryAmm(payload, {
        ...getInspectOptions(config),
        decode: true,
        decodeModel: "json",
      });

      const qr = report as QueryResult;
      setResult(qr);

      // Extract old probability: find the row matching selected var+evidence states
      if (qr.probabilities?.length > 0) {
        const allSelections = [...varSelections, ...evidenceSelections];
        const matchingRow = qr.probabilities.find((row) =>
          allSelections.every((sel) => row[sel.alias] === sel.state),
        );
        if (matchingRow) {
          const prob = matchingRow.value;
          if (typeof prob === "number" && prob > 0 && prob < 1) {
            setOldProb(prob);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "Query failed");
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (e: FormEvent) => {
    e.preventDefault();
    await runQuery();
  };

  const handleSubmitReport = async () => {
    if (varSelections.length === 0) {
      setError("Select at least one variable");
      return;
    }
    if (!value) {
      setError("Probability value is required to submit a report");
      return;
    }
    if (!walletClient || !appAddress) {
      setError("Connect wallet first");
      return;
    }

    const threshold = fundThreshold
      ? BigInt(Math.round(parseFloat(fundThreshold) * 1e18))
      : BigInt(0);

    setEditLoading(true);
    setError(null);

    try {
      const strToBytes32 = (s: string): string => {
        const hex = Array.from(new TextEncoder().encode(s))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return "0x" + hex.padEnd(64, "0");
      };

      const payload = {
        value: toHex(Math.round(parseFloat(value) * PRECISION_FACTOR)),
        fund_threshold: threshold,
        var_aliases: varSelections.map((v) => strToBytes32(v.alias)),
        var_states: varSelections.map((v) => toHex(v.state)),
        evidence_aliases: evidenceSelections.map((e) => strToBytes32(e.alias)),
        evidence_states: evidenceSelections.map((e) => toHex(e.state)),
      };

      await editVariable(payload as any, {
        applicationAddress: appAddress,
        client: walletClient,
      });

      setError(null);
      await runQuery();
    } catch (err: any) {
      setError(err.message || "Submit report failed");
    } finally {
      setEditLoading(false);
    }
  };

  const usedAliases = new Set([
    ...varSelections.map((v) => v.alias),
    ...evidenceSelections.map((v) => v.alias),
  ]);

  const stepNumberClass =
    "w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center shrink-0";
  const stepTitleClass =
    "text-xs font-black text-slate-900 uppercase tracking-wide";
  const selectClass =
    "flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 ring-blue-500/10 outline-none";
  const inputClass =
    "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 ring-blue-500/10 outline-none";

  return (
    <div className="w-[360px] shrink-0 sticky top-24">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden">
        {/* Header */}
        <div className="p-6 bg-slate-900 text-white">
          <h3 className="font-black italic text-lg tracking-tight">
            PREDICTION LAB
          </h3>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
            Query &amp; Report Engine
          </p>
        </div>

        <form className="p-6 space-y-6" onSubmit={handleQuery}>
          {/* ── Step 1: Query ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className={stepNumberClass}>1</div>
              <span className={stepTitleClass}>Select &amp; Query</span>
            </div>

            {/* Variables */}
            <div className="space-y-3 pl-8">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                Variables
              </label>
              <div className="flex gap-2">
                <select
                  value={newVarAlias}
                  onChange={(e) => setNewVarAlias(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select...</option>
                  {availableAliases
                    .filter((a) => !usedAliases.has(a))
                    .map((a) => (
                      <option key={a} value={a}>
                        {getVarName(infoMap[a], a)}
                      </option>
                    ))}
                </select>
                {newVarAlias && (
                  <select
                    value={newVarState}
                    onChange={(e) => setNewVarState(parseInt(e.target.value))}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 ring-blue-500/10 outline-none"
                  >
                    {Array.from(
                      { length: getVarNStates(newVarAlias) },
                      (_, i) => (
                        <option key={i} value={i}>
                          {getStateName(infoMap[newVarAlias], i)}
                        </option>
                      ),
                    )}
                  </select>
                )}
                <button
                  type="button"
                  onClick={addVariable}
                  className="flex items-center justify-center w-9 h-9 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
              {varSelections.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {varSelections.map((v) => (
                    <div
                      key={v.alias}
                      className="group flex items-center gap-2 bg-blue-50 border border-blue-200 pl-3 pr-2 py-1.5 rounded-xl text-xs font-bold text-blue-700"
                    >
                      <span className="text-blue-400 font-medium">
                        {getVarName(infoMap[v.alias], v.alias)}:
                      </span>
                      {getStateName(infoMap[v.alias], v.state)}
                      {!(fixedVariable && v.alias === fixedVariable.alias) && (
                        <button
                          type="button"
                          onClick={() => removeVariable(v.alias)}
                          className="text-blue-300 group-hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Evidence */}
            <div className="space-y-3 pl-8">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Evidence
                </label>
                {evidenceSelections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEvidenceSelections([])}
                    className="text-[10px] font-bold text-blue-600 hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={newEvidenceAlias}
                  onChange={(e) => setNewEvidenceAlias(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select...</option>
                  {availableAliases
                    .filter((a) => !usedAliases.has(a))
                    .map((a) => (
                      <option key={a} value={a}>
                        {getVarName(infoMap[a], a)}
                      </option>
                    ))}
                </select>
                {newEvidenceAlias && (
                  <select
                    value={newEvidenceState}
                    onChange={(e) =>
                      setNewEvidenceState(parseInt(e.target.value))
                    }
                    className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 ring-blue-500/10 outline-none"
                  >
                    {Array.from(
                      { length: getVarNStates(newEvidenceAlias) },
                      (_, i) => (
                        <option key={i} value={i}>
                          {getStateName(infoMap[newEvidenceAlias], i)}
                        </option>
                      ),
                    )}
                  </select>
                )}
                <button
                  type="button"
                  onClick={addEvidence}
                  className="flex items-center justify-center w-9 h-9 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
              {evidenceSelections.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {evidenceSelections.map((v) => (
                    <div
                      key={v.alias}
                      className="group flex items-center gap-2 bg-amber-50 border border-amber-200 pl-3 pr-2 py-1.5 rounded-xl text-xs font-bold text-amber-700"
                    >
                      <span className="text-amber-400 font-medium">
                        {getVarName(infoMap[v.alias], v.alias)}:
                      </span>
                      {getStateName(infoMap[v.alias], v.state)}
                      <button
                        type="button"
                        onClick={() => removeEvidence(v.alias)}
                        className="text-amber-300 group-hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Query button */}
            <div className="pl-8">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 rounded-2xl text-xs transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2 group"
              >
                <Search size={14} />
                {loading ? "Querying..." : "QUERY"}
                {!loading && (
                  <ArrowUpRight
                    size={14}
                    className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                  />
                )}
              </button>
            </div>
          </div>

          {/* ── Query Results (shown between Step 1 and 2) ── */}
          {result && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Result
                </label>
                <div className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-black tracking-tighter">
                  LIVE
                </div>
              </div>

              {/* Probabilities */}
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  Probabilities
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] font-black text-slate-400 uppercase">
                      <tr>
                        {result.probabilities.length > 0 &&
                          Object.keys(result.probabilities[0]).map((key) => (
                            <th key={key} className="py-1 px-2 text-left">
                              {key === "value"
                                ? key
                                : getVarName(infoMap[key], key)}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.probabilities.map((row, i) => (
                        <tr key={i}>
                          {Object.entries(row).map(([key, val], j) => (
                            <td
                              key={j}
                              className="py-2 px-2 text-slate-900 font-bold"
                            >
                              {key === "value" && typeof val === "number"
                                ? val.toFixed(6)
                                : typeof val === "number"
                                  ? getStateName(infoMap[key], val)
                                  : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* User Expected Value */}
              {result.user_expected_value && (
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    User Expected Value
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] font-black text-slate-400 uppercase">
                        <tr>
                          {Object.keys(result.user_expected_value[0]).map(
                            (key) => (
                              <th key={key} className="py-1 px-2 text-left">
                                {key === "value"
                                  ? key
                                  : getVarName(infoMap[key], key)}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {result.user_expected_value.map((row, i) => (
                          <tr key={i}>
                            {Object.entries(row).map(([key, val], j) => (
                              <td
                                key={j}
                                className="py-2 px-2 text-slate-900 font-bold"
                              >
                                {key === "value" && typeof val === "number"
                                  ? formatEth(val)
                                  : typeof val === "number"
                                    ? getStateName(infoMap[key], val)
                                    : String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* User info metrics (edit bounds + liquidation — no cost/revenue here) */}
              {(result.user_edit_bounds || result.user_liquidation) && (
                <div className="bg-slate-50 rounded-2xl p-4 space-y-2.5 border border-slate-100">
                  {result.user_edit_bounds && (
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="text-slate-400">Edit Bounds</span>
                      <span className="text-slate-900 font-bold">
                        [{result.user_edit_bounds[0]?.toFixed(4)},{" "}
                        {result.user_edit_bounds[1]?.toFixed(4)}]
                      </span>
                    </div>
                  )}
                  {result.user_liquidation && (
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="text-slate-400">
                        Expected Free Funds
                      </span>
                      <span className="text-emerald-600 font-bold">
                        {formatEth(result.user_liquidation.expected_free_funds)}
                      </span>
                    </div>
                  )}
                  {result.user_liquidation?.report && (
                    <button
                      type="button"
                      onClick={() =>
                        applyLiquidationReport(result.user_liquidation!.report)
                      }
                      className="w-full mt-1 border border-slate-200 text-slate-600 hover:bg-white font-bold py-2 rounded-xl text-[10px] uppercase tracking-widest transition-colors"
                    >
                      Use Liquidation Report
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="h-px bg-slate-100" />

          {/* ── Step 2: Set Value ── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className={stepNumberClass}>2</div>
              <span className={stepTitleClass}>Set Report Value</span>
            </div>

            <div className="space-y-3 pl-8">
              {/* Probability */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Probability (0-1)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. 0.7"
                  className={inputClass}
                />
              </div>

              {/* Alternative representations — only when b and old_prob are known */}
              {canConvert && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                      Virtual Share
                    </label>
                    <input
                      type="number"
                      step="0.00001"
                      value={currentVS !== null ? currentVS.toFixed(6) : ""}
                      onChange={(e) => handleVSChange(e.target.value)}
                      placeholder="b·ln(p/p₀)"
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                      Cost
                    </label>
                    <input
                      type="number"
                      step="0.00001"
                      value={currentCost !== null ? currentCost.toFixed(6) : ""}
                      onChange={(e) => handleCostChange(e.target.value)}
                      placeholder="b·ln(…)"
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {oldProb !== null && (
                <div className="text-[10px] text-slate-400 font-mono">
                  Current prob: {oldProb.toFixed(6)}
                  {bEth !== null && <> · b: {bEth.toFixed(6)} ETH</>}
                </div>
              )}

              {/* Re-query with value to see cost/revenue */}
              <button
                type="submit"
                disabled={loading || !value}
                className="w-full border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                <Search size={12} />
                {loading ? "Querying..." : "Query with value"}
              </button>

              {/* Cost / Revenue result — shown after querying with a value */}
              {result && value && (result.user_cost_delta !== undefined || result.user_revenue_delta !== undefined) && (
                <div className="bg-slate-50 rounded-2xl p-4 space-y-2.5 border border-slate-100">
                  {result.user_revenue_delta !== undefined && (
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="text-slate-400">Revenue (on success)</span>
                      <span className="text-emerald-600 font-bold">{formatEth(result.user_revenue_delta)}</span>
                    </div>
                  )}
                  {result.user_cost_delta !== undefined && (
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="text-slate-400">Cost Delta</span>
                      <span className="text-slate-900 font-bold">{formatEth(result.user_cost_delta)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* ── Step 3: Submit Report ── */}
          {walletAddress && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <div className={stepNumberClass}>3</div>
                <span className={stepTitleClass}>Submit Report</span>
              </div>

              <div className="space-y-3 pl-8">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Fund Threshold (ETH)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-slate-400 font-bold">
                        Margin
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        value={marginPct}
                        onChange={(e) => setMarginPct(Number(e.target.value))}
                        className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] text-center focus:ring-2 ring-blue-500/10 outline-none"
                      />
                      <span className="text-[10px] text-slate-400 font-bold">
                        %
                      </span>
                    </div>
                  </div>
                  <input
                    type="number"
                    step="0.000001"
                    value={fundThreshold}
                    onChange={(e) => setFundThreshold(e.target.value)}
                    placeholder="e.g. (-)0.002"
                    className={inputClass}
                  />
                </div>

                <button
                  type="button"
                  disabled={editLoading || !value || varSelections.length === 0}
                  onClick={handleSubmitReport}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-4 rounded-2xl text-xs transition-all flex items-center justify-center gap-2"
                >
                  <Send size={14} />
                  {editLoading ? "Submitting..." : "SUBMIT REPORT"}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-6 text-red-500 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
