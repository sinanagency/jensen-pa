import { NextRequest, NextResponse } from "next/server";
import { askClaude, NO_DASHES } from "@/lib/anthropic";
import { htmlToPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const TYPES: Record<string, string> = {
  proposal: "a consulting proposal for an F&B client",
  concept: "a venue concept document (positioning, experience, target guest, signature ideas)",
  menu: "a menu engineering brief (structure, signature dishes, pricing logic, margin notes)",
  sop: "a standard operating procedures outline for a hospitality venue",
  cost: "a cost strategy and margin optimization brief",
  letter: "a professional letter or formal note",
  nda: "a mutual non disclosure agreement, with clear clauses and signature blocks",
  service: "a services agreement between La Rencontre and a client, with scope, fees, term, and signature blocks",
  consultancy: "a consultancy agreement for an F&B engagement, with deliverables, phases, fees, and signature blocks",
  engagement: "a formal engagement letter confirming scope and terms with a client",
};

const LEGAL = new Set(["nda", "service", "consultancy", "engagement"]);

function brandedHtml(title: string, subtitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter","Helvetica Neue",Arial,sans-serif; color:#161616; font-size:10.6pt; line-height:1.62; margin:0; }
  header { border-bottom: 2px solid #161616; padding-bottom: 12px; margin-bottom: 26px; display:flex; justify-content:space-between; align-items:flex-end; }
  .word { font-family: Georgia, "Times New Roman", serif; font-size: 17pt; letter-spacing: 4px; }
  .tag { font-size: 8pt; letter-spacing: 3px; color:#8a8a96; text-transform:uppercase; }
  h1 { font-family: Georgia, serif; font-size: 23pt; font-weight: 600; margin: 0 0 4px; letter-spacing:-0.3px; }
  .sub { color:#6b6b6b; font-size: 10pt; margin-bottom: 24px; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .6px; color:#161616; margin: 22px 0 7px; border-left: 3px solid #8b5cf6; padding-left: 10px; }
  p { margin: 0 0 9px; text-align: justify; }
  ul,ol { margin: 0 0 10px; padding-left: 20px; } li { margin-bottom: 5px; }
  table { width:100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.6pt; }
  th,td { text-align:left; padding: 7px 9px; border-bottom: 1px solid #e6e6e6; } th { color:#6b6b6b; font-weight:600; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #eee; font-size: 8pt; color:#aaa; text-align:center; letter-spacing:.3px; }
  </style></head><body>
  <header><span class="word">LA RENCONTRE</span><span class="tag">Hospitality · Dubai</span></header>
  <h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
  ${bodyHtml}
  <footer>La Rencontre Hospitality · Prepared by Jensen · Confidential</footer>
  </body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  try {
    const { type, title, details } = await req.json();
    const kind = TYPES[type] || "a professional hospitality document";
    if (!title || !details) {
      return NextResponse.json({ error: "title and details required" }, { status: 400 });
    }

    const isLegal = LEGAL.has(type);
    const body = await askClaude({
      system: [
        isLegal
          ? "You are drafting a legal document on behalf of La Rencontre (Dubai, UAE). Use clear defined terms, numbered clauses, and signature blocks. Default governing law to the Emirate of Dubai and the UAE unless told otherwise. Include a short note that it is a draft for review and not a substitute for legal advice."
          : "You are a senior F&B hospitality consultant at La Rencontre writing a client-ready document.",
        `Write ${kind}. Output ONLY the document body as clean semantic HTML using h2, p, ul, ol, and table tags. No <html>, <head>, or <body> wrapper, no markdown, no code fences.`,
        "Be specific, confident, and commercially sharp. Use clear section headings. Where useful include a simple table (for pricing, phases, or margins).",
        NO_DASHES,
      ].join("\n"),
      messages: [{ role: "user", content: `Title: ${title}\n\nBrief and details:\n${details}` }],
      maxTokens: 2600,
      temperature: 0.55,
    });

    const cleaned = body.replace(/^```html\s*/i, "").replace(/```$/, "").trim();
    const html = brandedHtml(title, type ? (TYPES[type] ? title : "") : "", cleaned);

    const pdf = await htmlToPdf(html);
    const filenameBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "document";

    if (pdf) {
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filenameBase}.pdf"`,
        },
      });
    }
    // Local fallback: serve the branded HTML (the universal floor).
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${filenameBase}.html"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
