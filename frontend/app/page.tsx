"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "./lib/context";
import { buildMarkets } from "./lib/market";
import { fmt } from "./lib/format";
import MarketCard from "./components/market/MarketCard";
import Pill from "./components/ui/Pill";
import Donut from "./components/ui/Donut";
import { Search, RefreshCw } from "lucide-react";

export default function Home() {
  const {
    variables,
    graphNodes,
    ammB,
    infoMap,
    loading,
    error,
    fetchSummary,
    appAddress,
  } = useApp();

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("Volume");

  const markets = useMemo(
    () => buildMarkets(variables, infoMap, graphNodes, ammB),
    [variables, infoMap, graphNodes, ammB],
  );

  const cats = useMemo(() => {
    const set = new Set<string>();
    markets.forEach((m) => set.add(m.category));
    return ["All", ...Array.from(set).sort()];
  }, [markets]);

  const filtered = useMemo(() => {
    let list = markets.filter((m) => {
      if (cat !== "All" && m.category !== cat) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.alias.toLowerCase().includes(q) &&
          !m.category.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    if (sort === "Volume") list = [...list].sort((a, b) => b.volume - a.volume);
    if (sort === "Active") list = [...list].sort((a, b) => b.ops - a.ops);
    if (sort === "Name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [markets, cat, search, sort]);

  const featured = useMemo(
    () => [...markets].sort((a, b) => b.volume - a.volume)[0],
    [markets],
  );
  const showFeatured = !search && cat === "All" && featured;

  return (
    <div className="px-7 pt-10 pb-14 max-w-[1500px] mx-auto animate-in">
      {/* Hero */}
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight leading-none text-ink">
            Markets
          </h1>
          <p className="mt-2.5 text-base text-ink2 max-w-[560px]">
            Predict the future. Get paid for being right.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full border border-line bg-surface text-[13px] text-ink3 w-56">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="bg-transparent border-0 outline-none flex-1 text-[13px] text-ink"
            />
          </div>
          <button
            onClick={fetchSummary}
            disabled={loading || !appAddress}
            title="Refresh"
            className="p-2.5 rounded-full border border-line text-ink2 hover:bg-line2 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                cat === c
                  ? "bg-ink text-surface"
                  : "bg-transparent text-ink2 border border-line hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5 text-[13px] text-ink3">
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium outline-none cursor-pointer"
          >
            {["Volume", "Active", "Name"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="text-no text-xs font-medium bg-no-soft border border-no/30 rounded-xl px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {/* Featured */}
      {showFeatured && (
        <Link
          href={`/variable/${encodeURIComponent(featured.alias)}`}
          className="no-underline text-inherit"
        >
          <div className="bg-ink text-surface rounded-3xl p-8 mb-7 grid md:grid-cols-[1.5fr_1fr] gap-6 items-center">
            <div>
              <Pill tone="accent">🔥 Most active</Pill>
              <div className="text-[28px] font-semibold tracking-tight mt-3.5 leading-tight max-w-[440px]">
                {featured.name}
              </div>
              <div className="mt-3.5 text-[13px] text-ink3">
                {featured.ops.toLocaleString()} reports ·{" "}
                {featured.volume.toFixed(2)} ETH volume
              </div>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {featured.states.slice(0, 4).map((s, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="text-ink3">{s.name}</span>
                    <span className="font-mono font-semibold text-surface">
                      {fmt.pct(s.prob)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Donut
                p={featured.states[0]?.prob ?? 0}
                size={160}
                strokeW={14}
                color="var(--color-accent)"
                trackColor="rgba(255,255,255,0.15)"
                textColor="var(--color-surface)"
                subTextColor="rgba(255,255,255,0.6)"
              />
              <div className="text-xs text-ink3 font-mono">
                {featured.states.length === 2
                  ? "P(Yes)"
                  : featured.states[0]?.name}
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="p-16 text-center text-ink3 bg-surface rounded-card border border-line">
          <div className="text-sm font-medium text-ink2">
            {markets.length === 0
              ? "No markets loaded"
              : `No markets match "${search}"`}
          </div>
          <div className="mt-1.5 text-[13px]">
            {markets.length === 0
              ? "Connect to a running Cartesi node to view the market."
              : "Try a different search term or category."}
          </div>
        </div>
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
          {filtered.map((m) => (
            <MarketCard key={m.alias} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
