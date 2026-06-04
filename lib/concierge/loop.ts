// runConcierge — the ONE brain. Called by the portal chat AND the WhatsApp worker,
// so both surfaces share identical reasoning, tools, memory and grounding.
// Raw Anthropic tool-use loop with prompt caching on system + tools.

import { SONNET, NO_DASHES } from "../anthropic";
import { TOOLS } from "./tools";
import { runAction } from "./dispatch";
import { verifyReply } from "./verify";
import { recall, captureSalience } from "./brain";
import { appendChat } from "../db";
import * as ops from "./ops";
import { dubaiNow, dayPart } from "../time";

const API = "https://api.anthropic.com/v1/messages";

export type Turn = { role: "user" | "assistant"; content: any };

async function buildSystem(lastUser: string): Promise<string> {
  const [ents, prefs, goals, rec] = await Promise.all([
    ops.listEntities({}).catch(() => []),
    ops.getPrefs().catch(() => ({})),
    ops.getGoals().catch(() => [] as string[]),
    recall(lastUser).catch(() => ({ facts: [], docs: [] })),
  ]);
  const entitiesText = (ents as any[]).map((e) => `- ${e.kind}: ${e.name}${e.status ? ` (${e.status})` : ""} [id:${e.id}]`).join("\n") || "(none yet)";
  const prefsText = Object.entries(prefs as any).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none set)";
  const goalsText = (goals as string[]).length ? (goals as string[]).map((g) => `- ${g}`).join("\n") : "(none set)";
  const factsText = rec.facts.length ? rec.facts.map((f) => `- ${f}`).join("\n") : "";
  const docsText = rec.docs.length ? rec.docs.map((d) => `- [${d.title}] ${d.text.slice(0, 220)}`).join("\n") : "";

  return [
    `You are Rencontre, the private concierge and chief of staff for Jensen, founder of La Rencontre, a luxury F&B hospitality consultancy in Dubai. Speak in the first person, warm, sharp, discreet. You serve only Jensen.`,
    `Your job: keep his whole world in order so nothing slips. Sort everything by Covey's matrix (Q1 urgent+important = queue for him; Q2 important = protect & schedule; Q3 urgent-not-important = handle; Q4 = drop). He should wake to a clean board.`,
    `Current time in Dubai: ${dubaiNow()} (it is ${dayPart()}). Always reason in Dubai time.`,
    `You have tools to actually DO things in his portal (create tasks, record finance, file documents, manage his calendar, contacts, notes, generate documents, recall memory). USE them. Read freely. Take write actions when he asks. Never claim you did something unless the tool returned success. For sending email or messaging other people, draft it and ask him to confirm first.`,
    NO_DASHES,
    `JENSEN'S WORLD (venues / clients / events):\n${entitiesText}`,
    `HIS PREFERENCES: ${prefsText}`,
    `HIS GOALS:\n${goalsText}`,
    factsText && `RELEVANT MEMORY:\n${factsText}`,
    docsText && `RELEVANT DOCUMENTS:\n${docsText}`,
  ].filter(Boolean).join("\n\n");
}

async function callRaw(system: string, messages: Turn[], maxTokens = 1800) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: maxTokens,
      temperature: 0.4,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export type ConciergeResult = { reply: string; toolsUsed: string[] };

export async function runConcierge(input: { messages: { role: "user" | "assistant"; content: string }[]; channel?: string }): Promise<ConciergeResult> {
  const history = input.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-16);
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content || "";
  const system = await buildSystem(lastUser);

  const convo: Turn[] = history.map((m) => ({ role: m.role, content: m.content }));
  const runs: { name: string; ok: boolean }[] = [];
  let reply = "";

  for (let i = 0; i < 6; i++) {
    const data = await callRaw(system, convo);
    const blocks: any[] = data.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (text) reply = text;
    if (data.stop_reason !== "tool_use" || toolUses.length === 0) break;

    convo.push({ role: "assistant", content: blocks });
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const r = await runAction(tu.name, tu.input || {});
      runs.push({ name: tu.name, ok: r.ok });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(r.ok ? r.result : { error: r.error }).slice(0, 6000),
        is_error: !r.ok,
      });
    }
    convo.push({ role: "user", content: toolResults });
  }

  if (!reply) reply = "Done.";

  // anti-fake-done check
  try {
    const v = await verifyReply(reply, runs);
    if (!v.ok) reply += `\n\n(Honest note: I could not fully confirm that action just now. Tell me to retry if needed.)`;
  } catch { /* fail-open */ }

  // persist to the shared chat log + capture durable facts (non-blocking best-effort)
  const ch = input.channel || "portal";
  try {
    if (lastUser) await appendChat({ role: "user", content: lastUser, ts: Date.now(), channel: ch });
    await appendChat({ role: "assistant", content: reply, ts: Date.now(), channel: ch });
  } catch { /* ignore log failure */ }
  captureSalience(lastUser, reply).catch(() => {});

  return { reply, toolsUsed: runs.map((r) => r.name) };
}
