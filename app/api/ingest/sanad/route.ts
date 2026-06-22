import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/db";
import { addDoc } from "@/lib/concierge/ops";
import { sendWhatsAppDocument, whoIs } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SINGLE-TENANT DELIVERY LOCK (Law 9 + Law 3 PII). A Sanad-delivered contract
// may ONLY ever land on JENSEN's WhatsApp, never an arbitrary number. We resolve
// the owner-role number from OWNER_WHATSAPP/OWNER_PROFILES and ignore whatever
// number the caller passes; a mismatched request number is refused, not honored.
// This means the WhatsApp send is effectively available only for Jensen: Sanad
// must gate the "send to my WhatsApp" action behind his authenticated session,
// and even if that gate is bypassed, Dorje will not deliver to anyone else.
function jensenWa(): string | null {
  const raw = process.env.OWNER_WHATSAPP || "";
  const digits = raw.split(",").map((n) => n.replace(/[^0-9]/g, "")).filter(Boolean);
  const owner = digits.find((d) => whoIs(d).role === "owner");
  return owner || digits.find((d) => whoIs(d).role !== "developer") || null;
}

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
    // DELIVERY LOCK: resolve Jensen's own number and refuse any other recipient.
    const jensen = jensenWa();
    const requested = (body.send_to_wa || "").replace(/[^0-9]/g, "");
    if (!jensen) {
      waError = "owner_not_configured"; // OWNER_WHATSAPP unset/blank — fail closed (Law 9)
      console.warn(`sanad-ingest: send_to_wa set but no owner configured; refusing delivery for ${docId}`);
    } else if (requested && requested !== jensen) {
      waError = "recipient_not_jensen"; // caller asked for a non-Jensen number — single-tenant refusal
      console.warn(`sanad-ingest: refused WhatsApp delivery to a non-Jensen number for ${docId}`);
    } else if (body.pdf_url) {
      try {
        const pdfRes = await fetch(body.pdf_url);
        if (pdfRes.ok) {
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          waMsgId = await sendWhatsAppDocument(
            jensen,
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
