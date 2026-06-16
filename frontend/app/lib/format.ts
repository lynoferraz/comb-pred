// Formatters + AMM simulation math. ETH amounts in the UI are plain numbers
// (already converted out of wei by the data layer). Per backend spec:
//   win_delta     = b · ln(p_new / p_old)
//   cost_delta    = min over other states s of
//                     b · ln( (1-p_new)/(1-p_old) · p_other_s/(1-p_old) )
//   shares        = win_delta
//   revenue_delta = win_delta − cost_delta
// (For binary, the "other" factor collapses to 1 and cost_delta reduces to
//  b · ln((1-p_new)/(1-p_old)) as in standard LMSR.)
// The frontend uses these for live previews; an inspect query against the AMM
// is the authoritative source once a wallet is connected.

// Note on units: AMM share prices in this market are denominated in ETH, not
// dollars. The "67¢" Polymarket shorthand assumes 1 share = $1; here a share's
// expected payout in ETH depends on the liquidity parameter b (e.g. 0.00072
// ETH), so the cents symbol is NOT a valid price proxy for the probability.
// Probabilities are formatted as percentages; ETH amounts use `eth` / `signed`.
export const fmt = {
  eth: (v: number, d = 4) => (Number(v) || 0).toFixed(d),
  pct: (p: number, d = 0) => `${(p * 100).toFixed(d)}%`,
  signed: (v: number, d = 4, suffix = "") =>
    (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + suffix,
  signedPct: (delta: number, d = 1) =>
    (delta >= 0 ? "+" : "−") + Math.abs(delta * 100).toFixed(d) + "pp",
  addr: (a: string) =>
    a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a,
};

const EPS = 1e-9;
const clamp = (x: number, lo = EPS, hi = 1 - EPS) =>
  Math.max(lo, Math.min(hi, x));

export interface SimResult {
  winDelta: number; // shares gained if the chosen state wins
  costDelta: number; // signed; negative when the user pays
  shares: number; // == winDelta
  revenueDelta: number; // winDelta − costDelta (net if chosen state wins)
}

// Live simulation. pOld is the chosen state's current probability.
// otherProbs is the list of probabilities for every OTHER state (length 1 for
// binary). Pass [] for a degenerate one-state market (returns zeros).
//
// Model (matches the AMM): a report shifts each state's value V = b·ln(q) by
// ±a — the N−1 non-target states each drop by `a`, the target rises by
// (N−1)·a. After renormalising, the target probability satisfies
//   logit(p_new) = logit(p_old) + N·a/b,
// so the cost a = (b/N)·(logit(p_new) − logit(p_old)). The funds gained if the
// target wins is the target's value increase, (N−1)·a.
export function simReport(
  b: number,
  pOld: number,
  pNew: number,
  otherProbs: number[],
): SimResult {
  const nStates = otherProbs.length + 1;
  if (!(b > 0) || nStates < 2) {
    return { winDelta: 0, costDelta: 0, shares: 0, revenueDelta: 0 };
  }
  const po = clamp(pOld);
  const pn = clamp(pNew);

  const logit = (p: number) => Math.log(p / (1 - p));
  // Funds the user pays now (positive when pushing the target up).
  const a = (b / nStates) * (logit(pn) - logit(po));
  const winDelta = (nStates - 1) * a; // target's funds increase if it wins
  return {
    winDelta,
    costDelta: -a, // signed: negative when the user pays
    shares: winDelta,
    revenueDelta: winDelta - a,
  };
}

export function pFromSpend(
  b: number,
  pOld: number,
  amount: number,
  otherProbs: number[],
): number {
  const nOtherStates = otherProbs.length;
  if (!(b > 0) || amount <= 0) return pOld;
  const po = clamp(pOld);
  const e = Math.exp(-amount / b);
  let notTargetP = 0;
  for (let i = 0; i < otherProbs.length; i += 1) {
    notTargetP += clamp(otherProbs[i] * e);
  }
  // const e = Math.exp(-amount / b);
  // const notTargetP = (1 + e) * (1 - po);
  return clamp(1 - notTargetP);
}

// Per-state palette for charts/bars (CSS variables resolved by the browser).
export const STATE_COLORS = [
  "var(--color-accent)",
  "var(--color-ink)",
  "#737373",
  "var(--color-ink4)",
  "#0891b2",
  "#7c3aed",
  "#d97706",
  "#db2777",
];
