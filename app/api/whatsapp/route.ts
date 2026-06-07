import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp, isOwner, whoIs } from "@/lib/whatsapp";
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
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from: string = msg?.from || "";
    if (!from || !msg?.id) return NextResponse.json({ ok: true });
    if (await seen(msg.id)) return NextResponse.json({ ok: true });

    // MAINTENANCE GATE. While JENSEN_MODE=TRAINING:
    //   - allowlist (Taona): full bot, drives the sweep
    //   - Jensen: one training-notice per day, then silent (no leak of activity)
    //   - anyone else: silent drop (no reply, no log noise)
    // Cloned from nisria-techops Sasa 727 sweep (HOW-TO-SWEEP playbook step 1).
    if (process.env.JENSEN_MODE === "TRAINING") {
      const allow = (process.env.MAINTENANCE_ALLOWLIST || "")
        .split(",")
        .map((s) => s.replace(/[^0-9]/g, ""))
        .filter(Boolean);
      const fromDigits = from.replace(/[^0-9]/g, "");
      if (!allow.includes(fromDigits)) {
        const isJensen = whoIs(from).role === "owner";
        if (isJensen) {
          const today = new Date().toISOString().slice(0, 10);
          const noticeKey = `maintenance_notice_${fromDigits}_${today}`;
          if (!(await kvGet<boolean>(noticeKey, false))) {
            await sendWhatsApp(
              from,
              "Hi Jensen. I'm going through training and upgrades right now. I will notify you the moment I am back online. Your data is safe, nothing is lost. — Rencontre",
              { force: true },
            );
            await kvSet(noticeKey, true);
          }
        }
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

      // Intake runs directly (NOT through the chat brain) so it works even during
      // onboarding: stored + embedded + foldered + (invoice -> finance) + noted.
      const filed = await classifyAndFile({ id, title, text });
      let msg = `Filed *${title}* under *${filed.folder}*.`;
      if (filed.finance) msg += ` Logged an expense of AED ${filed.finance.amount} (${filed.finance.label}).`;
      msg += ` I've read it, so I can pull it up or send it whenever you need.`;
      const party = sender.role === "admin" ? "taona" : "jensen";
      await ops.chatAppend("user", `[sent a document: ${title}]`, "whatsapp", party).catch(() => {});
      await ops.chatAppend("assistant", msg, "whatsapp", party).catch(() => {});
      await sendWhatsApp(from, msg);
      return NextResponse.json({ ok: true });
    }

    // ---- plain text: full concierge ----
    const text = (msg.text?.body || "").trim();
    if (!text) return NextResponse.json({ ok: true });
    const { reply } = await runConcierge({ messages: [...history, { role: "user", content: text }], channel: "whatsapp", sender });
    await sendWhatsApp(from, reply || "I'm here.");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
