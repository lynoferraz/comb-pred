// Cross-page handoff for "open in Explorer": a serialized target/evidence/
// value triple stashed in sessionStorage. Explorer reads + clears it on
// mount and applies it as its initial selection.

import type { Selection } from "./market";

const KEY = "cim-explorer-prefill";

export interface ExplorerPrefill {
  targets?: Selection[];
  evidence?: Selection[];
  value?: number;
}

export function setExplorerPrefill(payload: ExplorerPrefill) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {}
}

export function takeExplorerPrefill(): ExplorerPrefill | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return data as ExplorerPrefill;
  } catch {
    return null;
  }
}

// Convert a backend user_liquidation.report into ExplorerPrefill shape.
// `report` is { variables: {alias: stateIdx}, evidence: {alias: stateIdx}, value? }.
export function liquidationToPrefill(report: any): ExplorerPrefill {
  const targets: Selection[] = Object.entries(report?.variables ?? {}).map(
    ([alias, state]) => ({ alias, stateIdx: Number(state) }),
  );
  const evidence: Selection[] = Object.entries(report?.evidence ?? {}).map(
    ([alias, state]) => ({ alias, stateIdx: Number(state) }),
  );
  const out: ExplorerPrefill = { targets, evidence };
  if (typeof report?.value === "number") out.value = report.value;
  return out;
}
