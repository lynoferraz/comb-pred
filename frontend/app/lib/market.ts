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
  // 0 until the variable's probabilities have been loaded; gate display on
  // `Market.probsLoaded` rather than treating 0 as a real probability.
  prob: number;
}

export interface Market {
  alias: string;
  name: string;
  short: string;
  category: string;
  description: string;
  tags: string[];
  states: MarketState[];
  // True once real probabilities are loaded; false for a placeholder built
  // from variable info alone (state names known, probabilities not yet).
  probsLoaded: boolean;
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

// Assemble a Market from whatever is currently known about an alias: the
// info JSON (state names, category, …) is enough to render a placeholder
// card; the optional summary adds probabilities/volume once loaded.
export function buildMarket(
  alias: string,
  summary: VariableSummary | null | undefined,
  info: VariableInfo | null | undefined,
  nodes: string[][],
  bEth: number | undefined,
): Market {
  const probs = summary?.states_probs;
  const probsLoaded = Array.isArray(probs) && probs.length > 0;
  let states: MarketState[];
  if (probsLoaded) {
    states = probs!.map((p, i) => ({ name: getStateName(info, i), prob: p }));
  } else {
    // Placeholder states from info (or n_states) with no probabilities yet.
    const count = info?.states?.length ?? summary?.n_states ?? 0;
    states = Array.from({ length: count }, (_, i) => ({
      name: getStateName(info, i),
      prob: 0,
    }));
  }
  return {
    alias,
    name: getVarName(info, alias),
    short: info?.short || getVarName(info, alias),
    category: info?.category || "Market",
    description: info?.description || "",
    tags: info?.tags ?? [],
    states,
    probsLoaded,
    volume: (summary?.volume || 0) / WEI,
    volume_ss: (summary?.volume_ss || 0) / WEI,
    ops: summary?.n_operations || 0,
    b: bEth ?? 0,
    related: getRelatedVariables(alias, nodes),
    closes: info?.closes,
  };
}

// Build one Market per alias, pulling each alias's (possibly absent) summary
// from the shared market-data map. Used by every screen that needs the full
// variable universe (names/states/cliques) without forcing a probability load.
export function buildMarketsFromAliases(
  aliases: string[],
  marketData: Record<string, VariableSummary>,
  infoMap: Record<string, VariableInfo | null>,
  nodes: string[][],
  bEth: number | undefined,
): Market[] {
  return aliases.map((a) =>
    buildMarket(a, marketData[a], infoMap[a], nodes, bEth),
  );
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
