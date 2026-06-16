"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./lib/context";
import { buildMarketsFromAliases } from "./lib/market";
import MarketCard from "./components/market/MarketCard";
import FeaturedCard from "./components/market/FeaturedCard";
import { MarketGridSkeleton } from "./components/ui/Skeleton";
import { Search } from "lucide-react";

const PAGE_SIZE = 24;
// One listing fetch covers this many variables; we page through if there are
// more. The listing is a cheap entity read (no belief propagation), so a wide
// page keeps it to a single round trip in practice.
const LIST_PAGE = 200;

export default function Home() {
  const {
    aliases,
    marketData,
    graphNodes,
    ammB,
    infoMap,
    loading,
    error,
    appAddress,
    ensureProbabilities,
    listVariables,
  } = useApp();

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("Volume");

  // Load the cheap lightweight listing (volume/activity/n_states for every
  // variable, no probabilities) so sorting/filtering is globally correct.
  // Probabilities themselves stay lazy, loaded only for the visible cards.
  const [listLoading, setListLoading] = useState(false);
  const listRequested = useRef(false);
  useEffect(() => {
    if (!appAddress || listRequested.current) return;
    listRequested.current = true;
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        let page = 1;
        for (;;) {
          const res = await listVariables({
            orderBy: "volume",
            orderDir: "desc",
            page,
            pageSize: LIST_PAGE,
          });
          if (cancelled) return;
          if (res.aliases.length < LIST_PAGE || page * LIST_PAGE >= res.total)
            break;
          page++;
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appAddress, listVariables]);

  // Full universe, enriched with the listing's volume/activity.
  const markets = useMemo(
    () => buildMarketsFromAliases(aliases, marketData, infoMap, graphNodes, ammB),
    [aliases, marketData, infoMap, graphNodes, ammB],
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
          !m.category.toLowerCase().includes(q) &&
          !m.tags.some((t) => t.toLowerCase().includes(q)) &&
          !m.states.some((s) => s.name.toLowerCase().includes(q))
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

  // Page in memory; only the cards that are actually rendered get their
  // probabilities loaded.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => setVisibleCount(PAGE_SIZE), [search, cat, sort]);

  const visible = filtered.slice(0, visibleCount);
  useEffect(() => {
    ensureProbabilities(visible.map((m) => m.alias));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, visibleCount, ensureProbabilities]);

  const featured = useMemo(
    () => [...markets].sort((a, b) => b.volume - a.volume)[0],
    [markets],
  );
  const showFeatured = !search && cat === "All" && featured;
  // Featured needs its probabilities too.
  useEffect(() => {
    if (showFeatured) ensureProbabilities([featured.alias]);
  }, [showFeatured, featured, ensureProbabilities]);

  const initialLoading = (loading || listLoading) && markets.length === 0;

  return (
    <div className="px-4 md:px-7 pt-10 pb-14 max-w-[1500px] mx-auto animate-in">
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
      {showFeatured && <FeaturedCard m={featured} />}

      {/* Grid */}
      {initialLoading ? (
        <MarketGridSkeleton />
      ) : filtered.length === 0 ? (
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
        <>
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))] stagger-children">
            {visible.map((m) => (
              <MarketCard key={m.alias} m={m} />
            ))}
          </div>
          {filtered.length > visibleCount && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="px-5 py-2.5 rounded-full border border-line bg-surface text-[13px] font-medium text-ink2 hover:text-ink hover:bg-line2 transition-colors"
              >
                Show more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
