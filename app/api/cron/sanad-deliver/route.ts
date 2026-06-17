/**
 * /api/cron/sanad-deliver — poll Sanad for in-flight contract draft jobs and
 * deliver the PDF to the requesting WhatsApp recipient when ready.
 *
 * Runs every minute (see vercel.json crons).
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. We accept that
 * header OR ?key=<CRON_SECRET> as a fallback for manual triggers from a
 * browser.
 *
 * Per-job lifecycle here:
 *   1. Select active rows (status in queued, processing) ordered by created_at.
 *   2. For each: poll Sanad.
 *   3. If still queued/processing: just update last_polled_at.
 *   4. If ready: fetch PDF buffer, sendWhatsAppDocument to recipient_wa, mark
 *      status='delivered' + delivered_at + delivered_msg_id.
 *   5. If failed: mark status='failed' + failure_reason. Send a polite text
 *      to the recipient that we hit a snag.
 *
 * Each cron tick handles at most 10 rows to stay under Vercel's 60s ceiling
 * on hobby plans.
 */

import { NextResponse } from "next/server";
import { sbSelect, sbUpdate } from "@/lib/concierge/rest";
import { sanadPollJob, sanadFetchPdfBuffer, getSanadConfig } from "@/lib/sanad/client";
import { sendWhatsAppDocument, sendWhatsApp } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PendingDraftRow {
  id: string;
  job_id: string;
  recipient_wa: string;
  kind: string;
  jurisdiction: string;
  status: string;
  metadata: { party_a_name?: string; party_b_name?: string } | null;
}

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("key") === secret) return true;
  } catch {}
  return false;
}

function captionFor(row: PendingDraftRow): string {
  const kindNice = row.kind.replace(/_/g, " ");
  const a = row.metadata?.party_a_name || "Party A";
  const b = row.metadata?.party_b_name || "Party B";
  return `Here is the ${kindNice} between ${a} and ${b}, drafted under UAE ${row.jurisdiction.replace(/-/g, " ")} law. Please review and let me know if you would like any changes.`;
}

async function pollAndDeliver(row: PendingDraftRow): Promise<{ id: string; outcome: string }> {
  const r = await sanadPollJob(row.job_id);
  if (!r.ok) {
    await sbUpdate("sanad_pending_drafts", `id=eq.${row.id}`, { last_polled_at: new Date().toISOString() });
    return { id: row.id, outcome: `poll_failed_${r.reason}` };
  }
  const job = r.data;
  if (job.status === "queued" || job.status === "processing") {
    await sbUpdate("sanad_pending_drafts", `id=eq.${row.id}`, {
      status: job.status,
      last_polled_at: new Date().toISOString()
    });
    return { id: row.id, outcome: job.status };
  }
  if (job.status === "failed") {
    await sbUpdate("sanad_pending_drafts", `id=eq.${row.id}`, {
      status: "failed",
      failure_reason: job.error || "unknown",
      last_polled_at: new Date().toISOString()
    });
    await sendWhatsApp(
      row.recipient_wa,
      "I ran into a snag drafting that contract. I will let you know the moment it is back online.",
      { force: true }
    );
    return { id: row.id, outcome: "failed" };
  }
  // job.status === 'ready'
  const pdf = await sanadFetchPdfBuffer(row.job_id);
  if (!pdf.ok) {
    await sbUpdate("sanad_pending_drafts", `id=eq.${row.id}`, {
      status: "ready",
      ready_at: new Date().toISOString(),
      pdf_url: job.result?.pdf_url || null,
      last_polled_at: new Date().toISOString()
    });
    return { id: row.id, outcome: `pdf_fetch_failed_${pdf.reason}` };
  }
  const filename = `${row.kind.replace(/_/g, "-")}-${row.id.slice(0, 8)}.pdf`;
  const msgId = await sendWhatsAppDocument(row.recipient_wa, pdf.data, filename, captionFor(row), { force: true });

  // Save a copy to sanad's library for Jensen's portal
  const sanadCfg = getSanadConfig();
  if (sanadCfg && job.result?.body_markdown) {
    try {
      const baseUrl = sanadCfg.baseUrl.replace(/\/api\/v1\/?$/, "").replace(/\/+$/, "");
      const kindNice = row.kind.replace(/_/g, " ");
      const res = await fetch(`${baseUrl}/api/v1/documents/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sanadCfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `${kindNice} - ${row.metadata?.party_a_name || "Party A"} & ${row.metadata?.party_b_name || "Party B"}`,
          surface: row.kind,
          text_en: job.result.body_markdown,
          citations: job.result.citations || [],
          provenance_hash: job.result.provenance_hash || "",
          pdf_url: job.result.pdf_url || "",
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`sanad-library-sync: POST /api/v1/documents/ingest returned ${res.status} for job ${row.job_id}: ${errBody}`);
      }
    } catch (e) {
      console.error(`sanad-library-sync: network error for job ${row.job_id}:`, e instanceof Error ? e.message : e);
    }
  }

  await sbUpdate("sanad_pending_drafts", `id=eq.${row.id}`, {
    status: "delivered",
    ready_at: job.updated_at,
    delivered_at: new Date().toISOString(),
    delivered_msg_id: msgId || null,
    pdf_url: job.result?.pdf_url || null,
    last_polled_at: new Date().toISOString()
  });
  return { id: row.id, outcome: msgId ? "delivered" : "send_failed" };
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await sbSelect<PendingDraftRow>(
    "sanad_pending_drafts",
    `status=in.(queued,processing)&order=created_at.asc&limit=10`
  );
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, outcomes: [] });
  }
  const outcomes: Array<{ id: string; outcome: string }> = [];
  for (const row of rows) {
    try {
      outcomes.push(await pollAndDeliver(row));
    } catch (e) {
      outcomes.push({ id: row.id, outcome: `error_${e instanceof Error ? e.message : "unknown"}` });
    }
  }
  return NextResponse.json({ ok: true, processed: outcomes.length, outcomes });
}
