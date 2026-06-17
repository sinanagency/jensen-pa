import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendWhatsApp, isOwner, whoIs, mirrorInbound } from "@/lib/whatsapp";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { runConcierge } from "@/lib/concierge/loop";
import { kvGet, kvSet, admin } from "@/lib/db";
import * as ops from "@/lib/concierge/ops";
import { classifyAndFile } from "@/lib/concierge/intake";
import { readImage } from "@/lib/anthropic";
import { extractTextFromBuffer } from "@/lib/extract-text";
import { embed, chunk } from "@/lib/openai";
import { transcribeAudio } from "@/lib/transcribe";
import { sbSelect, enc } from "@/lib/concierge/rest";
import { extractMeetingLink, dispatchMeetingBot, isCancelIntent, cancelActiveBot } from "@/lib/digital-u";
import { shouldProcess, mediaArrived } from "@/lib/brain-core/index.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Meta webhook verification handshake.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Best-effort dedupe so Meta retries don't double-process a message.
// v0.2 (2026-06-12): race proof. The old kv array (read, includes, write back)
// lost ids when two Meta retries landed concurrently: both read the same
// array, both missed, both processed, one write clobbered the other. Now the
// truth is a wa_seen table with wamid as PRIMARY KEY: the insert IS the check,
// atomically, in one round trip. A unique violation means a sibling owns it.
// Falls back to the old kv path only if the table does not exist yet (apply
// db/2026-06-12_wa_seen.sql), so this ships safely ahead of the migration.
async function seen(id: string): Promise<boolean> {
  try {
    const { error } = await admin().from("wa_seen").insert({ wamid: id });
    if (!error) return false;                                  // we own it: process
    const msg = String(error.message || "");
    if (/duplicate key|unique/i.test(msg) || (error as any).code === "23505") return true; // sibling owns it
    if (!/does not exist|relation .*wa_seen/i.test(msg) && (error as any).code !== "42P01") {
      // Unknown DB failure: fail open (process) rather than drop a message.
      return false;
    }
  } catch {
    // network blip: fall through to kv
  }
  try {
    const arr = await kvGet<string[]>("wa_seen", []);
    if (arr.includes(id)) return true;
    await kvSet("wa_seen", [...arr.slice(-199), id]);
    return false;
  } catch {
    return false;
  }
}

// Meta webhook signature (Architecture 2, 2026-06-12). Jensen was the only
// bot in the fleet accepting UNSIGNED POSTs: anyone who learned the URL could
// forge an inbound and drive a concierge that holds mail, calendar, and
// finance write tools. Mirrors Sasa's pattern: constant-time compare, and the
// gate only arms once WHATSAPP_APP_SECRET is set (early-setup escape hatch).
function verifyMetaSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function downloadMedia(mediaId: string): Promise<{ buf: Buffer; mime: string; base64: string } | null> {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const meta = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    if (!meta?.url) return null;
    const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await bin.arrayBuffer());
    return { buf, mime: meta.mime_type || "application/octet-stream", base64: buf.toString("base64") };
  } catch {
    return null;
  }
}

