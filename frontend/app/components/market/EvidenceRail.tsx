"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  evidenceCandidates,
  type Market,
  type Selection,
} from "../../lib/market";

function EvidenceChip({
  market,
  sel,
  onRemove,
  onCycle,
}: {
  market: Market;
  sel: Selection;
  onRemove: () => void;
  onCycle: () => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full bg-accent-soft border border-accent text-accent-deep text-xs font-medium">
      <button
        onClick={onCycle}
        title="Click to cycle state"
        className="pl-3 pr-2 py-1.5 flex items-center gap-1.5 rounded-l-full"
      >
        <span className="opacity-70">{market.short}</span>
        <span className="font-semibold">= {market.states[sel.stateIdx]?.name}</span>
      </button>
      <button
        onClick={onRemove}
        title="Remove"
        className="pr-2.5 pl-1 py-1.5 text-sm opacity-50 hover:opacity-100 rounded-r-full"
      >
        ×
      </button>
    </div>
  );
}

function AddEvidencePicker({
  candidates,
  onAdd,
  onClose,
}: {
  candidates: Market[];
  onAdd: (s: Selection) => void;
  onClose: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="mt-3 p-4 bg-surface border border-dashed border-line rounded-xl text-[13px] text-ink3 text-center">
        No more variables share a clique with your current target and evidence.
        <button onClick={onClose} className="ml-3 text-accent font-medium">
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 p-4 bg-surface border border-line rounded-xl flex flex-col gap-3.5">
      <div className="flex justify-between items-center">
        <div>
          <div className="text-[13px] font-semibold text-ink">Add evidence</div>
          <div className="text-[11px] text-ink3 mt-0.5">
            Only variables in the same junction-tree clique are shown.
          </div>
        </div>
        <button onClick={onClose} className="text-ink3 hover:text-ink text-lg leading-none">
          ×
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {candidates.map((c) => (
          <div key={c.alias}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[13px] font-semibold text-ink">{c.short}</span>
              <span className="text-[10px] text-ink3 font-mono uppercase tracking-wide">
                {c.category}
              </span>
            </div>
            <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
              {c.states.map((s, sIdx) => (
                <button
                  key={sIdx}
                  onClick={() => onAdd({ alias: c.alias, stateIdx: sIdx })}
                  className="px-3 py-2 rounded-lg bg-line2 border border-transparent hover:border-accent hover:bg-accent-soft text-left text-xs font-medium text-ink transition-colors"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EvidenceRail({
  targetAlias,
  evidence,
  setEvidence,
  allMarkets,
  graphNodes,
  loading,
}: {
  targetAlias: string;
  evidence: Selection[];
  setEvidence: (e: Selection[]) => void;
  allMarkets: Market[];
  graphNodes: string[][];
  loading: boolean;
}) {
  const [picking, setPicking] = useState(false);

  // Candidates for the *next* evidence (after the current set).
  const candidates = useMemo(
    () => evidenceCandidates(targetAlias, evidence, allMarkets, graphNodes),
    [targetAlias, evidence, allMarkets, graphNodes],
  );

  // Markets we need to render existing chips (always-on resolution from
  // allMarkets, regardless of clique filter).
  const lookup = useMemo(() => {
    const map: Record<string, Market> = {};
    for (const m of allMarkets) map[m.alias] = m;
    return map;
  }, [allMarkets]);

  // Whether the target has any related variable at all (something to add now
  // or in the future). If not, the rail offers no value and is hidden.
  const targetHasRelated = useMemo(() => {
    return graphNodes.some(
      (clique) => clique.includes(targetAlias) && clique.some((a) => a !== targetAlias),
    );
  }, [graphNodes, targetAlias]);
  if (!targetHasRelated) return null;

  const isActive = evidence.length > 0;

  return (
    <div
      className={`rounded-card px-[18px] py-3.5 transition-colors ${
        isActive
          ? "bg-accent-soft border border-accent"
          : "bg-surface border border-dashed border-line"
      }`}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {isActive ? (
            <>
              <span className="text-[10px] font-bold tracking-wide uppercase text-ink bg-accent px-2 py-[3px] rounded-full">
                ● Conditional
              </span>
              <span className="text-[13px] font-medium text-accent-deep">
                Showing probability if{evidence.length > 1 ? " all of" : ""}:
              </span>
            </>
          ) : candidates.length > 0 ? (
            <>
              <button
                onClick={() => setPicking(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent-soft border border-accent text-accent-deep text-[13px] font-semibold hover:bg-accent hover:text-surface transition-colors"
              >
                <Plus size={14} /> Add evidence
              </button>
              <span className="text-[13px] text-ink2">
                See how the probability changes under different scenarios
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-ink">+ Add evidence</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {evidence.map((e) => {
            const m = lookup[e.alias];
            if (!m) return null;
            return (
              <EvidenceChip
                key={e.alias}
                market={m}
                sel={e}
                onRemove={() =>
                  setEvidence(evidence.filter((x) => x.alias !== e.alias))
                }
                onCycle={() => {
                  const next = (e.stateIdx + 1) % m.states.length;
                  setEvidence(
                    evidence.map((x) =>
                      x.alias === e.alias ? { ...x, stateIdx: next } : x,
                    ),
                  );
                }}
              />
            );
          })}
          {!picking && isActive && candidates.length > 0 && (
            <button
              onClick={() => setPicking(true)}
              className="px-3 py-1.5 rounded-full border border-dashed border-accent text-accent-deep text-xs font-medium transition-colors hover:bg-accent-soft"
            >
              + Add another
            </button>
          )}
        </div>

        {isActive && (
          <button
            onClick={() => setEvidence([])}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-ink3 hover:text-ink"
          >
            Reset to marginal
          </button>
        )}
        {loading && (
          <span className="text-[11px] text-ink3 font-mono ml-auto">
            <span className="cim-spinner" /> querying…
          </span>
        )}
      </div>

      {picking && (
        <AddEvidencePicker
          candidates={candidates}
          onAdd={(ev) => {
            setEvidence([...evidence, ev]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
