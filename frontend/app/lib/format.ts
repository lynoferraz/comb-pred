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
export function simReport(
  b: number,
  pOld: number,
  pNew: number,
  otherProbs: number[],
): SimResult {
  if (!(b > 0) || otherProbs.length === 0) {
    return { winDelta: 0, costDelta: 0, shares: 0, revenueDelta: 0 };
  }
  const po = clamp(pOld);
  const pn = clamp(pNew);
  const oneMinusPo = 1 - po;

  const winDelta = b * Math.log(pn / po);

  // Binary: the single "other" has prob 1-po, so the factor p_other/(1-po) = 1.
  // Multi-state: take the min (worst case for the user).
  const baseTerm = Math.log((1 - pn) / oneMinusPo);
  let costDelta: number;
  if (otherProbs.length === 1) {
    costDelta = b * baseTerm;
  } else {
    let minCost = Infinity;
    for (const pother of otherProbs) {
      const p = clamp(pother);
      const c = b * (baseTerm + Math.log(p / oneMinusPo));
      if (c < minCost) minCost = c;
    }
    costDelta = minCost === Infinity ? 0 : minCost;
  }
  return {
    winDelta,
    costDelta,
    shares: winDelta,
    revenueDelta: winDelta - costDelta,
  };
}

// Inverse for the beginner tab: how high does p_new need to go so that the
// user "spends" `amount` ETH (i.e. so that |cost_delta| ≈ amount)? We treat
// amount as |cost_delta| under the same min-over-others rule, so for
// multi-state markets there is a fixed offset C from the worst-case state.
export function pFromSpend(
  b: number,
  pOld: number,
  amount: number,
  otherProbs: number[],
): number {
  if (!(b > 0) || amount <= 0 || otherProbs.length === 0) return pOld;
  const po = clamp(pOld);
  const oneMinusPo = 1 - po;

  // Solve   amount = -[ b · ln((1-pn)/(1-po) · pmin/(1-po)) ]
  //              = b · ln((1-po)/(1-pn)) + b · ln((1-po)/pmin)
  //   ⇒ pn = 1 - (1-po) · exp(-(amount - C) / b)
  // where C = b · ln((1-po) / pmin)   (= 0 for binary).
  let pmin = oneMinusPo; // binary default
  if (otherProbs.length > 1) {
    pmin = Infinity;
    for (const p of otherProbs) if (p > 0 && p < pmin) pmin = p;
    if (!isFinite(pmin)) pmin = oneMinusPo;
  }
  const C = b * Math.log(oneMinusPo / pmin);
  const exponent = (amount - C) / b;
  if (exponent <= 0) return po; // nothing left after worst-case offset
  return clamp(1 - oneMinusPo * Math.exp(-exponent));
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
