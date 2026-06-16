"use client";

import { useState, useEffect, useRef } from "react";
import { useApp } from "./context";
import {
  type AppConfig,
  type QueryResult,
  getInspectOptions,
  PRECISION_FACTOR,
} from "./cartesi";
import { queryAmm } from "../backend-libs/cim/lib";
import type { Market } from "./market";

export interface Selection {
  alias: string;
  stateIdx: number;
}

interface AmmQueryArgs {
  varAliases: string[];
  varStates: number[];
  evidenceAliases?: string[];
  evidenceStates?: number[];
  value?: number; // probability 0..1; scaled to PRECISION_FACTOR
  userAddress?: string;
}

// Low-level wrapper around the queryAmm inspect endpoint.
export async function ammQuery(
  config: AppConfig,
  args: AmmQueryArgs,
): Promise<QueryResult> {
  const payload: any = {
    var_aliases: args.varAliases,
    var_states: args.varStates,
  };
  if (args.evidenceAliases && args.evidenceAliases.length > 0) {
    payload.evidence_aliases = args.evidenceAliases;
    payload.evidence_states = args.evidenceStates;
  }
  if (args.value !== undefined) {
    payload.value = Math.round(args.value * PRECISION_FACTOR);
  }
  if (args.userAddress) payload.user_address = args.userAddress;

  const report = await queryAmm(payload, {
    ...getInspectOptions(config),
    decode: true,
    decodeModel: "json",
  });
  return report as QueryResult;
}

export interface JointCell {
  indices: number[];
  prob: number;
}

// Parse queryAmm `probabilities` rows (one per joint cell) into cells aligned
// to `aliases` order, plus per-variable marginal distributions.
export function parseJoint(
  rows: Array<Record<string, any>>,
  aliases: string[],
): { cells: JointCell[]; marginals: number[][] } {
  const cells: JointCell[] = rows.map((row) => ({
    indices: aliases.map((a) => Number(row[a])),
    prob: Number(row.value),
  }));
  const marginals = aliases.map((_, ti) => {
    const m: Record<number, number> = {};
    let maxIdx = 0;
    for (const c of cells) {
      const s = c.indices[ti];
      m[s] = (m[s] || 0) + c.prob;
      if (s > maxIdx) maxIdx = s;
    }
    const arr: number[] = [];
    for (let i = 0; i <= maxIdx; i++) arr.push(m[i] || 0);
    return arr;
  });
  return { cells, marginals };
}

// Conditional probability distribution for a single market given evidence.
// Returns the marginal (market.states) immediately when evidence is empty.
export function useConditional(
  market: Market,
  evidence: Selection[],
): { probs: number[]; loading: boolean } {
  const { config, appAddress } = useApp();
  const [probs, setProbs] = useState<number[]>(() =>
    market.states.map((s) => s.prob),
  );
  const [loading, setLoading] = useState(false);
  const evKey = JSON.stringify(evidence);
  // Re-run when the target's marginal probabilities change too — they arrive
  // asynchronously (ensureVariables), so the no-evidence branch must refresh
  // once they load instead of holding the initial all-zero placeholder.
  const baseKey = JSON.stringify(market.states.map((s) => s.prob));

  useEffect(() => {
    if (!evidence || evidence.length === 0) {
      setProbs(market.states.map((s) => s.prob));
      setLoading(false);
      return;
    }
    if (!appAddress) return;
    setLoading(true);
    let cancelled = false;
    ammQuery(config, {
      varAliases: [market.alias],
      varStates: [0],
      evidenceAliases: evidence.map((e) => e.alias),
      evidenceStates: evidence.map((e) => e.stateIdx),
    })
      .then((res) => {
        if (cancelled) return;
        const rows = res.probabilities || [];
        const arr = market.states.map((_, i) => {
          const row = rows.find((r) => Number(r[market.alias]) === i);
          return row ? Number(row.value) : 0;
        });
        setProbs(arr);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.alias, evKey, appAddress, baseKey]);

  return { probs, loading };
}

export interface JointState {
  cells: JointCell[];
  marginals: number[][];
  cellProb: number;
  loading: boolean;
}

// Joint probability over multiple targets given evidence (Explorer screen).
export function useJoint(
  targets: Selection[],
  evidence: Selection[],
): JointState {
  const { config, appAddress } = useApp();
  const [state, setState] = useState<JointState>({
    cells: [],
    marginals: [],
    cellProb: 0,
    loading: false,
  });
  const tKey = JSON.stringify(targets);
  const evKey = JSON.stringify(evidence);

  useEffect(() => {
    if (!targets || targets.length === 0) {
      setState({ cells: [], marginals: [], cellProb: 0, loading: false });
      return;
    }
    if (!appAddress) return;
    setState((s) => ({ ...s, loading: true }));
    let cancelled = false;
    ammQuery(config, {
      varAliases: targets.map((t) => t.alias),
      varStates: targets.map((t) => t.stateIdx),
      evidenceAliases: evidence.map((e) => e.alias),
      evidenceStates: evidence.map((e) => e.stateIdx),
    })
      .then((res) => {
        if (cancelled) return;
        const { cells, marginals } = parseJoint(
          res.probabilities || [],
          targets.map((t) => t.alias),
        );
        const sel = cells.find((c) =>
          c.indices.every((idx, i) => idx === targets[i].stateIdx),
        );
        setState({
          cells,
          marginals,
          cellProb: sel ? sel.prob : 0,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey, evKey, appAddress]);

  return state;
}

// Debounce a fast-changing value (e.g. a typed report value) so dependent
// backend queries only fire after the user pauses for `delay` ms.
export function useDebounced<T>(value: T, delay = 1500): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// Tween a number between updates (easeOutCubic). Ported from the template.
export function useAnimatedNumber(value: number, duration = 450): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (Math.abs(from - to) < 1e-6) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * eased;
      fromRef.current = v;
      setDisplay(v);
      if (p >= 1) {
        clearInterval(id);
        fromRef.current = to;
        setDisplay(to);
      }
    }, 16);
    return () => clearInterval(id);
  }, [value, duration]);
  return display;
}
