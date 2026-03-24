import { NextRequest, NextResponse } from "next/server";

const INFO_DATA: Record<string, object> = {
  cancer: {
    alias: "cancer",
    name: "Cancer",
    description:
      "Whether the patient has cancer. Influenced by pollution exposure and smoking habits.",
    states: ["No Cancer", "Has Cancer"],
    category: "diagnosis",
  },
  pol: {
    alias: "pol",
    name: "Pollution Level",
    description:
      "Environmental pollution exposure level in the patient's area of residence.",
    states: ["Low Pollution", "High Pollution"],
    category: "environment",
  },
  smok: {
    alias: "smok",
    name: "Smoker Status",
    description:
      "Whether the patient is a regular smoker. Combined with pollution, increases cancer risk.",
    states: ["Non-Smoker", "Smoker"],
    category: "lifestyle",
  },
  xray: {
    alias: "xray",
    name: "X-Ray Result",
    description:
      "Chest X-ray diagnostic result. Positive results are more likely when cancer is present.",
    states: ["Negative", "Positive"],
    category: "diagnostic",
  },
  dysp: {
    alias: "dysp",
    name: "Dyspnoea",
    description:
      "Presence of difficulty breathing (dyspnoea). Can be caused by cancer or other conditions.",
    states: ["No Dyspnoea", "Has Dyspnoea"],
    category: "symptom",
  },
};

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
