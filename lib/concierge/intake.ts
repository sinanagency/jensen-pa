// Document intake — runs ALWAYS, even during onboarding, independent of the
// listen-only chat brain. A dropped/sent file is stored + embedded (so the brain
// can recall it later), classified into a folder, turned into a finance row if
// it's an invoice, and noted as a durable fact. This is how Jensen can start
// feeding his world from day one and the concierge already "knows" his documents.

import { claudeJSON, NO_DASHES } from "../anthropic";
import * as ops from "./ops";
import { rememberFact } from "./brain";

const FOLDERS = ["finance", "legal", "identity", "contracts", "clients", "venues", "events", "menus", "branding", "reports", "general"];

const SYS =
  `Classify a document for La Rencontre, a luxury F&B hospitality consultancy in Dubai. ` +
  `Return JSON {folder, summary, isInvoice, amount, currency, vendor, date}. ` +
  `folder MUST be one of: ${FOLDERS.join(", ")}. ` +
  `isInvoice true ONLY for an invoice, receipt, or bill. ` +
  `amount = the net total as a plain number if clearly shown, else null (NEVER guess a number). ` +
  `currency like AED. date = ISO YYYY-MM-DD if shown, else null. ` +
  `summary = one short line of what the document is and why it matters. ${NO_DASHES}`;

export type Filed = { folder: string; summary: string; finance: { amount: number; label: string } | null };

export async function classifyAndFile(doc: { id: string; title: string; text: string; entityId?: string }): Promise<Filed> {
  let c: any = null;
  try {
    c = await claudeJSON(SYS, `Title: ${doc.title}\n\n${doc.text.slice(0, 4000)}`, 400);
  } catch { /* classify best-effort */ }
  const folder = FOLDERS.includes(c?.folder) ? c.folder : "general";

  await ops.fileDocument({ id: doc.id, folder, entityId: doc.entityId }).catch(() => {});

  let finance: { amount: number; label: string } | null = null;
  if (c?.isInvoice && typeof c.amount === "number" && c.amount > 0) {
    const label = c.vendor || doc.title;
    await ops.recordFinance({ kind: "expense", amount: c.amount, vatApplies: true, label, date: c.date || undefined }).catch(() => {});
    finance = { amount: c.amount, label };
  }

  // Make the brain aware of the document in plain language, so it surfaces in
  // grounding/recall and the concierge can offer to send it when relevant.
  await rememberFact(
    `Document on file: "${doc.title}" [${folder}]${c?.summary ? ` — ${c.summary}` : ""}.`,
    { kind: "fact", source: "document", subject: doc.title }
  ).catch(() => {});

  return { folder, summary: c?.summary || doc.title, finance };
}
