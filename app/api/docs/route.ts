import { NextRequest, NextResponse } from "next/server";
import { addServerDoc, listServerDocs, deleteServerDoc, ServerDoc } from "@/lib/docs-server";
import { isConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  if (!isConfigured()) return NextResponse.json({ error: "server state not configured" }, { status: 503 });
  try {
    return NextResponse.json({ docs: await listServerDocs() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "server state not configured" }, { status: 503 });
  try {
    const doc = (await req.json()) as ServerDoc;
    if (!doc?.id || !doc?.title) return NextResponse.json({ error: "doc id/title required" }, { status: 400 });
    await addServerDoc(doc);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "server state not configured" }, { status: 503 });
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteServerDoc(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
