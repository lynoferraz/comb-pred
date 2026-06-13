"use client";

import Link from "next/link";
import type { Market } from "../../lib/market";
import { fmt, STATE_COLORS } from "../../lib/format";
import Pill from "../ui/Pill";
import Donut from "../ui/Donut";

export default function MarketCard({ m }: { m: Market }) {
  const isBinary = m.states.length === 2;
  const yes = m.states[0]?.prob ?? 0;

  return (
    <Link
      href={`/variable/${encodeURIComponent(m.alias)}`}
      className="no-underline text-inherit"
    >
      <div className="cim-card bg-surface rounded-card p-[22px] border border-line flex flex-col gap-4 h-full transition-all hover:border-ink4 hover:-translate-y-px hover:shadow-lg">
        <div className="flex justify-between items-start gap-3.5">
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex gap-1.5 flex-wrap">
              <Pill>{m.category}</Pill>
              {m.related.length > 0 && (
                <Pill tone="soft">⇄ {m.related.length} related</Pill>
              )}
            </div>
            <div className="font-semibold text-[16px] leading-tight tracking-tight text-ink text-pretty">
              {m.name}
            </div>
          </div>
          {isBinary ? (
            <Donut p={yes} size={64} />
          ) : (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[28px] font-semibold font-mono leading-none text-ink">
                {m.states.length}
              </span>
              <span className="text-[10px] font-mono text-ink3">states</span>
            </div>
          )}
        </div>

        {isBinary ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="px-3.5 py-[11px] bg-accent-soft text-accent-deep rounded-xl flex justify-between items-center">
              <span className="text-[13px]">{m.states[0]?.name ?? "Yes"}</span>
              <span className="font-mono font-semibold text-sm">
                {fmt.pct(m.states[0].prob)}
              </span>
            </div>
            <div className="px-3.5 py-[11px] bg-line2 text-ink2 rounded-xl flex justify-between items-center">
              <span className="text-[13px]">{m.states[1]?.name ?? "No"}</span>
              <span className="font-mono font-semibold text-sm">
                {fmt.pct(m.states[1].prob)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {m.states.map((s, i) => (
              <div
                key={i}
                className="grid items-center gap-3"
                style={{ gridTemplateColumns: "110px 1fr 40px" }}
              >
                <span className="text-xs text-ink2 font-medium truncate">
                  {s.name}
                </span>
                <div className="h-1.5 bg-line2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{
                      width: `${s.prob * 100}%`,
                      background: STATE_COLORS[i % STATE_COLORS.length],
                    }}
                  />
                </div>
                <span className="font-mono text-xs text-ink font-semibold text-right">
                  {fmt.pct(s.prob)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center text-xs text-ink3">
          <span>
            <span className="text-ink2">{m.volume.toFixed(4)} ETH</span> vol ·{" "}
            {m.ops.toLocaleString()} reports
          </span>
          {m.closes && <span>Closes {m.closes}</span>}
        </div>
      </div>
    </Link>
  );
}
