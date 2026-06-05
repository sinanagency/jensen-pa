import { NextRequest, NextResponse } from "next/server";
import { askClaude, NO_DASHES } from "@/lib/anthropic";
import { htmlToPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type Item = { description: string; qty: number; unitPrice: number };

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function money(n: number, cur: string): string {
  return `${cur} ${(Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function invoiceHtml(d: any, subtotal: number, tax: number, total: number): string {
  const cur = d.currency || "AED";
  const rows = (d.items as Item[]).map(
    (it) => `<tr><td>${esc(it.description)}</td><td class="r">${it.qty}</td><td class="r">${money(it.unitPrice, cur)}</td><td class="r">${money(it.qty * it.unitPrice, cur)}</td></tr>`
  ).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter","Helvetica Neue",Arial,sans-serif; color:#161616; font-size:10.6pt; line-height:1.6; margin:0; }
  header { border-bottom: 2px solid #161616; padding-bottom: 12px; margin-bottom: 24px; display:flex; justify-content:space-between; align-items:flex-end; }
  .word { font-family: Georgia,"Times New Roman",serif; font-size: 17pt; letter-spacing: 4px; }
  .tag { font-size: 8pt; letter-spacing: 3px; color:#8a8a96; text-transform:uppercase; }
  .meta { display:flex; justify-content:space-between; margin-bottom:24px; gap:24px; }
  .meta h1 { font-family:Georgia,serif; font-size:24pt; margin:0 0 6px; letter-spacing:1px; }
  .meta .lbl { font-size:8pt; letter-spacing:2px; color:#8a8a96; text-transform:uppercase; }
  .meta .box div { margin-bottom:2px; }
  table { width:100%; border-collapse:collapse; margin: 6px 0 14px; font-size:10pt; }
  th,td { text-align:left; padding:9px 10px; border-bottom:1px solid #e6e6e6; }
  th { color:#6b6b6b; font-weight:600; font-size:8.5pt; text-transform:uppercase; letter-spacing:.4px; }
  td.r, th.r { text-align:right; }
  .totals { width:46%; margin-left:auto; }
  .totals td { border:0; padding:5px 10px; }
  .totals .grand td { border-top:2px solid #161616; font-weight:700; font-size:12pt; }
  .note { margin-top:22px; font-size:9pt; color:#555; }
  .note b { color:#161616; }
  footer { margin-top:30px; padding-top:10px; border-top:1px solid #eee; font-size:8pt; color:#aaa; text-align:center; letter-spacing:.3px; }
  </style></head><body>
  <header><span class="word">LA RENCONTRE</span><span class="tag">Hospitality · Dubai</span></header>
  <div class="meta">
    <div class="box">
      <h1>INVOICE</h1>
      <div class="lbl">Billed to</div>
      <div><b>${esc(d.billTo || "Client")}</b></div>
      ${(d.billToAddress || "").split("\n").filter(Boolean).map((l: string) => `<div>${esc(l)}</div>`).join("")}
    </div>
    <div class="box" style="text-align:right">
      <div><span class="lbl">Invoice</span><br>${esc(d.invoiceNo || "INV-001")}</div>
      <div style="margin-top:8px"><span class="lbl">Date</span><br>${esc(d.date || "")}</div>
      ${d.dueDate ? `<div style="margin-top:8px"><span class="lbl">Due</span><br>${esc(d.dueDate)}</div>` : ""}
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="r">${money(subtotal, d.currency || "AED")}</td></tr>
    <tr><td>VAT (${d.taxRate ?? 5}%)</td><td class="r">${money(tax, d.currency || "AED")}</td></tr>
    <tr class="grand"><td>Total</td><td class="r">${money(total, d.currency || "AED")}</td></tr>
  </table>
  ${d.notes ? `<div class="note"><b>Notes.</b> ${esc(d.notes)}</div>` : ""}
  ${d.terms ? `<div class="note"><b>Terms.</b> ${esc(d.terms)}</div>` : ""}
  <footer>La Rencontre Hospitality · Dubai, UAE · Thank you for your business</footer>
  </body></html>`;
}

export async function POST(req: NextRequest) {
  try {
    const d = await req.json();

    // AI draft: turn free text (or a pasted quote) into structured invoice fields.
    if (d.mode === "draft") {
      if (!d.text) return NextResponse.json({ error: "text required" }, { status: 400 });
      const out = await askClaude({
        system: `You extract invoice fields for a Dubai F&B consultancy (La Rencontre). Given the user's description, return ONLY minified JSON, no prose, no code fences, with this exact shape: {"billTo":string,"billToAddress":string,"items":[{"description":string,"qty":number,"unitPrice":number}],"notes":string,"terms":string}. Infer sensible line items and AED amounts. ${NO_DASHES}`,
        messages: [{ role: "user", content: String(d.text) }],
        maxTokens: 900,
        temperature: 0.3,
      });
      const clean = out.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      try {
        return NextResponse.json({ draft: JSON.parse(clean) });
      } catch {
        return NextResponse.json({ error: "Could not parse the draft, try rephrasing." }, { status: 422 });
      }
    }

    // Generate the branded invoice PDF. Totals are recomputed server-side (never trusted from the client).
    const items: Item[] = Array.isArray(d.items) ? d.items.filter((i: any) => i && i.description) : [];
    if (!items.length) return NextResponse.json({ error: "at least one line item required" }, { status: 400 });
    const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
    const tax = subtotal * ((Number(d.taxRate) ?? 5) / 100);
    const total = subtotal + tax;

    const html = invoiceHtml({ ...d, items }, subtotal, tax, total);
    const fname = `invoice-${(d.invoiceNo || "001").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const pdf = await htmlToPdf(html);
    if (pdf) {
      return new Response(new Uint8Array(pdf), {
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${fname}.pdf"` },
      });
    }
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="${fname}.html"` },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
