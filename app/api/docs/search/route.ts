import { NextRequest, NextResponse } from "next/server";
import { searchServerDocs } from "@/lib/docs-server";
import { isConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST { embedding:number[], k? } -> [{title,text,score}]  (pgvector RAG)
export async function POST(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ hits: [] });
  try {
    const { embedding, k } = await req.json();
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return NextResponse.json({ error: "embedding required" }, { status: 400 });
    }
    return NextResponse.json({ hits: await searchServerDocs(embedding, k || 5) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
