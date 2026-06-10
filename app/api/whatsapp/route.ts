import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp, isOwner, whoIs, mirrorInbound } from "@/lib/whatsapp";
import { runConcierge } from "@/lib/concierge/loop";
import { kvGet, kvSet } from "@/lib/db";
import * as ops from "@/lib/concierge/ops";
import { classifyAndFile } from "@/lib/concierge/intake";
import { readImage } from "@/lib/anthropic";
import { extractTextFromBuffer } from "@/lib/extract-text";
import { embed, chunk } from "@/lib/openai";
import { transcribeAudio } from "@/lib/transcribe";

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
async function seen(id: string): Promise<boolean> {
  try {
    const arr = await kvGet<string[]>("wa_seen", []);
    if (arr.includes(id)) return true;
    await kvSet("wa_seen", [...arr.slice(-199), id]);
    return false;
  } catch {
    return false;
  }
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
    const body = await req.json();
    // WABA AUTO-CAPTURE. The Meta system-user token can manage templates ON
    // a known WABA but cannot enumerate WABAs (missing business_management
    // scope, by design). We capture the WABA id from the first webhook hit
    // (Meta puts it on entry[0].id) and, the first time we see one, also
    // submit the morning_brief_v1 utility template so the daily cron stops
    // skipping when Jensen is off-window. Background, fire-and-forget so it
    // never blocks the inbound. Idempotent via two kv flags.
    captureWabaAndMaybeSubmitTemplate(body).catch(() => {});

    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from: string = msg?.from || "";
    if (!from || !msg?.id) return NextResponse.json({ ok: true });
    if (await seen(msg.id)) return NextResponse.json({ ok: true });

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
      const dl = await downloadMedia(media.id);
      if (!dl) { await sendWhatsApp(from, "I couldn't fetch that file from WhatsApp. Try sending it again."); return NextResponse.json({ ok: true }); }
      let text = "";
      if (dl.mime.startsWith("image/")) text = await readImage(dl.base64, dl.mime);
      else text = (await extractTextFromBuffer(dl.buf, dl.mime, media.filename || "document")) || "";
      if (!text.trim()) { await sendWhatsApp(from, "I saved your file but couldn't read text from it. If it's a photo, a clearer shot helps."); return NextResponse.json({ ok: true }); }

      const id = uid();
      const title = (media.filename || caption || "WhatsApp upload").replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "WhatsApp upload";
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

    // NO-CHAT-LOST. Persist every inbound to chat_messages BEFORE the brain
    // runs, so an Anthropic / Vercel failure mid-runConcierge does not lose
    // what Jensen sent. The runConcierge end-path also appends, but Jensen's
    // message must be safe before any failure can swallow it.
    const inboundParty = sender.role === "admin" ? "taona" : "jensen";
    await ops.chatAppend("user", text, "whatsapp", inboundParty).catch(() => {});

    // FM-11 DETERMINISTIC DONE-RESOLUTION. Bare confirmations from JENSEN
    // (owner tier only) route the most recently created open task to done
    // WITHOUT model dispatch. KT #127: when the model is brittle for a
    // deterministic verb, code the verb. Owner-only because Taona (admin)
    // chatting "Done" must NOT mark Jensen's tasks complete. Strip the
    // harness tag before matching so the prod harness exercises this path.
    const cleaned = text.replace(/^\s*\[H[a-z0-9]{6,}\]\s*/, "").trim();
    // Owner-only post-unlock; during the sweep window (JENSEN_MODE=TRAINING) the
    // harness drives from Taona's admin number and still needs to exercise this path.
    const doneEligible = sender.role === "owner" || process.env.JENSEN_MODE === "TRAINING";
    if (doneEligible && /^(done|done\.|did it|yes done|handled|marked done)$/i.test(cleaned)) {
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

    const { reply } = await runConcierge({ messages: [...history, { role: "user", content: text }], channel: "whatsapp", sender });
    await sendWhatsApp(from, reply || "I'm here.");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// WABA AUTO-CAPTURE + ONE-TIME TEMPLATE SUBMISSION
//
// The Meta system-user token has whatsapp_business_management scope (can
// manage templates) but NOT business_management scope (can't enumerate
// WABAs). So we cannot auto-discover the WABA_ID via Graph API alone. But
// every Meta webhook payload puts the WABA id at body.entry[0].id, so the
// next inbound message gives us the answer for free. We stash it in kv,
// then immediately POST the morning_brief_v1 utility template so the daily
// cron has a real off-window send path. Submission is idempotent (kv flag
// prevents re-posting), and runs background so a slow Graph call never
// blocks the user's inbound.
// ---------------------------------------------------------------------------
async function captureWabaAndMaybeSubmitTemplate(body: any): Promise<void> {
  try {
    const wabaFromPayload = body?.entry?.[0]?.id;
    if (!wabaFromPayload || !/^\d{10,20}$/.test(String(wabaFromPayload))) return;

    const existing = await kvGet<string | null>("lr_meta_waba_id", null);
    if (!existing) {
      await kvSet("lr_meta_waba_id", String(wabaFromPayload));
      console.log(`[waba-capture] stored ${wabaFromPayload}`);
    }
    const wabaId = existing || String(wabaFromPayload);

    const submitted = await kvGet<boolean>("lr_morning_template_submitted", false);
    if (submitted) return;

    const token = process.env.WHATSAPP_TOKEN;
    if (!token) return;

    // Utility template, English (US). Body matches the [q1, q2, today events,
    // pending mail] parameter order in app/api/cron/daily/route.ts.
    const tpl = {
      name: "morning_brief_v1",
      category: "UTILITY",
      language: "en_US",
      components: [
        {
          type: "BODY",
          text: "Morning, Jensen. {{1}} on your board today, {{2}} I am protecting, {{3}} on schedule, {{4}} email proposals waiting. Reply here to see the full brief.",
          example: { body_text: [["2 items", "5 items", "3 events", "1"]] },
        },
      ],
    };

    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(tpl),
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.id) {
      await kvSet("lr_morning_template_submitted", true);
      await kvSet("lr_morning_template_id", String(j.id));
      console.log(`[waba-capture] template submitted id=${j.id} status=${j.status || "in_review"}`);
    } else {
      // If the template already exists from a prior submission attempt, Meta
      // returns a specific error subcode — treat as "already done" and stop
      // retrying so a flaky tick doesn't spam Meta.
      const msg = j?.error?.message || "";
      if (/already exists|conflict/i.test(msg)) {
        await kvSet("lr_morning_template_submitted", true);
        console.log(`[waba-capture] template already exists, marked submitted`);
      } else {
        console.log(`[waba-capture] template submit failed: ${res.status} ${msg.slice(0, 240)}`);
      }
    }
  } catch (e: any) {
    console.log(`[waba-capture] threw: ${e?.message || e}`);
  }
}