async function recentHistory(party: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    return await ops.chatRecent(party, 12);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
      return new NextResponse("bad signature", { status: 401 });
    }
    const body = JSON.parse(raw || "{}");
    // WABA payload diagnostic. Empirically Meta's webhook entry[0].id on THIS
    // account surfaces the system-user id, not the WABA id, so a fully-auto
    // template submission path is not possible from the webhook. We still
    // stash the most recent webhook payload (heavily truncated) and the seen
    // entry[0].id in kv so the operator has something to inspect when looking
    // up the real WABA_ID in Meta's dashboard.
    try { await captureWebhookDiagnostic(body); } catch {}

    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from: string = msg?.from || "";
    if (!from || !msg?.id) return NextResponse.json({ ok: true });
    if (await seen(msg.id)) return NextResponse.json({ ok: true });

    // Brain-core webhook guard: concurrent dedup (2s lock per sender) + media-
    // pending buffer (wait for image webhook when text says "this"/"here").
    const textBody = (msg.text?.body || "").trim();
    const guard = await shouldProcess("jensen", from, msg.id, textBody, {
      seenByWamid: async (id: string) => { const s = await seen(id); return s; },
      logToChat: async (sender: string, t: string) => {
        const party = whoIs(sender)?.role === "admin" ? "taona" : "jensen";
        await ops.chatAppend("user", t, "whatsapp", party).catch(() => {});
      },
    });
    if (guard.action !== "process") return NextResponse.json({ ok: true });

    // MAINTENANCE GATE. While JENSEN_MODE=TRAINING:
    //   - allowlisted senders (Taona + Jensen, per ALLOWLIST env) pass through
    //     normally. Jensen lands in onboarding-listener mode inside runConcierge
    //     (withTools=false, captureSalience writes brain_facts) so the bot reads
    //     him, responds warmly, remembers — but does NOT log anything to the
    //     actionable portal (no tasks, events, finance rows).
    //   - random non-allowlisted senders: silent drop. No "private line" notice
    //     leaks during the training window. Per Taona directive 2026-06-09:
    //     no training/upgrade notice may reach Jensen; the listener experience
    //     IS the answer, with the onboarding system prompt reassuring him
    //     "by tomorrow we are live."
    if (process.env.JENSEN_MODE === "TRAINING") {
      const allow = (process.env.MAINTENANCE_ALLOWLIST || "")
        .split(",")
        .map((s) => s.replace(/[^0-9]/g, ""))
        .filter(Boolean);
      const fromDigits = from.replace(/[^0-9]/g, "");
      if (!allow.includes(fromDigits)) {
        return NextResponse.json({ ok: true });
      }
    }

    // owner gate: Jensen (and Taona) drive the concierge; anyone else is gently
    // redirected to Jensen's direct WhatsApp. Don't leak that this is a bot.
    if (!isOwner(from)) {
      await sendWhatsApp(
        from,
        "Thank you for reaching out. This line is private to Jensen. To reach him directly, please message https://wa.me/971528902032.",
      );
      return NextResponse.json({ ok: true });
    }

    const sender = whoIs(from);
    // OPERATOR MIRROR (silent, never shown to the sender). Forward Jensen's inbound
    // to Taona's number so he can live-tail conversations. Operator's own messages
    // are not mirrored (the helper handles the loop guard). Media is summarised.
    if (sender.role !== "admin") {
      const inboundSummary =
        msg.text?.body ||
        (msg.voice ? "[voice note]" :
         msg.audio ? "[audio]" :
         msg.image ? `[image]${msg.image.caption ? ": " + msg.image.caption : ""}` :
         msg.document ? `[document: ${msg.document.filename || "file"}]` :
         "[message]");
      mirrorInbound(inboundSummary, from).catch(() => {});
    }
    const history = await recentHistory(sender.role === "admin" ? "taona" : "jensen");
    // Voice notes arrive as msg.voice (push-to-talk) or msg.audio (uploaded audio).
    // Treat both: transcribe and flow into the concierge as text.
    const audio = msg.voice || msg.audio || (msg.document?.mime_type?.startsWith("audio/") ? msg.document : null);
    const media = msg.image || msg.document || msg.video || null;
    const caption: string = msg.image?.caption || msg.document?.caption || "";

    // ---- audio: download, transcribe via Whisper, hand to concierge as text ----
    if (audio && !media?.mime_type?.startsWith("image/") && !audio.filename?.match(/\.(pdf|docx?|xlsx?|csv|txt)$/i)) {
      const dl = await downloadMedia(audio.id);
      if (!dl) { await sendWhatsApp(from, "I couldn't fetch that voice note. Try again."); return NextResponse.json({ ok: true }); }
      const transcript = await transcribeAudio(dl.buf, dl.mime);
      if (!transcript) { await sendWhatsApp(from, "I got your voice note but couldn't make out the words. Could you re-record or type it?"); return NextResponse.json({ ok: true }); }
      const party = sender.role === "admin" ? "taona" : "jensen";
      // Persist with a [voice note] marker so chat history shows it came as audio.
      await ops.chatAppend("user", `[voice note] ${transcript}`, "whatsapp", party).catch(() => {});
      const { reply } = await runConcierge({ messages: [...history, { role: "user", content: transcript }], channel: "whatsapp", sender });
      await sendWhatsApp(from, reply || "I'm here.");
      return NextResponse.json({ ok: true });
    }

    // ---- media: download, read, file into the portal via the brain ----
    if (media) {
      // Check brain-core for a buffered text message from the same sender.
      const pendingText = mediaArrived(from);
      let combinedCaption = caption;
      if (pendingText) {
        combinedCaption = caption ? `${pendingText}: ${caption}` : pendingText;
      }
      const dl = await downloadMedia(media.id);
      if (!dl) { await sendWhatsApp(from, "I couldn't fetch that file from WhatsApp. Try sending it again."); return NextResponse.json({ ok: true }); }
      let text = "";
      if (dl.mime.startsWith("image/")) text = await readImage(dl.base64, dl.mime);
      else text = (await extractTextFromBuffer(dl.buf, dl.mime, media.filename || "document")) || "";
      if (!text.trim()) { await sendWhatsApp(from, "I saved your file but couldn't read text from it. If it's a photo, a clearer shot helps."); return NextResponse.json({ ok: true }); }

      const id = uid();
      const title = (media.filename || combinedCaption || "WhatsApp upload").replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "WhatsApp upload";
      let chunks: { text: string; embedding: number[] }[] = [];
      try { const parts = chunk(text); const vecs = parts.length ? await embed(parts) : []; chunks = parts.map((t, i) => ({ text: t, embedding: vecs[i] })); } catch { /* no embedder: keyword only */ }
      await ops.addDoc({ id, title, fileName: media.filename || "whatsapp-upload", mime: dl.mime, kind: "document", text, chunks, createdAt: Date.now() });

      // Intake runs out-of-band from the chat brain. During onboarding it
      // READS (chunks, embeds, remembers) but does NOT WRITE (no finance
      // row, no expense logged). Listen-only means listen-only.
      const prefs = await ops.getPrefs().catch(() => ({} as any));
      const ownerOnboarding = sender.role === "owner" && (prefs as any)?.onboarding !== false;
      const filed = await classifyAndFile({ id, title, text }, { onboarding: ownerOnboarding });
      let msg: string;
      if (ownerOnboarding) {
        msg = `Got it. I've read *${title}* and it's in my memory.`;
        if (filed.summary) msg += ` ${filed.summary}`;
        if (filed.pending) {
          msg += ` Looks like an invoice for ${filed.pending.currency || "AED"} ${filed.pending.amount} from ${filed.pending.label}. I'm in listening mode right now so I am not logging it to your books yet; the moment you switch me on I'll file it properly.`;
        } else {
          msg += ` I'll bring it up when it's relevant.`;
        }
      } else {
        msg = `Filed *${title}* under *${filed.folder}*.`;
        if (filed.finance) msg += ` Logged an expense of AED ${filed.finance.amount} (${filed.finance.label}).`;
        msg += ` I've read it, so I can pull it up or send it whenever you need.`;
      }
      const party = sender.role === "admin" ? "taona" : "jensen";
      await ops.chatAppend("user", `[sent a document: ${title}]`, "whatsapp", party).catch(() => {});
      await ops.chatAppend("assistant", msg, "whatsapp", party).catch(() => {});
      await sendWhatsApp(from, msg);
      return NextResponse.json({ ok: true });
    }

    // ---- plain text: full concierge ----
    const text = (msg.text?.body || "").trim();
    if (!text) return NextResponse.json({ ok: true });

    // DETERMINISTIC CANCEL CHOKEPOINT. "stop" / "leave" / "cancel" / "get out"
    // when sent alone (or with the "digital jensen" prefix) kills the active
    // meeting-bot. Whatever was captured before the cancel still flows back
    // to /api/ingest, so Jensen gets partial notes + tasks for what the bot
    // caught. Same pattern as the link-detection below: deterministic verbs
    // deserve deterministic code (KT #127).
    if (isCancelIntent(text)) {
      const inboundParty = sender.role === "admin" ? "taona" : "jensen";
      await ops.chatAppend("user", text, "whatsapp", inboundParty).catch(() => {});
      const r = await cancelActiveBot();
      const ack = r.ok
        ? `Stopping. I am leaving ${r.title || "the meeting"} now. Anything I caught up to this point will land here with the notes and tasks in a moment.`
        : r.error === "no active bot to cancel"
          ? `There is no notetaker in a meeting right now, so nothing to stop. If you meant something else, send it again with a couple more words.`
          : `I tried to stop the notetaker and the service returned: ${r.error}. Try again or check on it directly.`;
      await sendTextAndLog(from, ack, { party: inboundParty, dev: sender.role === "developer" ? true : undefined });
      return NextResponse.json({ ok: true });
    }

    // MEETING-LINK CHOKEPOINT. When the inbound contains a Meet/Zoom/Teams link,
    // we check the INTENT: if the message explicitly asks the bot to join now
    // ("join this", "go now", "attend this meeting", "take notes"), dispatch
    // immediately. Otherwise the link is for a FUTURE meeting: save it to the
    // matching event row and let the brain respond naturally ("I'll join at
    // the meeting time"). This prevents 2026-06-16 pattern where sharing a
    // link for tomorrow's Sotiris meeting triggered an immediate dispatch + 401.
    const meetingLink = extractMeetingLink(text);
    if (meetingLink) {
      const rest = text.replace(meetingLink, "").trim();
      const JOIN_INTENT_RE = /\b(join|go|now|attend|enter|dispatch|start)\b/i;
      const inboundParty = sender.role === "admin" ? "taona" : "jensen";
      const botName = sender.name === "Nur" ? "Digital Nur"
        : sender.role === "admin" ? "Digital Taona"
        : "Digital Jensen";
      await ops.chatAppend("user", text, "whatsapp", inboundParty).catch(() => {});

      if (JOIN_INTENT_RE.test(rest)) {
        // Explicit join intent: dispatch the meeting bot immediately.
        const dispatch = await dispatchMeetingBot({
          link: meetingLink,
          title: rest.replace(JOIN_INTENT_RE, "").trim().slice(0, 120) || "Meeting",
          displayName: botName,
          phone: from,
        });
        const ack = dispatch.ok
          ? (sender.role === "admin"
              ? `On it. I am dispatching the notetaker to ${meetingLink}. I will send the summary here when it finishes.`
              : `On it. I am sending the notetaker to that meeting now. I will message you with the summary and your action items when the room closes.`)
          : `I tried to join that meeting and the service returned: ${dispatch.error}. Let me check on it, or you can ask me to retry.`;
        await sendTextAndLog(from, ack, { party: inboundParty, dev: sender.role === "developer" ? true : undefined });
        return NextResponse.json({ ok: true });
      }

      // Future meeting link: try to attach it to a matching upcoming event.
      // Best-effort: if no event matches, the brain saves the link context.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const events = await sbSelect<any>(
          "events",
          `date=gte.${enc(today)}&time=is.not.null&order=date.asc&limit=5&select=id,title,date,time`
        ).catch(() => []);
        const match = (events as any[]).find((e: any) => {
          const t = (e.title || "").toLowerCase();
          return rest.toLowerCase().split(/\s+/).some((w: string) => w.length > 3 && t.includes(w));
        });
        if (match) {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/events?id=eq.${enc(match.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_SERVICE_KEY || "", Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY || ""}` },
            body: JSON.stringify({ meeting_url: meetingLink }),
          }).catch(() => {});
          // Schedule the meeting bot to join 30s before the event.
          const localIso = `${match.date}T${match.time.padStart(5, "0")}:00+04:00`;
          const joinAt = new Date(localIso).getTime();
          if (!Number.isNaN(joinAt) && joinAt > Date.now() + 60000) {
            dispatchMeetingBot({
              link: meetingLink,
              title: match.title,
              scheduledAt: new Date(joinAt - 30000).toISOString(),
              displayName: botName,
              phone: from,
            }).catch(() => {});
          }
          const ack = `Got it. I saved the link to *${match.title}* on ${match.date} at ${match.time}. I will join 5 minutes before and send you the notes when it ends. Nothing to worry about.`;
          await sendTextAndLog(from, ack, { party: inboundParty, dev: sender.role === "developer" ? true : undefined });
          return NextResponse.json({ ok: true });
        }
      } catch {}
      // No event match: let the brain handle it (will respond naturally).
      // Fall through to runConcierge below.
    }

    // Wall 1 of "fragment match without anchor" (2026-06-16, KT #293). When the
    // inbound was a WhatsApp swipe-to-reply on a prior Dorje message, Meta's
    // payload carries msg.context.id (the wamid of the quoted outbound). We
    // persist it on the inbound row and resolve it to the quoted excerpt before
    // runConcierge so the model is anchored to the right subject and cannot
    // fuzzy-match a different task or event.
    const replyToExternalId: string | null = msg?.context?.id ? String(msg.context.id) : null;

    // NO-CHAT-LOST. Persist every inbound to chat_messages BEFORE the brain
    // runs, so an Anthropic / Vercel failure mid-runConcierge does not lose
    // what Jensen sent. The runConcierge end-path also appends, but Jensen's
    // message must be safe before any failure can swallow it.
    const inboundParty = sender.role === "admin" ? "taona" : "jensen";
    await ops.chatAppend("user", text, "whatsapp", inboundParty, {
      externalId: msg.id ? String(msg.id) : null,
      replyToExternalId,
    }).catch(() => {});
    // Mirror inbound into Chatwoot (read-only, Path B). Best-effort.
    const { mirrorToChatwoot } = await import("@/lib/chatwoot-mirror");
    mirrorToChatwoot("incoming", from, text).catch(() => {});

    // Resolve the swipe-reply anchor (Wall 1). If the inbound reply-quoted a
    // prior Dorje outbound row, look it up by external_id (uniquely indexed)
    // and grab its content as the anchor excerpt. The model receives this as
    // a hard-wall block in the system tail telling it which prior message Jensen
    // is pointing at, so "done" no longer fuzzes against a different task.
    let swipeAnchor: { quotedExcerpt: string } | null = null;
    if (replyToExternalId) {
      try {
        const rows = await admin()
          .from("chat_messages")
          .select("content,ts,role")
          .eq("external_id", replyToExternalId)
          .limit(1);
        const quoted = (rows.data || [])[0] as any;
        if (quoted?.content) {
          const excerpt = String(quoted.content).replace(/\s+/g, " ").slice(0, 200);
          if (excerpt) swipeAnchor = { quotedExcerpt: excerpt };
        }
      } catch {
        // best-effort; absence of anchor degrades to today's fuzzy behavior, not a failure
      }
    }

    // FM-11 DETERMINISTIC DONE-RESOLUTION. Bare confirmations from JENSEN
    // (owner tier only) route the most recently created open task to done
    // WITHOUT model dispatch. KT #127: when the model is brittle for a
    // deterministic verb, code the verb. Owner-only because Taona (admin)
    // chatting "Done" must NOT mark Jensen's tasks complete. Strip the
    // harness tag before matching so the prod harness exercises this path.
    // Wall 1 carve-out (2026-06-16): a swipe-anchor on the same turn means
    // Jensen pointed at a specific message, so the LLM brain steers better
    // than open[0]; fall through to runConcierge in that case.
    const cleaned = text.replace(/^\s*\[H[a-z0-9]{6,}\]\s*/, "").trim();
    const doneEligible = sender.role === "owner" || process.env.JENSEN_MODE === "TRAINING";
    if (doneEligible && !swipeAnchor && /^(done|done\.|did it|yes done|handled|marked done)$/i.test(cleaned)) {
      const open = await ops.listTasks({ done: false }).catch(() => [] as any[]);
      if (open.length > 0) {
        await ops.updateTask({ id: open[0].id, done: true }).catch(() => {});
        await ops.chatAppend("user", text, "whatsapp", "jensen").catch(() => {});
        const reply = `Done. Marked "${open[0].title}" complete.`;
        await ops.chatAppend("assistant", reply, "whatsapp", "jensen").catch(() => {});
        await sendWhatsApp(from, reply);
        return NextResponse.json({ ok: true });
      }
      // No open tasks: fall through to the brain so Jensen gets a graceful reply.
    }

    const { reply } = await runConcierge({ messages: [...history, { role: "user", content: text }], channel: "whatsapp", sender, swipeAnchor });
    await sendWhatsApp(from, reply || "I'm here.");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}

// Lightweight webhook diagnostic. The auto-WABA-discovery path failed for this
// account because Meta surfaces the system-user id at entry[0].id (not the
// WABA id), and the token lacks business_management scope to enumerate WABAs.
// We still capture the last entry[0].id and a truncated payload preview in kv
// so the operator can compare them against their WhatsApp Manager dashboard
// when looking up the real WABA_ID. No template submission attempted: that
// path is blocked until lr_meta_waba_id is set by the operator (a number
// looked up in business.facebook.com/wa/manage and saved by a one-shot
// helper). Once set, /api/cron/daily uses MORNING_BRIEF_TEMPLATE env to know
// which approved template to fire.
async function captureWebhookDiagnostic(body: any): Promise<void> {
  try {
    const entryId = body?.entry?.[0]?.id;
    if (entryId && /^\d{10,20}$/.test(String(entryId))) {
      await kvSet("lr_meta_last_entry_id", { id: String(entryId), at: Date.now() });
    }
    // Truncated preview — first 1.5KB of the JSON. Helpful for spotting the
    // real WABA in case Meta drops it at a different key for some payloads.
    const preview = JSON.stringify(body || {}).slice(0, 1500);
    await kvSet("lr_meta_last_webhook_preview", { preview, at: Date.now() });
  } catch {
    // Diagnostic failure must never block message processing.
  }
}
