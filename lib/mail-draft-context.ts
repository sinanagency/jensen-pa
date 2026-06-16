// Per-contact context hydration for email draft generation. Before calling the
// LLM to write a draft, we look up the sender in contacts, brain_facts, recent
// chat_messages, and events — then inject the findings as a compact prefix.
// This is the same wall-at-primitive pattern as KT #255 and KT #261: fix at the
// data layer, not the prompt layer. (KT #302)
//
// The context string is kept deliberately short (~300 chars max) so batch
// triage prompts don't bloat. Unknown senders (no contact row) return "" and
// the LLM falls back to its generic polite template.

import { sbSelect, enc } from "./concierge/rest";

const CONTEXT_MAX = 350;

async function queryFirst(table: string, qs: string): Promise<any | null> {
  try {
    const rows = await sbSelect<any>(table, `${qs}&limit=1`);
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function querySome(
  table: string,
  qs: string,
  limit = 3
): Promise<any[]> {
  try {
    return await sbSelect<any>(table, `${qs}&limit=${limit}`);
  } catch {
    return [];
  }
}

export async function enrichDraftContext(
  fromEmail: string,
  fromName?: string
): Promise<string> {
  if (!fromEmail) return "";

  // 1) Find matching contact by email. Exact match preferred; fall back to
  //    name-based lookup if provided.
  let contact =
    (await queryFirst("contacts", `email=eq.${enc(fromEmail)}`)) || null;
  if (!contact && fromName) {
    contact = await queryFirst(
      "contacts",
      `name=ilike.*${enc(fromName)}*`
    );
  }
  if (!contact) return "";

  const name: string = contact.name || "";
  const company: string = contact.company || "";
  const role: string = contact.role || "";
  const keywords = [name, company].filter(Boolean);
  if (keywords.length === 0) return "";

  const parts: string[] = [];

  // Contact identity line
  const identity = [name, role, company].filter(Boolean).join(", ");
  parts.push(identity);

  // 2) Brain facts mentioning this contact or company
  if (keywords.length) {
    const factRows = await querySome(
      "brain_facts",
      `status=eq.active&or=(${keywords
        .map((k) => `fact.ilike.*${enc(k)}*`)
        .join(",")})`,
      2
    );
    const facts = [...new Set(factRows.map((r) => r.fact))].slice(0, 2);
    if (facts.length) {
      parts.push(
        `note: ${facts
          .map((f) => f.slice(0, 80))
          .join("; ")}`
      );
    }
  }

  // 3) Most recent user message mentioning this contact or company
  if (keywords.length) {
    const chatRows = await querySome(
      "chat_messages",
      `party=eq.jensen&role=eq.user&or=(${keywords
        .map((k) => `content.ilike.*${enc(k)}*`)
        .join(",")})`,
      1
    );
    if (chatRows.length) {
      const preview = String(chatRows[0].content || "")
        .replace(/\s+/g, " ")
        .slice(0, 80);
      parts.push(`last discussed: "${preview}"`);
    }
  }

  // 4) Most recent event with this contact or company
  if (keywords.length) {
    const eventRows = await querySome(
      "events",
      `or=(${keywords
        .map((k) => `title.ilike.*${enc(k)}*`)
        .join(",")})&order=date.desc`,
      1
    );
    if (eventRows.length) {
      const ev = eventRows[0];
      parts.push(`last event: ${ev.title} (${ev.date})`);
    }
  }

  if (parts.length <= 1) return ""; // identity-only, no useful enrichment

  let ctx = `[Draft context: ${parts.join(" | ")}]`;
  if (ctx.length > CONTEXT_MAX) {
    ctx = ctx.slice(0, CONTEXT_MAX - 3) + "...";
  }
  return ctx;
}
