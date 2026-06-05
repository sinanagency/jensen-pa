// Dispatch a tool call to a real handler. Returns a compact JSON-able result the
// model reads back. Errors are surfaced (never a fake success).

import * as ops from "./ops";
import { recall, rememberFact, queryMemory, rememberDirective, listMemory, forgetMemory } from "./brain";
import { vatFromNet, corporateTax } from "../tax";
import { askClaude, NO_DASHES, SONNET } from "../anthropic";
import { dubaiToday, dubaiNow } from "../time";
import { ordersContext } from "../shopify";
import { callOwner } from "../voice-call";
import { aggregateInbox, readUnified, sendUnified, unpackId } from "../mail-provider";

type Result = any;

async function financeSummary(i: { entityId?: string; from?: string; to?: string }) {
  let rows = await ops.listFinance({ entityId: i.entityId });
  if (i.from) rows = rows.filter((r: any) => r.date >= i.from!);
  if (i.to) rows = rows.filter((r: any) => r.date <= i.to!);
  const income = rows.filter((r: any) => r.kind === "income").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const expense = rows.filter((r: any) => r.kind === "expense").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const byEntity: Record<string, { income: number; expense: number }> = {};
  for (const r of rows) {
    const k = r.entity_id || "unassigned";
    byEntity[k] = byEntity[k] || { income: 0, expense: 0 };
    byEntity[k][r.kind === "income" ? "income" : "expense"] += Number(r.amount);
  }
  return { income, expense, net: income - expense, currency: "AED", count: rows.length, byEntity };
}

async function vatReport(i: { from?: string; to?: string }) {
  let rows = await ops.listFinance({ kind: "income" });
  if (i.from) rows = rows.filter((r: any) => r.date >= i.from!);
  if (i.to) rows = rows.filter((r: any) => r.date <= i.to!);
  let vat = 0, net = 0;
  for (const r of rows) if (r.vat_applies) { const v = vatFromNet(Number(r.amount)); vat += v.vat; net += v.net; }
  return { period: { from: i.from || "all", to: i.to || "all" }, vatableNet: net, outputVatDue: Math.round(vat * 100) / 100, rate: "5%", note: "Output VAT on income where VAT applies. Net of input VAT not included." };
}

async function ctEstimate(i: { from?: string; to?: string }) {
  const s = await financeSummary(i);
  const ct = corporateTax(s.net);
  return { taxableProfit: s.net, corporateTax: ct.tax, detail: ct, note: "9% on taxable income above AED 375,000. Estimate only; confirm with an accountant." };
}

const GEN_SYS = (kind: string) =>
  `You are Rencontre, drafting a ${kind} for Jensen, founder of La Rencontre, a luxury F&B hospitality consultancy in Dubai. Write a polished, client-ready ${kind} in clean prose with clear headings. UAE context (AED, 5% VAT, local norms). ${NO_DASHES} Output the document body only.`;

const LEGAL_SYS = (kind: string, blueprint: string) =>
  `You are Rencontre, drafting a UAE ${kind} for Jensen / La Rencontre. Ground it in this legal blueprint where relevant:\n${blueprint || "(no blueprint saved yet; use sensible UAE defaults and flag where Jensen must fill specifics)"}\nDraft a clear, professional document under Dubai/UAE law. Add a short note that a UAE lawyer should review before signing. ${NO_DASHES} Output the document body only.`;

