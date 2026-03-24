"use client";

import { useState, useEffect, useCallback } from "react";
import type { VariableInfo, VariableSummary } from "./cartesi";

// In-memory cache shared across hook instances within the same page lifecycle
const infoCache: Record<string, VariableInfo | null> = {};

export function useVariableInfoMap(variables: VariableSummary[]): Record<string, VariableInfo | null> {
  const [infoMap, setInfoMap] = useState<Record<string, VariableInfo | null>>({});

  useEffect(() => {
    if (variables.length === 0) return;
    let cancelled = false;

    const fetchAll = async () => {
      const updates: Record<string, VariableInfo | null> = {};
      const toFetch = variables.filter((v) => v.info_url && !(v.alias in infoCache));

      // Return cached immediately
      for (const v of variables) {
        if (v.alias in infoCache) {
          updates[v.alias] = infoCache[v.alias];
        }
      }
      if (Object.keys(updates).length > 0 && !cancelled) {
        setInfoMap((prev) => ({ ...prev, ...updates }));
      }

      // Fetch missing
      await Promise.all(
        toFetch.map(async (v) => {
          try {
            const res = await fetch(v.info_url);
            if (!res.ok) throw new Error("not ok");
            const data = await res.json();
            infoCache[v.alias] = data as VariableInfo;
          } catch {
            infoCache[v.alias] = null;
          }
        }),
      );

      if (!cancelled) {
        const allUpdates: Record<string, VariableInfo | null> = {};
        for (const v of variables) {
          allUpdates[v.alias] = infoCache[v.alias] ?? null;
        }
        setInfoMap(allUpdates);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [variables]);

  return infoMap;
}

export function useVariableInfo(alias: string, infoUrl?: string): VariableInfo | null {
  const [info, setInfo] = useState<VariableInfo | null>(infoCache[alias] ?? null);

  useEffect(() => {
    if (!infoUrl) return;
    if (alias in infoCache) {
      setInfo(infoCache[alias]);
      return;
    }
    let cancelled = false;
    fetch(infoUrl)
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
  }, [alias, infoUrl]);

  return info;
}
