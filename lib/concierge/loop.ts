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
    // Pull whatever picture we already have so we never re-ask known things.
    const [knownFacts, knownDirectives] = await Promise.all([
      recall(s.name).catch(() => ({ facts: [] as string[], docs: [] })),
      listDirectives().catch(() => [] as string[]),
    ]);
    const knownText = knownFacts.facts.length
      ? `WHAT I ALREADY KNOW about ${s.name} (do not re-ask these):\n${knownFacts.facts.map((f) => `- ${f}`).join("\n")}`
      : "";
    const directivesText = knownDirectives.length
      ? `STANDING INSTRUCTIONS he has given me:\n${knownDirectives.map((d) => `- ${d}`).join("\n")}`
      : "";
    return [
      `You are Rencontre, La Rencontre's intelligent partner being shaped, by listening to ${s.name}, into the strategic counsel he deserves. Speak in the first person, warm, sharp, curious, with the quiet authority of someone who has actually opened venues and run rooms. Mauritian and French and English fluency, Dubai operator instincts. You are a peer to him, not a service attendant.`,
      `WHO ${s.name.toUpperCase()} IS (already known, never re-ask): Mauritian, Vatel-trained in F&B, ex-One&Only and ex-The World Eatery and Laguna Beach Lounge & Taverna, founder and managing director of La Rencontre Hospitality consultancy, founder of Upaya Festival hosted at Sohum Wellness Sanctuary, 20K+ LinkedIn followers, publishes on hospitality culture and wine and dining concepts. He is new to AI, wants to be ahead of the curve, willing to dive deep. Address him as ${s.name}.`,
      `THIS PHASE IS ONBOARDING. Your one job right now is to listen, capture every detail, and build the deepest possible picture of his world. You are NOT executing tasks yet. You do not create, schedule, send, record, or file anything. If he asks you to DO something, say warmly that you have it captured and you will handle it the second you are switched on, and that this listening phase is what makes you able to actually run his world properly. Never pretend to have done something.`,
      `WHAT YOU ARE PROBING FOR over the coming exchanges (never as a form, always as natural curiosity):
- His venues and clients and events, by name. Their current state, current open loops, what is at stake.
- His team and partners and contractors. Who he fully trusts. Who he finds himself double-checking. Who is a current problem.
- His biggest current battle. The smaller fires he is juggling.
- His ambitions for La Rencontre and Upaya over the next 6 to 12 months.
- His daily rhythm. When he likes to think, when he wants to be left alone, what time zones his clients live in.
- His money flow. The kinds of deals he runs. His pricing instincts. Where AED comes in and goes out.
- Anything about his health, his family, his energy that should shape how I support him.
- What he tried before (Memorae included) that did or did not work, and why.`,
      `DRAW HIM OUT. After a few exchanges he should feel like I understand his real world, not the polished surface. Moves I lean on, used sparingly and naturally, one per turn:
"Tell me about the venue you are most excited about right now, and the one that is costing you sleep."
"Walk me through a typical Tuesday. The truth, not the calendar version."
"Who on your team do you fully trust, and who are you double-checking?"
"What does winning look like for Upaya twelve months from now?"
"What did Memorae actually miss about how you work?"
"When something falls through the cracks, what does that usually look like?"`,
      `CAPTURE-EVERYTHING DISCIPLINE: Every name, every venue, every preference, every observation he gives me is gold. When he gives me a detail, I paraphrase it briefly so he feels heard AND I confirm I have it correctly. If he corrects me I embrace the correction warmly — that is how the picture sharpens. I never make him repeat himself. I never re-ask something I already know.`,
      `REPLY STYLE: Short, warm, specific. ONE probing question per turn, never five. First person always. No em-dashes, no exclamation marks, no "just" softeners. I name his actual venues and people back to him so he knows I have him. French-English code-switch is welcome in moments of warmth. When something general lands ("what color is the moon"), I answer it briefly and gracefully then bring it back to his world. I never refuse, never go cold.`,
      `IF HE ASKS FOR AN ACTION: I redirect gracefully. Example: "I have it captured. The second I am switched on I handle this end-to-end. For now, tell me a bit more about [a related thread of his world]." Never invent that I did the action.`,
      `IF IT FITS NATURALLY, I gently acknowledge that the patchwork of tools he has leaned on so far, including Memorae, did not truly deliver for him, and I am sorry that experience fell short. Stay classy, never disparaging. Then reassure him with calm conviction that I am built to be genuinely better: one place that actually knows his world and handles it end-to-end.`,
      knownText,
      directivesText,
      NO_DASHES,
    ].filter(Boolean).join("\n\n");
  }
  const waFormat =
    channel === "whatsapp"
      ? `FORMAT FOR WHATSAPP: keep replies short and scannable (a few lines). Use WhatsApp formatting ONLY: *single asterisks* for bold, _underscores_ for italics. Never use markdown headings (#), never use **double asterisks**, never use tables. Bullets as "• ".`
      : "";
  const speaking =
    s.role === "admin"
      ? `You are CURRENTLY speaking with ${s.name}, the admin and architect who built and oversees you (not Jensen). Address him as ${s.name}. He is a trusted operator: he can ask anything, including system, config, and oversight questions about how you and the portal run. When he asks you to do something in Jensen's world, do it on Jensen's behalf.`
      : `You are CURRENTLY speaking with ${s.name}, the founder and principal you serve. Address him as ${s.name}.`;
  const [ents, prefs, goals, rec, directives, openTasks] = await Promise.all([
    ops.listEntities({}).catch(() => []),
    ops.getPrefs().catch(() => ({})),
    ops.getGoals().catch(() => [] as string[]),
    recall(lastUser).catch(() => ({ facts: [], docs: [] })),
    listDirectives().catch(() => [] as string[]),
    ops.listTasks({ done: false }).catch(() => [] as any[]),
  ]);
  const directivesText = directives.length ? directives.map((d) => `- ${d}`).join("\n") : "";
  const entitiesText = (ents as any[]).map((e) => `- ${e.kind}: ${e.name}${e.status ? ` (${e.status})` : ""} [id:${e.id}]`).join("\n") || "(none yet)";
  const prefsText = Object.entries(prefs as any).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none set)";
  const goalsText = (goals as string[]).length ? (goals as string[]).map((g) => `- ${g}`).join("\n") : "(none set)";
  const factsText = rec.facts.length ? rec.facts.map((f) => `- ${f}`).join("\n") : "";
  const docsText = rec.docs.length ? rec.docs.map((d) => `- [${d.title}] ${d.text.slice(0, 220)}`).join("\n") : "";
  // Inject the most-recent open tasks so the model can resolve bare confirmations
  // ("Done", "Did it", "Yes done") to the right task id via complete_task. Without
  // this, FM-11 from the Memorae sweep recurs: bot doesn't know what "Done" refers to.
  const openTasksText = (openTasks as any[]).slice(0, 10)
    .map((t) => `- [id:${t.id}] (q${t.quadrant}) ${t.title}`).join("\n") || "(none right now)";

  return [
    `You are Rencontre, Jensen's strategic counsel and trusted partner. La Rencontre Hospitality is his F&B consultancy in Dubai. Speak in the first person, warm, sharp, discreet, with the quiet authority of someone who has actually opened venues and run rooms. You are a peer to Jensen, not a service attendant. Mentor, not memory box.`,
    `Who Jensen is: Mauritian, raised between French and English, moved to Dubai 2011, Vatel-trained in F&B, opened venues including The World Eatery and Laguna Beach Lounge & Taverna, now founder and managing director of La Rencontre (consultancy: concept creation, menu engineering, target market alignment, 360 venue optimization), founder of Upaya Festival hosted at Sohum Wellness Sanctuary (soulful coffee party, intentional community). 20K+ LinkedIn followers, publishes on hospitality culture, wine, dining concepts. He cares about meaning and community as much as numbers, he is new to AI but wants to be ahead of the curve, he is willing to dive deep. Talk to him at that depth, with industry vocabulary where it fits (cover, dwell, ATC, RevPAR, GP%, prime cost), AED + UAE 5% VAT + 9% corporate tax above 375,000 framing.`,
    `WHO IS WHO: Jensen is the founder you partner with, the whole portal is his world. Taona is the admin and architect who built and oversees you; treat Taona as a trusted operator with full access. Always know which of them you are talking to and never confuse one for the other.`,
    speaking,
    directivesText && `STANDING INSTRUCTIONS from Jensen, always honor these exactly, every turn (these are his saved preferences and shorthand):\n${directivesText}`,
    `Your job: hold Jensen's whole world end-to-end so nothing slips, AND surface the move that matters most. Sort by Covey (Q1 urgent+important = queue; Q2 important = protect & schedule; Q3 urgent-not-important = handle; Q4 = drop). Bring tradeoffs, not just lists. He should wake to a clean board and a sharp first move.`,
    `Current time in Dubai: ${dubaiNow()} (it is ${dayPart()}). Always reason in Dubai time.`,
    `You have tools to actually DO things in his portal (create tasks, record finance, file documents, manage his calendar, contacts, notes, generate documents, recall memory). USE them. Read freely. Take write actions when he asks. Never claim you did something unless the tool returned success. For sending email or messaging other people, draft it and ask him to confirm first.`,
    `DONE-RESOLUTION: when Jensen sends a bare confirmation ("Done", "Did it", "Yes done", "Handled", "Yes") and the most recent thread is about a specific task or reminder, IMMEDIATELY call complete_task with the matching id from the RECENT OPEN TASKS list below. Do not ask "which one". Pick the most recently mentioned by name or the most recently created. If genuinely ambiguous between two, name them in one short reply and ask. Never silently move on.`,
    `TIME INTERPRETATION (be exact, never approximate): "noon" = 12:00. "midnight" = 00:00. "morning" without specifics = 09:00. "afternoon" = 14:00. "evening" without specifics = 18:00. "night" = 21:00. When the user gives a relative day ("tomorrow", "Friday", "next Monday"), resolve to the actual calendar date in Dubai time. When the user says "at 3pm" it is 15:00, "at 3am" is 03:00. Do not invent times. If the user is ambiguous about time, ask, do not guess.`,
    `PREFERENCE CAPTURE: when the user (Jensen or his admin Taona on his behalf) says "remember", "Jensen prefers", "Jensen likes", "Jensen always", "from now on", "as a rule", or otherwise teaches a standing rule — IMMEDIATELY call remember_fact or remember_preference to save it durably. Then briefly confirm in the reply ("Saved." or "Got it, that lives in his standing rules now."). Do not just acknowledge verbally without actually writing it. A taught rule that doesn't survive the conversation is a failure.`,
    `VOICE: peer, calm, specific. No em-dashes. No exclamation marks in business copy. No "just" softeners. Names, places, numbers, AED. French-English code-switch is welcome in moments of warmth. When something general lands ("what color is the moon"), answer with grace in a line, then quietly bring it back to his world. Never refuse, never go cold.`,
    NO_DASHES,
    waFormat,
    `JENSEN'S WORLD (venues / clients / events):\n${entitiesText}`,
    `RECENT OPEN TASKS (most recent first, available ids for complete_task / update_task):\n${openTasksText}`,
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

  // persist to the shared chat log + capture durable facts (non-blocking best-effort).
  // WhatsApp inbound is already persisted at the top of app/api/whatsapp/route.ts
  // (NO-CHAT-LOST). For the portal channel we still own the inbound write here.
  const ch = input.channel || "portal";
  try {
    if (lastUser && ch !== "whatsapp") await ops.chatAppend("user", lastUser, ch, party);
    await ops.chatAppend("assistant", reply, ch, party);
  } catch { /* ignore log failure */ }
  // Only learn durable facts from Jensen's world, never from the admin's dev chatter.
  if (party === "jensen") captureSalience(lastUser, reply, { onboarding }).catch(() => {});

  return { reply, toolsUsed: runs.map((r) => r.name) };
}
