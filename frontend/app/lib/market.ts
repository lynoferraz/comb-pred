// Unified "Market" view-model assembled from the real backend summary
// (VariableSummary), the info_url JSON (VariableInfo), and the junction-tree
// cliques (nodes). This replaces the template's mock MARKETS array.

import {
  type VariableSummary,
  type VariableInfo,
  getRelatedVariables,
  getVarName,
  getStateName,
} from "./cartesi";

export interface MarketState {
  name: string;
  prob: number;
}

export interface Market {
  alias: string;
  name: string;
  short: string;
  category: string;
  description: string;
  states: MarketState[];
  volume: number; // ETH
  volume_ss: number; // ETH
  ops: number;
  b: number; // ETH (0 if unknown)
  related: string[];
  closes?: string;
  // Derived from ProbabilityUpdated history when available:
  change24h?: number;
  spark?: number[];
}

const WEI = 1e18;

export function buildMarket(
  v: VariableSummary,
  info: VariableInfo | null | undefined,
  nodes: string[][],
  bEth: number | undefined,
): Market {
  const states: MarketState[] = (v.states_probs || []).map((p, i) => ({
    name: getStateName(info, i),
    prob: p,
  }));
  return {
    alias: v.alias,
    name: getVarName(info, v.alias),
    short: info?.short || getVarName(info, v.alias),
    category: info?.category || "Market",
    description: info?.description || "",
    states,
    volume: (v.volume || 0) / WEI,
    volume_ss: (v.volume_ss || 0) / WEI,
    ops: v.n_operations || 0,
    b: bEth ?? 0,
    related: getRelatedVariables(v.alias, nodes),
    closes: info?.closes,
  };
}

export function buildMarkets(
  variables: VariableSummary[],
  infoMap: Record<string, VariableInfo | null>,
  nodes: string[][],
  bEth: number | undefined,
): Market[] {
  return variables.map((v) => buildMarket(v, infoMap[v.alias], nodes, bEth));
}

// Markets that share a junction-tree clique with EVERY alias in `required`,
// excluding the required aliases themselves. The generic primitive both the
// detail evidence rail and the explorer (targets + evidence) build on.
export function cliqueCandidates(
  requiredAliases: string[],
  allMarkets: Market[],
  graphNodes: string[][],
): Market[] {
  if (requiredAliases.length === 0) return allMarkets;
  const required = new Set(requiredAliases);
  return allMarkets.filter((m) => {
    if (required.has(m.alias)) return false;
    return graphNodes.some((clique) => {
      const set = new Set(clique);
      if (!set.has(m.alias)) return false;
      for (const a of required) if (!set.has(a)) return false;
      return true;
    });
  });
}

// Candidate variables that can be added as evidence next: must lie in a
// junction-tree clique that already contains the target AND every currently
// selected evidence variable.
export function evidenceCandidates(
  targetAlias: string,
  evidence: Selection[],
  allMarkets: Market[],
  graphNodes: string[][],
): Market[] {
  return cliqueCandidates(
    [targetAlias, ...evidence.map((e) => e.alias)],
    allMarkets,
    graphNodes,
  );
}

// ── Plain-English phrasing for evidence / target selections ─────────────────

export interface Selection {
  alias: string;
  stateIdx: number;
}

function phraseFor(m: Market | undefined, sel: Selection): string | null {
  if (!m) return null;
  return `${m.short || m.name} is ${m.states[sel.stateIdx]?.name ?? sel.stateIdx}`;
}

export function plainEnglishEvidence(
  evidence: Selection[],
  markets: Market[],
): string {
  if (!evidence || evidence.length === 0) return "";
  const parts = evidence
    .map((e) => phraseFor(markets.find((m) => m.alias === e.alias), e))
    .filter(Boolean) as string[];
  if (parts.length === 0) return "";
  if (parts.length === 1) return `if ${parts[0]}`;
  if (parts.length === 2) return `if ${parts[0]} and ${parts[1]}`;
  return `if ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function composePhrase(
  items: Selection[],
  markets: Market[],
  conj = "and",
): string {
  if (!items || items.length === 0) return "";
  const parts = items
    .map((it) => phraseFor(markets.find((m) => m.alias === it.alias), it))
    .filter(Boolean) as string[];
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${conj} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, ${conj} ${parts[parts.length - 1]}`;
}

// Drop variables that don't influence `value` across rows. A variable v is
// "informative" iff there exist two rows that match on every other variable
// but disagree on value. Returns the subset of `allVars` that matters.
export function informativeVars(
  rows: Array<Record<string, any>>,
  allVars: string[],
  eps = 1e-9,
): string[] {
  return allVars.filter((v) => {
    const others = allVars.filter((x) => x !== v);
    const groups: Record<string, number[]> = {};
    for (const r of rows) {
      const key = others.map((o) => r[o]).join("|");
      (groups[key] = groups[key] || []).push(Number(r.value));
    }
    return Object.values(groups).some((vals) =>
      vals.some((x) => Math.abs(x - vals[0]) > eps),
    );
  });
}

// Collapse rows down to a smaller variable set: dedupe by the kept-vars
// tuple. Assumes value is constant across collapsed dimensions (the input
// has already been pruned via informativeVars).
export function collapseRows(
  rows: Array<Record<string, any>>,
  keptVars: string[],
): Array<{ assignment: Record<string, number>; value: number }> {
  const seen = new Map<string, { assignment: Record<string, number>; value: number }>();
  for (const r of rows) {
    const assignment: Record<string, number> = {};
    for (const v of keptVars) assignment[v] = Number(r[v]);
    const key = keptVars.map((v) => assignment[v]).join("|");
    if (!seen.has(key))
      seen.set(key, { assignment, value: Number(r.value) });
  }
  return Array.from(seen.values()).sort((a, b) => b.value - a.value);
}

// ── History-derived stats (used on the Detail page where we fetch history) ──

export interface ProbPoint {
  probabilities: number[];
  volume: number;
  volume_ss: number;
  timestamp: number;
}

// Sparkline of a single state's probability over the recent history.
export function deriveSpark(history: ProbPoint[], stateIdx: number): number[] {
  return history.map((h) => h.probabilities[stateIdx] ?? 0);
}

// 24h change in a state's probability (latest vs. first point within 24h).
export function deriveChange24h(
  history: ProbPoint[],
  stateIdx: number,
  nowSec = Date.now() / 1000,
): number | undefined {
  if (history.length < 2) return undefined;
  const latest = history[history.length - 1];
  const cutoff = nowSec - 24 * 3600;
  let base = history[0];
  for (const h of history) {
    if (h.timestamp <= cutoff) base = h;
    else break;
  }
  const a = base.probabilities[stateIdx];
  const b = latest.probabilities[stateIdx];
  if (a == null || b == null) return undefined;
  return b - a;
}
