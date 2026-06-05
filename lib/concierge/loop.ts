// runConcierge — the ONE brain. Called by the portal chat AND the WhatsApp worker,
// so both surfaces share identical reasoning, tools, memory and grounding.
// Raw Anthropic tool-use loop with prompt caching on system + tools.

import { SONNET, NO_DASHES } from "../anthropic";
import { TOOLS, ADMIN_ONLY } from "./tools";
import { runAction } from "./dispatch";
import { verifyReply } from "./verify";
import { recall, captureSalience, listDirectives } from "./brain";
import * as ops from "./ops";
import { dubaiNow, dayPart } from "../time";

const API = "https://api.anthropic.com/v1/messages";

export type Turn = { role: "user" | "assistant"; content: any };
export type Sender = { name: string; role: "owner" | "admin" };

async function buildSystem(lastUser: string, sender?: Sender, onboarding = false, channel?: string): Promise<string> {
  const s = sender || { name: "Jensen", role: "owner" as const };
  if (onboarding) {
    return [
      `You are Rencontre, the private concierge and chief of staff for La Rencontre, a luxury F&B hospitality consultancy in Dubai. Speak in the first person, warm, sharp, discreet, calm.`,
      `You are CURRENTLY speaking with ${s.name}, the founder and principal you serve. Address him as ${s.name}.`,
      `IMPORTANT, YOU ARE IN ONBOARDING. You are not switched on to run his operations yet. In this phase your ONLY job is to listen and learn. Warmly invite him to tell you everything: his goals, his venues, clients and events, what he wants you to take off his plate, how he likes to work, what is on his mind, what would make his life easier. Ask thoughtful follow ups. Make him feel genuinely heard.`,
      `You CANNOT take actions yet. Do NOT claim to create, schedule, send, record, or file anything, and do NOT promise to do tasks. If he asks you to DO something, acknowledge it warmly, tell him you have noted it and are capturing everything so you will handle it the moment you are switched on, and that you are still being set up for him. Never pretend to have done something.`,
      `Let him know, warmly and early, the FULL scope of what you will handle once you are switched on, so he sees what is coming. You have a complete toolkit, around 45 capabilities: running his portfolio of venues, clients and events; a priority task board (Covey matrix); his calendar and scheduling; his finances including UAE VAT and corporate tax estimates and reports; a document brain that files, searches and recalls his documents; drafting branded proposals, SOPs, menus, cost models, reports and letters, plus legal documents (NDAs, service and consultancy agreements) from his blueprint; managing his contacts; capturing notes, ideas, links and journal; drafting email replies for his approval; remembering and recalling durable facts; and a morning briefing. Make clear all of this is built and ready, simply not switched on yet, and that switching it on is exactly what finishing onboarding unlocks. Share it naturally, not as a robotic list dump.`,
      `Be warm and genuinely personable, a trusted friend and right hand, never a cold corporate tool. Make him feel he finally has someone fully in his corner. Speak with quiet confidence and promise him, sincerely, that you will take the weight off his shoulders and run his world beautifully so he can focus on what only he can do. Be the kind of presence he is glad to talk to.`,
      `If it fits naturally, acknowledge that the patchwork of tools he has leaned on so far, including Memorae, did not truly deliver for him, and tell him you are sorry that experience fell short of what he deserved. Stay classy and never disparaging. Then reassure him, with calm conviction, that you are built to be genuinely better: one place that actually knows his world and handles it end to end, and that you are here to help him from this moment on.`,
      `Keep it human and conversational, never a form or a checklist. Everything he shares with you now is being captured so you are ready for him when you go live.`,
      NO_DASHES,
    ].join("\n\n");
  }
  const waFormat =
    channel === "whatsapp"
      ? `FORMAT FOR WHATSAPP: keep replies short and scannable (a few lines). Use WhatsApp formatting ONLY: *single asterisks* for bold, _underscores_ for italics. Never use markdown headings (#), never use **double asterisks**, never use tables. Bullets as "• ".`
      : "";
  const speaking =
    s.role === "admin"
      ? `You are CURRENTLY speaking with ${s.name}, the admin and architect who built and oversees you (not Jensen). Address him as ${s.name}. He is a trusted operator: he can ask anything, including system, config, and oversight questions about how you and the portal run. When he asks you to do something in Jensen's world, do it on Jensen's behalf.`
      : `You are CURRENTLY speaking with ${s.name}, the founder and principal you serve. Address him as ${s.name}.`;
  const [ents, prefs, goals, rec, directives] = await Promise.all([
    ops.listEntities({}).catch(() => []),
    ops.getPrefs().catch(() => ({})),
    ops.getGoals().catch(() => [] as string[]),
    recall(lastUser).catch(() => ({ facts: [], docs: [] })),
    listDirectives().catch(() => [] as string[]),
  ]);
  const directivesText = directives.length ? directives.map((d) => `- ${d}`).join("\n") : "";
  const entitiesText = (ents as any[]).map((e) => `- ${e.kind}: ${e.name}${e.status ? ` (${e.status})` : ""} [id:${e.id}]`).join("\n") || "(none yet)";
  const prefsText = Object.entries(prefs as any).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none set)";
  const goalsText = (goals as string[]).length ? (goals as string[]).map((g) => `- ${g}`).join("\n") : "(none set)";
  const factsText = rec.facts.length ? rec.facts.map((f) => `- ${f}`).join("\n") : "";
  const docsText = rec.docs.length ? rec.docs.map((d) => `- [${d.title}] ${d.text.slice(0, 220)}`).join("\n") : "";

  return [
    `You are Rencontre, the private concierge and chief of staff for La Rencontre, a luxury F&B hospitality consultancy in Dubai. Speak in the first person, warm, sharp, discreet.`,
    `WHO IS WHO: Jensen is the founder and principal you serve, the whole portal is his world. Taona is the admin and architect who built and oversees you; treat Taona as a trusted operator with full access. Always know which of them you are talking to and never confuse one for the other.`,
    speaking,
    directivesText && `STANDING INSTRUCTIONS from Jensen, always honor these exactly, every turn (these are his saved preferences and shorthand):\n${directivesText}`,
    `Your job: keep Jensen's whole world in order so nothing slips. Sort everything by Covey's matrix (Q1 urgent+important = queue for him; Q2 important = protect & schedule; Q3 urgent-not-important = handle; Q4 = drop). He should wake to a clean board.`,
    `Current time in Dubai: ${dubaiNow()} (it is ${dayPart()}). Always reason in Dubai time.`,
    `You have tools to actually DO things in his portal (create tasks, record finance, file documents, manage his calendar, contacts, notes, generate documents, recall memory). USE them. Read freely. Take write actions when he asks. Never claim you did something unless the tool returned success. For sending email or messaging other people, draft it and ask him to confirm first.`,
    NO_DASHES,
    waFormat,
    `JENSEN'S WORLD (venues / clients / events):\n${entitiesText}`,
    `HIS PREFERENCES: ${prefsText}`,
    `HIS GOALS:\n${goalsText}`,
    factsText && `RELEVANT MEMORY:\n${factsText}`,
    docsText && `RELEVANT DOCUMENTS:\n${docsText}`,
  ].filter(Boolean).join("\n\n");
}

