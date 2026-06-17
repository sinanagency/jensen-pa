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
  const hasPdf = !!body.pdf_url;
  const docKind = body.kind || "document";

  await addDoc({
    id: docId,
    title,
    fileName: title.replace(/[^a-zA-Z0-9_-]/g, "_") + (hasPdf ? ".pdf" : ".txt"),
    mime: hasPdf ? "application/pdf" : "text/plain",
    kind: docKind,
    text,
    folder: "contracts",
    createdAt: Date.now(),
  });

  let waMsgId: string | null = null;
  let waError: string | null = null;
  if (body.send_to_wa) {
    if (body.pdf_url) {
      try {
        const pdfRes = await fetch(body.pdf_url);
        if (pdfRes.ok) {
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          waMsgId = await sendWhatsAppDocument(
            body.send_to_wa,
            pdfBuf,
            `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
            `Contract: ${title}`,
            { force: true },
          );
        } else {
          waError = `fetch_pdf_failed_${pdfRes.status}`;
          console.error(`sanad-ingest: failed to fetch pdf_url ${body.pdf_url} (${pdfRes.status}) for ${docId}`);
        }
      } catch (e) {
        waError = `fetch_pdf_error`;
        console.error(`sanad-ingest: error fetching pdf_url for ${docId}:`, e instanceof Error ? e.message : e);
      }
    } else {
      waError = "no_pdf_url";
      console.warn(`sanad-ingest: send_to_wa set but no pdf_url provided for ${docId}; skipping WhatsApp delivery`);
    }
  }

  return NextResponse.json({
    ok: true,
    docId,
    kind: docKind,
    waMsgId,
    waError,
    folder: "contracts",
  });
}
