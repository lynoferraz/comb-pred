"use client";

import { useState, useEffect } from "react";
import type { VariableInfo } from "./cartesi";

// Variable metadata comes from the local /api/info/<alias> route (bundled
// market models with a registry fallback), addressable by alias alone — no
// on-chain info_url needed.
function infoUrlFor(alias: string): string {
  return `/api/info/${alias}`;
}

// In-memory cache shared across hook instances within the same page lifecycle
const infoCache: Record<string, VariableInfo | null> = {};

// The bundled manifest (all variable info in one request) is fetched at most
// once per page load; concurrent callers share the same in-flight promise.
let manifestPromise: Promise<void> | null = null;

function loadManifest(): Promise<void> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch("/api/info")
    .then((r) => (r.ok ? r.json() : { data: [] }))
    .then((json) => {
      const list: VariableInfo[] = Array.isArray(json?.data) ? json.data : [];
      for (const info of list) {
        if (info?.alias && !(info.alias in infoCache)) infoCache[info.alias] = info;
      }
    })
    .catch(() => {
      // Allow a later retry if the manifest request failed outright.
      manifestPromise = null;
    });
  return manifestPromise;
}

// Variable info for the whole known universe: load the bundled manifest once,
// then fill any aliases it didn't cover (runtime-added variables) from the
// per-alias registry route. Returns a map keyed by alias.
export function useAllVariableInfo(
  aliases: string[],
): Record<string, VariableInfo | null> {
  const [infoMap, setInfoMap] = useState<Record<string, VariableInfo | null>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadManifest();
      // Aliases present on-chain but missing from the bundle resolve through
      // the per-alias route (which carries the registry fallback).
      const missing = aliases.filter((a) => !(a in infoCache));
      await Promise.all(
        missing.map(async (alias) => {
          try {
            const res = await fetch(infoUrlFor(alias));
            if (!res.ok) throw new Error("not ok");
            infoCache[alias] = (await res.json()) as VariableInfo;
          } catch {
            infoCache[alias] = null;
          }
        }),
      );
      if (!cancelled) setInfoMap({ ...infoCache });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [aliases]);

  return infoMap;
}

export function useVariableInfoMap(
  aliases: string[],
): Record<string, VariableInfo | null> {
  const [infoMap, setInfoMap] = useState<Record<string, VariableInfo | null>>(
    {},
  );

  useEffect(() => {
    if (aliases.length === 0) return;
    let cancelled = false;

    const fetchAll = async () => {
      const updates: Record<string, VariableInfo | null> = {};
      const toFetch = aliases.filter((alias) => !(alias in infoCache));

      // Return cached immediately
      for (const alias of aliases) {
        if (alias in infoCache) {
          updates[alias] = infoCache[alias];
        }
      }
      if (Object.keys(updates).length > 0 && !cancelled) {
        setInfoMap((prev) => ({ ...prev, ...updates }));
      }

      // Fetch missing
      await Promise.all(
        toFetch.map(async (alias) => {
          try {
            const res = await fetch(infoUrlFor(alias));
            if (!res.ok) throw new Error("not ok");
            const data = await res.json();
            infoCache[alias] = data as VariableInfo;
          } catch {
            infoCache[alias] = null;
          }
        }),
      );

      if (!cancelled) {
        const allUpdates: Record<string, VariableInfo | null> = {};
        for (const alias of aliases) {
          allUpdates[alias] = infoCache[alias] ?? null;
        }
        setInfoMap(allUpdates);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [aliases]);

  return infoMap;
}

export function useVariableInfo(alias: string): VariableInfo | null {
  const [info, setInfo] = useState<VariableInfo | null>(
    infoCache[alias] ?? null,
  );

  useEffect(() => {
    if (alias in infoCache) {
      setInfo(infoCache[alias]);
      return;
    }
    let cancelled = false;
    fetch(infoUrlFor(alias))
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.json();
      })
      .then((data) => {
        infoCache[alias] = data as VariableInfo;
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        infoCache[alias] = null;
        if (!cancelled) setInfo(null);
      });
    return () => { cancelled = true; };
  }, [alias]);

  return info;
}
