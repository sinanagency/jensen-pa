import { NextRequest, NextResponse } from "next/server";
import { embed, chunk } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Two modes:
//   { mode: "ingest", text } -> returns { chunks: [{text, embedding}] }
//   { mode: "query", text }  -> returns { embedding }
export async function POST(req: NextRequest) {
  try {
    const { mode, text } = await req.json();
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    if (mode === "query") {
      const [embedding] = await embed([text.slice(0, 4000)]);
      return NextResponse.json({ embedding });
    }
    // ingest
    const parts = chunk(text);
    if (parts.length === 0) return NextResponse.json({ chunks: [] });
    const vectors = await embed(parts);
    const chunks = parts.map((t, i) => ({ text: t, embedding: vectors[i] }));
    return NextResponse.json({ chunks });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