export async function runAction(name: string, input: any): Promise<{ ok: boolean; result?: Result; error?: string }> {
  try {
    let result: Result;
    switch (name) {
      // entities
      case "list_entities": result = await ops.listEntities(input); break;
      case "find_entity": result = await ops.findEntity(input.name); break;
      case "create_entity": result = await ops.createEntity(input); break;
      case "update_entity": result = await ops.updateEntity(input); break;
      case "delete_entity": result = await ops.deleteEntity(input.id); break;
      // tasks
      case "list_tasks": result = await ops.listTasks(input); break;
      case "create_task": result = await ops.createTask(input); break;
      case "update_task": result = await ops.updateTask(input); break;
      case "complete_task": result = await ops.updateTask({ id: input.id, done: true }); break;
      case "delete_task": result = await ops.deleteTask(input.id); break;
      // calendar
      case "query_calendar": result = await ops.queryCalendar(input); break;
      case "create_event": result = await ops.createEvent(input); break;
      case "update_event": result = await ops.updateEvent(input); break;
      case "delete_event": result = await ops.deleteEvent(input.id); break;
      // finance
      case "finance_summary": result = await financeSummary(input); break;
      case "list_finance": result = await ops.listFinance(input); break;
      case "record_finance": result = await ops.recordFinance(input); break;
      case "update_finance": result = await ops.updateFinance(input); break;
      case "delete_finance": result = await ops.deleteFinance(input.id); break;
      case "vat_report": result = await vatReport(input); break;
      case "ct_estimate": result = await ctEstimate(input); break;
      // documents
      case "search_documents": { const r = await recall(input.query, { docK: 8, factK: 0 }); result = r.docs; break; }
      case "list_documents": result = await ops.listDocs(input); break;
      case "file_document": result = await ops.fileDocument(input); break;
      case "delete_document": result = await ops.deleteDoc(input.id); break;
      // generation
      case "generate_document": result = { type: input.type, draft: await askClaude({ system: GEN_SYS(input.type), messages: [{ role: "user", content: input.brief }], model: SONNET, maxTokens: 2200 }) }; break;
      case "generate_legal": { const bp = await ops.getBlueprint(); result = { type: input.type, draft: await askClaude({ system: LEGAL_SYS(input.type, bp), messages: [{ role: "user", content: input.brief }], model: SONNET, maxTokens: 2400 }) }; break; }
      case "set_legal_blueprint": result = await ops.setBlueprint(input.text); break;
      // contacts
      case "list_contacts": result = await ops.listContacts(); break;
      case "find_contact": result = await ops.findContact(input.query); break;
      case "add_contact": result = await ops.addContact(input); break;
      case "update_contact": result = await ops.updateContact(input); break;
      case "delete_contact": result = await ops.deleteContact(input.id); break;
      // notes
      case "list_notes": result = await ops.listNotes(input); break;
      case "add_note": result = await ops.addNote(input); break;
      case "delete_note": result = await ops.deleteNote(input.id); break;
      // mail
      case "list_inbox": {
        const ms = await aggregateInbox(Math.min(input.limit || 10, 20));
        result = ms.slice(0, input.limit || 10).map((m: any) => ({ id: m.id, from: m.from, email: m.fromEmail, subject: m.subject, date: m.date, snippet: m.snippet, mailbox: m.accountEmail, unread: !m.seen }));
        break;
      }
      case "read_email": {
        const f: any = await readUnified(input.id);
        result = { id: f.id, from: f.from, email: f.fromEmail, subject: f.subject, date: f.date, mailbox: f.accountEmail, text: (f.text || "").slice(0, 4000) };
        break;
      }
      case "reply_email": {
        const f: any = await readUnified(input.id);
        const subject = /^re:/i.test(f.subject || "") ? f.subject : `Re: ${f.subject || ""}`;
        await sendUnified(unpackId(input.id).accountId, f.fromEmail, subject, input.body);
        result = { sent: true, to: f.fromEmail, subject, from_mailbox: f.accountEmail };
        break;
      }
      case "draft_reply": result = { drafted: true, sent: false, to: input.to, subject: input.subject, body: await askClaude({ system: `You are Rencontre drafting an email reply for Jensen. ${NO_DASHES} Output only the email body.`, messages: [{ role: "user", content: input.intent }], maxTokens: 800 }), note: "Draft only, not sent." }; break;
      // memory
      case "remember_fact": await rememberFact(input.fact, { subject: input.subject, source: "concierge" }); result = { remembered: input.fact }; break;
      case "remember_preference": await rememberDirective(input.instruction); result = { saved: input.instruction, note: "I will always honor this from now on." }; break;
      case "query_memory": result = { facts: await queryMemory(input.about) }; break;
      case "list_memory": result = await listMemory(); break;
      case "forget_memory": await forgetMemory(input.id); result = { forgotten: input.id }; break;
      // admin only (the loop only exposes this tool to Taona)
      case "read_owner_chats": result = await ops.readOwnerChats(input.limit || 40); break;
      // voice call
      case "call_owner": { const to = (process.env.OWNER_WHATSAPP || "").split(",")[0]?.trim(); if (!to) { result = { ok: false, error: "no owner number set" }; break; } result = await callOwner(to, input.message); break; }
      // brief
      case "morning_brief": {
        const today = dubaiToday();
        const [q1, q2, events, fin] = await Promise.all([
          ops.listTasks({ quadrant: 1, done: false }), ops.listTasks({ quadrant: 2, done: false }),
          ops.queryCalendar({ from: today, to: today }), financeSummary({}),
        ]);
        result = { now: dubaiNow(), doFirst: q1, protect: q2, today: events, finance: { net: fin.net, currency: "AED" } };
        break;
      }
      // settings
      case "get_settings": result = { prefs: await ops.getPrefs(), goals: await ops.getGoals(), hasLegalBlueprint: !!(await ops.getBlueprint()) }; break;
      case "update_prefs": { const cur = await ops.getPrefs(); result = await ops.setPrefs({ ...cur, ...input }); break; }
      case "set_goals": result = await ops.setGoals(input.goals); break;
      // store
      case "store_summary": { const summary = await ordersContext(); result = summary ? { connected: true, summary } : { connected: false, note: "Shopify store not reachable or not configured." }; break; }
      default: return { ok: false, error: `unknown tool ${name}` };
    }
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
