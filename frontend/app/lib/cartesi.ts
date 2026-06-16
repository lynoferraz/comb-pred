import { type Hex } from "viem";
import { hexToString, bytesToString, isHex } from "viem";
import type { InspectOptions } from "../backend-libs/cartesapp/inspect";

export const PRECISION = 6;
export const PRECISION_FACTOR = 10 ** PRECISION;

export interface AppConfig {
  appAddress: Hex;
  nodeAddress: string;
  chainId?: number;
}

export function getInspectOptions(config: AppConfig): InspectOptions {
  return {
    applicationAddress: config.appAddress,
    cartesiNodeUrl: config.nodeAddress,
  };
}

export function decodeJsonReport(data: Hex | Uint8Array): any {
  const str = isHex(data)
    ? hexToString(data)
    : bytesToString(data as Uint8Array);
  return JSON.parse(str);
}

export interface VariableSummary {
  alias: string;
  // Probabilities are loaded lazily (per visible card / on demand), so an
  // entry may exist with only the lightweight fields from `list_variables`
  // and no probabilities yet.
  states_probs?: number[];
  n_states?: number;
  volume: number;
  volume_ss: number;
  n_operations: number;
  // Where the numbers came from: the cheap paged `list_variables` listing
  // ("list"), the latest indexed ProbabilityUpdated notice ("event"), or an
  // authoritative cim_variable inspect ("query").
  source?: "list" | "event" | "query";
}

export interface LiquidationReport {
  variables: Record<string, number>;
  evidence: Record<string, number>;
  value: number;
}

export interface QueryResult {
  probabilities: Array<Record<string, any>>;
  user_expected_value?: Array<Record<string, any>>;
  user_edit_bounds?: [number, number];
  user_liquidation?: {
    report: LiquidationReport;
    expected_free_funds: number;
  };
  user_cost_delta?: number;
  user_revenue_delta?: number;
}

// Variable info from /api/info/<alias>
export interface VariableInfo {
  alias: string;
  name?: string;
  description?: string;
  states?: string[];
  category?: string;
  tags?: string[];
  [key: string]: any;
}

// Decode a variable alias from however it comes back in a decoded input
// payload: a 0x-padded bytes32 hex (ABI `Bytes32`) or an already-plain string.
// Trailing NUL padding is stripped and the result lower-cased (aliases are
// stored lower-case on the backend).
export function bytes32ToAlias(v: unknown): string {
  if (typeof v !== "string") return "";
  let s = v;
  if (isHex(v) && v.length > 2) {
    try {
      s = hexToString(v as Hex, { size: 32 });
    } catch {
      return "";
    }
  }
  return s.replace(/\0+$/, "").trim().toLowerCase();
}

// Get display name for a variable (falls back to alias)
export function getVarName(
  info: VariableInfo | null | undefined,
  alias: string,
): string {
  return info?.name || alias;
}

// Get display name for a state (falls back to "State N")
export function getStateName(
  info: VariableInfo | null | undefined,
  stateIndex: number,
): string {
  return info?.states?.[stateIndex] ?? `State ${stateIndex}`;
}

// Find graph clique nodes that contain a given variable alias
export function getRelatedVariables(
  alias: string,
  nodes: string[][],
): string[] {
  const related = new Set<string>();
  for (const clique of nodes) {
    if (clique.includes(alias)) {
      for (const v of clique) {
        if (!v.startsWith("_")) related.add(v);
      }
    }
  }
  related.delete(alias);
  return Array.from(related);
}