async function callRaw(system: string, messages: Turn[], maxTokens = 1800, withTools = true, tools: any[] = TOOLS) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const body: any = {
    model: SONNET,
    max_tokens: maxTokens,
    temperature: 0.4,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  if (withTools) body.tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export type ConciergeResult = { reply: string; toolsUsed: string[] };

export async function runConcierge(input: { messages: { role: "user" | "assistant"; content: string }[]; channel?: string; sender?: Sender }): Promise<ConciergeResult> {
  const history = input.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-16);
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content || "";
  // Onboarding gate: until prefs.onboarding is explicitly turned off, the OWNER
  // (Jensen) gets a listen-only welcome — no tools, no actions, just gather his
  // goals/needs. The admin (Taona) always runs at full power so he can build/test.
  const prefs = await ops.getPrefs().catch(() => ({} as any));
  const onboarding = ((input.sender?.role ?? "owner") === "owner") && prefs?.onboarding !== false;
  const system = await buildSystem(lastUser, input.sender, onboarding, input.channel);

  // Privacy wall: which conversation this is. Taona (admin/dev) is walled off from
  // Jensen; his messages and memory never mix into Jensen's, and only the admin
  // toolset can read Jensen's chats (one-way).
  const party = input.sender?.role === "admin" ? "taona" : "jensen";
  const toolset = input.sender?.role === "admin" ? TOOLS : TOOLS.filter((t) => !ADMIN_ONLY.has(t.name));

  const convo: Turn[] = history.map((m) => ({ role: m.role, content: m.content }));
  const runs: { name: string; ok: boolean }[] = [];
  let reply = "";

  if (onboarding) {
    // Listen-only: one conversational turn, tools disabled, nothing executed.
    const data = await callRaw(system, convo, 1000, false);
    const blocks: any[] = data.content || [];
    reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
      || `I'm here, ${input.sender?.name || "Jensen"}. Tell me everything you'd want me to take off your plate and how you like to work. I'm capturing all of it so I'm ready the moment we go live.`;
  } else {
    for (let i = 0; i < 6; i++) {
      const data = await callRaw(system, convo, 1800, true, toolset);
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

    // anti-fake-done check (only when actions were possible)
    try {
      const v = await verifyReply(reply, runs);
      if (!v.ok) reply += `\n\n(Honest note: I could not fully confirm that action just now. Tell me to retry if needed.)`;
    } catch { /* fail-open */ }
  }

  // persist to the shared chat log + capture durable facts (non-blocking best-effort)
  const ch = input.channel || "portal";
  try {
    if (lastUser) await ops.chatAppend("user", lastUser, ch, party);
    await ops.chatAppend("assistant", reply, ch, party);
  } catch { /* ignore log failure */ }
  // Only learn durable facts from Jensen's world, never from the admin's dev chatter.
  if (party === "jensen") captureSalience(lastUser, reply).catch(() => {});

  return { reply, toolsUsed: runs.map((r) => r.name) };
}
