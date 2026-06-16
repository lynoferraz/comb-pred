import { NextResponse } from "next/server";
import marketModel from "../../../market-models/demo.json";
import worldcupModel from "../../../market-models/worldcup.json";

// Manifest of all bundled variable info, served in one request so the markets
// grid can search/filter/sort over the whole universe without one fetch per
// alias. Variables added at runtime (not in the bundle) are not listed here —
// they keep resolving through the per-alias /api/info/<alias> route, which
// also carries the remote-registry (INFO_REGISTRY_URL) fallback.
//
// Info is near-static (states/category/name change rarely), so it is safe to
// cache aggressively; the per-alias route stays dynamic for registry updates.

export const dynamic = "force-static";

interface VariableInfo {
  alias: string;
  name?: string;
  description?: string;
  states?: string[];
  category?: string;
  tags?: string[];
}

const MANIFEST: VariableInfo[] = [
  ...marketModel.variables,
  ...worldcupModel.variables,
].map((v: VariableInfo & Record<string, unknown>) => ({
  alias: v.alias,
  name: v.name,
  description: v.description,
  states: v.states,
  category: v.category,
  tags: v.tags,
}));

export async function GET() {
  return NextResponse.json(
    { data: MANIFEST },
    {
      headers: {
        // Long browser/CDN cache; info rarely changes between deploys.
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
