import { NextRequest, NextResponse } from "next/server";
import marketModel from "../../../../market-models/demo.json";
import worldcupModel from "../../../../market-models/worldcup.json";

// Variable metadata for the prediction markets. Two sources, in order:
//
// 1. The bundled model files (market-models/*.json) — the same files that
//    drive the seed scripts, so the seeded variables stay in sync.
// 2. A remote registry (INFO_REGISTRY_URL env var): <base>/<alias>.json.
//    Variables added while the site is running get their info published by
//    dropping an <alias>.json file there (e.g. a GitHub repo's raw URL) —
//    no frontend redeploy, and the on-chain info_url keeps pointing at the
//    stable /api/info/<alias>.
//
// Aliases are distinct across the two models (World Cup uses a1..l3 and
// m73..m104), so the merged map has no key collisions.

export const dynamic = "force-dynamic";

interface VariableInfo {
  alias: string;
  name?: string;
  description?: string;
  states?: string[];
  category?: string;
  tags?: string[];
}

const LOCAL_INFO: Record<string, VariableInfo> = Object.fromEntries(
  [...marketModel.variables, ...worldcupModel.variables].map(
    (v: VariableInfo & Record<string, unknown>) => [
      v.alias,
      {
        alias: v.alias,
        name: v.name,
        description: v.description,
        states: v.states,
        category: v.category,
        tags: v.tags,
      },
    ],
  ),
);

// Registry lookups are cached in-memory (hits and misses) so a popular page
// doesn't hammer the registry; entries expire after a short TTL so updates
// and newly published files show up without a restart.
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const registryCache = new Map<
  string,
  { data: VariableInfo | null; expires: number }
>();

const ALIAS_RE = /^[a-z0-9_-]{1,32}$/;

async function fetchFromRegistry(alias: string): Promise<VariableInfo | null> {
  const base = process.env.INFO_REGISTRY_URL;
  if (!base) return null;

  const cached = registryCache.get(alias);
  if (cached && cached.expires > Date.now()) return cached.data;

  let data: VariableInfo | null = null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/${alias}.json`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === "object" && !Array.isArray(json)) {
        data = {
          alias,
          name: typeof json.name === "string" ? json.name : undefined,
          description:
            typeof json.description === "string" ? json.description : undefined,
          states: Array.isArray(json.states)
            ? json.states.filter((s: unknown) => typeof s === "string")
            : undefined,
          category:
            typeof json.category === "string" ? json.category : undefined,
          tags: Array.isArray(json.tags)
            ? json.tags.filter((t: unknown) => typeof t === "string")
            : undefined,
        };
      }
    }
  } catch {
    // Network/timeout errors fall through as a (cached) miss.
  }
  registryCache.set(alias, { data, expires: Date.now() + REGISTRY_TTL_MS });
  return data;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { alias: string } },
) {
  const alias = params.alias.toLowerCase();
  if (!ALIAS_RE.test(alias)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = LOCAL_INFO[alias] ?? (await fetchFromRegistry(alias));
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
