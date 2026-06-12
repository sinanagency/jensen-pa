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
  // Brand-grade letterhead: Cormorant Garamond wordmark for the lockup,
  // restrained purple accent, La Rencontre FZE address block, footer with the
  // contact line Jensen uses on every outbound document.
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
  @page { size: A4; margin: 18mm 18mm 14mm; }
  * { box-sizing: border-box; }
  :root { --ink: #161618; --muted: #6b6b75; --faint: #98989f; --line: #e7e7eb; --purple: #7c6bb0; --gold: #b89a5a; }
  body { font-family: "Inter","Helvetica Neue",Arial,sans-serif; color: var(--ink); font-size: 10.4pt; line-height: 1.55; margin: 0; }

  .letterhead {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 16px; margin-bottom: 28px;
    border-bottom: 1px solid var(--ink);
  }
  .lockup .emblem { display: block; font-family: "Cormorant Garamond", Georgia, serif; font-size: 28pt; line-height: 1; letter-spacing: 4px; color: var(--ink); }
  .lockup .name { display: block; font-family: "Cormorant Garamond", Georgia, serif; font-size: 14pt; letter-spacing: 6px; color: var(--ink); margin-top: 6px; }
  .lockup .tag { display: block; font-size: 7.6pt; letter-spacing: 2.6px; color: var(--purple); text-transform: uppercase; margin-top: 8px; }
  .corp { text-align: right; font-size: 8.6pt; color: var(--muted); line-height: 1.55; }
  .corp .strong { color: var(--ink); font-weight: 500; }

  .ribbon {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin-bottom: 28px;
  }
  .doc-label { font-family: "Cormorant Garamond", Georgia, serif; font-size: 34pt; line-height: 1; letter-spacing: 2px; color: var(--ink); }
  .doc-meta { text-align: right; font-size: 9pt; color: var(--muted); }
  .doc-meta .lbl { font-size: 7.6pt; letter-spacing: 2.4px; color: var(--faint); text-transform: uppercase; }
  .doc-meta .val { color: var(--ink); font-weight: 500; margin-top: 2px; display: block; }
  .doc-meta .row { margin-top: 8px; }

  .billed-to { margin-bottom: 22px; }
  .billed-to .lbl { font-size: 7.6pt; letter-spacing: 2.4px; color: var(--faint); text-transform: uppercase; margin-bottom: 4px; }
  .billed-to .who { font-size: 11.2pt; font-weight: 500; color: var(--ink); }
  .billed-to .addr { font-size: 9.4pt; color: var(--muted); margin-top: 2px; }

  table.items { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 9.8pt; }
  table.items thead th { text-align: left; padding: 8px 10px; border-bottom: 1.5px solid var(--ink); font-weight: 500; font-size: 7.8pt; text-transform: uppercase; letter-spacing: 1.6px; color: var(--muted); }
  table.items tbody td { padding: 11px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.items td.r, table.items th.r { text-align: right; }

  table.totals { width: 48%; margin-left: auto; font-size: 10pt; }
  table.totals td { border: 0; padding: 5px 10px; }
  table.totals .grand td { border-top: 2px solid var(--ink); font-weight: 600; font-size: 11.6pt; padding-top: 11px; }
  table.totals .grand .amt { color: var(--purple); font-family: "Cormorant Garamond", Georgia, serif; font-size: 16pt; letter-spacing: 0.4px; }

  .notes-block { margin-top: 26px; padding: 14px 16px; background: #faf9fb; border-left: 2px solid var(--purple); border-radius: 2px; }
  .notes-block .lbl { font-size: 7.6pt; letter-spacing: 2.4px; color: var(--purple); text-transform: uppercase; font-weight: 500; }
  .notes-block .body { font-size: 9.6pt; color: var(--ink); margin-top: 6px; }

  footer.foot {
    margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--line);
    display: flex; justify-content: space-between; align-items: center;
    font-size: 7.6pt; color: var(--faint); letter-spacing: 0.3px;
  }
  footer .gold { color: var(--gold); font-family: "Cormorant Garamond", Georgia, serif; font-size: 10pt; letter-spacing: 2px; }
  </style></head><body>

  <div class="letterhead">
    <div class="lockup">
      <span class="emblem">⌐</span>
      <span class="name">LA&nbsp;RENCONTRE</span>
      <span class="tag">F&amp;B Consultancy &middot; Dubai</span>
    </div>
    <div class="corp">
      <div class="strong">La Rencontre FZE</div>
      <div>Palm Jumeirah, Dubai</div>
      <div>United Arab Emirates</div>
      <div style="margin-top:6px">jensen@larencontre.ae</div>
      <div>larencontre.ae</div>
    </div>
  </div>

  <div class="ribbon">
    <div class="doc-label">Invoice</div>
    <div class="doc-meta">
      <div class="row"><span class="lbl">Invoice no.</span><span class="val">${esc(d.invoiceNo || "INV-001")}</span></div>
      <div class="row"><span class="lbl">Issue date</span><span class="val">${esc(d.date || "")}</span></div>
      ${d.dueDate ? `<div class="row"><span class="lbl">Due</span><span class="val">${esc(d.dueDate)}</span></div>` : ""}
    </div>
  </div>

  <div class="billed-to">
    <div class="lbl">Billed to</div>
    <div class="who">${esc(d.billTo || "Client")}</div>
    ${(d.billToAddress || "").split("\n").filter(Boolean).map((l: string) => `<div class="addr">${esc(l)}</div>`).join("")}
  </div>

  <table class="items">
    <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td class="r">${money(subtotal, cur)}</td></tr>
    <tr><td>VAT (${d.taxRate ?? 5}%)</td><td class="r">${money(tax, cur)}</td></tr>
    <tr class="grand"><td>Total due</td><td class="r amt">${money(total, cur)}</td></tr>
  </table>

  ${d.notes ? `<div class="notes-block"><div class="lbl">Notes</div><div class="body">${esc(d.notes)}</div></div>` : ""}
  ${d.terms ? `<div class="notes-block"><div class="lbl">Terms</div><div class="body">${esc(d.terms)}</div></div>` : ""}

  <footer class="foot">
    <div>La Rencontre Hospitality &middot; Dubai, UAE</div>
    <div class="gold">Thank you for your business.</div>
  </footer>

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
