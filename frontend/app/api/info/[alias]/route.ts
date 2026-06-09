import { NextRequest, NextResponse } from "next/server";
import marketModel from "../../../lib/market-model.json";

// Variable metadata for the demo prediction market, derived from the shared
// market model (app/lib/market-model.json) so the API, the seed script, and
// the on-chain variables all stay in sync. Each variable's on-chain info_url
// points here at /api/info/<alias>.
const INFO_DATA: Record<string, object> = Object.fromEntries(
  marketModel.variables.map((v) => [
    v.alias,
    {
      alias: v.alias,
      name: v.name,
      description: v.description,
      states: v.states,
      category: v.category,
    },
  ]),
);

export async function GET(
  _request: NextRequest,
  { params }: { params: { alias: string } },
) {
  const alias = params.alias.toLowerCase();
  const data = INFO_DATA[alias];
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
