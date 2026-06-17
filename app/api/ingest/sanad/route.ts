import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/db";
import { addDoc } from "@/lib/concierge/ops";
import { sendWhatsAppDocument } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authOk(req: NextRequest): boolean {
  const secret = process.env.SANAD_INGEST_KEY;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || "";
  return hdr === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    title?: string;
    kind?: string;
    text_en?: string;
    pdf_url?: string;
    provenance_hash?: string;
    send_to_wa?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const docId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const title = body.title || "Untitled contract";
  const text = body.text_en || "";

  await addDoc({
    id: docId,
    title,
    fileName: title.replace(/[^a-zA-Z0-9_-]/g, "_") + ".txt",
    mime: "text/plain",
    kind: "document",
    text,
    folder: "contracts",
    createdAt: Date.now(),
  });

  let waMsgId: string | null = null;
  if (body.send_to_wa && text.length > 0) {
    try {
      const pdfBuf = Buffer.from(text, "utf-8");
      waMsgId = await sendWhatsAppDocument(
        body.send_to_wa,
        pdfBuf,
        `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`,
        `Contract: ${title}`,
        { force: true },
      );
    } catch {
      // best-effort WhatsApp delivery
    }
  }

  return NextResponse.json({
    ok: true,
    docId,
    waMsgId,
    folder: "contracts",
  });
}
