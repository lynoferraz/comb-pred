// Tier-1 market data: the latest ProbabilityUpdated notice per variable,
// served by the node's indexer (a DB read — no machine execution). Every
// mutation that moves probabilities (initialize, trade, resolve, add)
// emits one of these per affected alias, so the newest event per alias is
// the current AMM state. The expensive cim_variable inspect stays reserved
// for on-demand, authoritative reads.

import { getOutputs } from "../backend-libs/cim/lib";
import {
  getInspectOptions,
  PRECISION_FACTOR,
  type AppConfig,
  type VariableSummary,
} from "./cartesi";

const CONCURRENCY = 8;

async function fetchLatestUpdate(
  alias: string,
  config: AppConfig,
): Promise<VariableSummary | null> {
  const result = await getOutputs(
    {
      tags: ["probability_updates", alias],
      type: "notice",
      order_by: "input_index",
      order_dir: "desc",
      page_size: 1,
    },
    getInspectOptions(config),
  );
  const ev = result.data[0] as
    | { probabilities?: number[]; volume?: number; volume_ss?: number }
    | undefined;
  if (!ev?.probabilities) return null;
  return {
    alias,
    states_probs: ev.probabilities.map((p) => Number(p) / PRECISION_FACTOR),
    volume: Number(ev.volume ?? 0),
    volume_ss: Number(ev.volume_ss ?? 0),
    // The event doesn't carry n_operations; the count of indexed
    // probability updates is the activity measure the UI sorts on.
    n_operations: result.total,
    source: "event",
  };
}

// Fetches the latest update for each alias with bounded concurrency,
// reporting each completed batch through `onData` so the grid can render
// progressively. Aliases with no indexed event yet (e.g. emission failed)
// are silently skipped; per-alias fetch errors don't abort the rest.
export async function fetchMarketSnapshot(
  aliases: string[],
  config: AppConfig,
  onData: (batch: VariableSummary[]) => void,
): Promise<void> {
  for (let i = 0; i < aliases.length; i += CONCURRENCY) {
    const slice = aliases.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((alias) => fetchLatestUpdate(alias, config).catch(() => null)),
    );
    const batch = results.filter((v): v is VariableSummary => v !== null);
    if (batch.length > 0) onData(batch);
  }
}
