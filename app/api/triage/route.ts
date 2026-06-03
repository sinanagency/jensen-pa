import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

// Triage dropped content. Given extracted text (from a file, paste, or photo via
// /api/ingest-file), decide where it belongs in the portal and pull the fields
// needed to file it. The client applies the result to its store. This is the
// "drop everything and it gets populated" brain.
//
// destination:
//   finance  -> a money record (invoice, receipt, bank line)
//   task     -> an action item, with an Eisenhower quadrant
//   contact  -> a person / company
//   event    -> a dated calendar item
//   note     -> freeform note worth keeping
//   document -> nothing structured to extract, keep the file in the brain
type Triage = {
  destination: "finance" | "task" | "contact" | "event" | "note" | "document";
  summary: string;
  finance?: { kind: "income" | "expense"; amount: number; vatApplies: boolean; label: string; date?: string; vendor?: string };
  task?: { title: string; quadrant: 1 | 2 | 3 | 4 };
  contact?: { name: string; company?: string; role?: string; email?: string; phone?: string };
  event?: { title: string; date?: string; time?: string; note?: string };
  note?: { title: string; body: string };
};

const SYSTEM = `You are the filing brain for Jensen, who runs La Rencontre, a luxury hospitality company in Dubai (UAE).
Jensen drops files, photos, pasted text, or voice notes at you. Decide the ONE best destination and extract the fields to file it. ${NO_DASHES}

Destinations and their fields:
- "finance": invoices, receipts, bank statements, anything with a money amount Jensen would track. kind is "income" if money comes IN to him, "expense" if it goes OUT. amount is the NET figure in AED as a number (no currency symbol, no commas). If a different currency, convert roughly to AED and say so in summary. vatApplies true if UAE VAT is shown or implied. label is a short human description. date is ISO YYYY-MM-DD if present. vendor is the other party.
- "task": a clear action Jensen must do. quadrant uses Eisenhower: 1 urgent+important, 2 important not urgent, 3 urgent not important (delegate), 4 neither.
- "contact": a person or company to remember (business card, signature, intro).
- "event": something dated to put on the calendar.
- "note": useful information worth keeping that is not any of the above.
- "document": a reference document with nothing structured to pull; it just gets stored.

summary is one short sentence telling Jensen what you filed and where, in his voice (first person as his concierge, e.g. "I logged a 12,000 AED expense for freelance design.").
Only include the sub-object that matches the destination. Amounts must be plain numbers.`;

export async function POST(req: NextRequest) {
  try {
    const { text, filename, kind } = await req.json();
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const user = `FILENAME: ${filename || "(pasted text)"}\nDETECTED KIND: ${kind || "unknown"}\n\nCONTENT:\n${text.slice(0, 8000)}`;
    const result = await claudeJSON<Triage>(SYSTEM, user, 900);
    if (!result || !result.destination) {
      return NextResponse.json({ destination: "document", summary: "I saved this to your documents." });
    }
    // sanitise finance amount
    if (result.finance && typeof result.finance.amount !== "number") {
      const n = Number(String(result.finance.amount).replace(/[^0-9.]/g, ""));
      result.finance.amount = isFinite(n) ? n : 0;
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
