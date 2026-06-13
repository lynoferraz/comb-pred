"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Market } from "../../lib/market";
import { useApp } from "../../lib/context";
import { getInspectOptions, PRECISION_FACTOR } from "../../lib/cartesi";
import { getOutputs } from "../../backend-libs/cim/lib";
import { fmt } from "../../lib/format";
import Pill from "../ui/Pill";
import Donut from "../ui/Donut";
import Sparkline from "../ui/Sparkline";
import { ArrowRight } from "lucide-react";

// Inverted hero card for the most active market: dark gradient surface,
// probability sparkline from ProbabilityUpdated notices, state bars.
export default function FeaturedCard({ m }: { m: Market }) {
  const { config, appAddress } = useApp();
  const [trend, setTrend] = useState<number[]>([]);

  useEffect(() => {
    if (!appAddress) return;
    let cancelled = false;
    getOutputs(
      {
        tags: [m.alias],
        type: "notice",
        order_by: "input_index",
        order_dir: "asc",
        page_size: 100,
      },
      getInspectOptions(config),
    )
      .then((result) => {
        if (cancelled) return;
        const points = result.data
          .filter((d: any) => d.probabilities !== undefined)
          .map((d: any) => Number(d.probabilities[0] ?? 0) / PRECISION_FACTOR);
        setTrend(points);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appAddress, m.alias, config]);

  // Track/glow tints follow the inverted scheme (dark card in light mode,
  // light card in dark mode) by mixing from the surface color.
  const trackColor =
    "color-mix(in srgb, var(--color-surface) 18%, transparent)";

  return (
    <Link
      href={`/variable/${encodeURIComponent(m.alias)}`}
      className="no-underline text-inherit block"
    >
      <div
        className="card-lift text-surface rounded-3xl p-8 mb-7 grid md:grid-cols-[1.5fr_1fr] gap-6 items-center relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--color-ink) 0%, color-mix(in srgb, var(--color-ink) 90%, var(--color-accent)) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="relative">
          <Pill tone="accent">🔥 Most active</Pill>
          <div className="text-[28px] font-semibold tracking-tight mt-3.5 leading-tight max-w-[440px] text-balance">
            {m.name}
          </div>
          <div className="mt-3.5 text-[13px] text-ink3">
            {m.ops.toLocaleString()} reports · {m.volume.toFixed(4)} ETH volume
          </div>

          <div className="mt-5 flex flex-col gap-2 max-w-[400px]">
            {m.states.slice(0, 4).map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-ink3 w-28 truncate shrink-0">
                  {s.name}
                </span>
                <div
                  className="h-1.5 rounded-full overflow-hidden flex-1"
                  style={{ background: trackColor }}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{
                      width: `${s.prob * 100}%`,
                      background:
                        i === 0
                          ? "var(--color-accent)"
                          : "var(--color-surface)",
                      opacity: i === 0 ? 1 : 0.5,
                    }}
                  />
                </div>
                <span className="font-mono font-semibold text-surface w-14 text-right">
                  {fmt.pct(s.prob)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-surface border-b border-surface/40 pb-0.5">
            Trade <ArrowRight size={14} />
          </div>
        </div>

        <div className="relative flex flex-col items-center gap-3">
          <Donut
            p={m.states[0]?.prob ?? 0}
            size={150}
            strokeW={13}
            color="var(--color-accent)"
            trackColor={trackColor}
            textColor="var(--color-surface)"
            subTextColor="color-mix(in srgb, var(--color-surface) 60%, transparent)"
          />
          <div className="text-xs text-ink3 font-mono">
            {m.states.length === 2 ? "P(Yes)" : m.states[0]?.name}
          </div>
          {trend.length > 1 && (
            <div className="flex flex-col items-center gap-1">
              <Sparkline
                values={trend}
                w={140}
                h={32}
                color="var(--color-accent)"
                fill
              />
              <span className="text-[10px] font-mono text-ink3">
                probability trend · {trend.length} reports
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
