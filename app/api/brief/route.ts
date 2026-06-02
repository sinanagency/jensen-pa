import { NextRequest, NextResponse } from "next/server";
import { askClaude } from "@/lib/anthropic";
import { briefSystem } from "@/lib/persona";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { context } = await req.json();
    if (typeof context !== "string") {
      return NextResponse.json({ error: "context required" }, { status: 400 });
    }
    const text = await askClaude({
      system: briefSystem(),
      messages: [{ role: "user", content: context }],
      maxTokens: 500,
      temperature: 0.6,
    });
    return NextResponse.json({ brief: text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
