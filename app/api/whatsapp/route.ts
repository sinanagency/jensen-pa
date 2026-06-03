import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp, waConfigured, ownerNumber } from "@/lib/whatsapp";
import { decryptCreds } from "@/lib/mailbox";
import { listInbox, readMessage, sendMail } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 45;

// Meta webhook verification handshake.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Inbound message: read or reply to mail from WhatsApp.
// Commands: "inbox" (latest), "read <n>", "reply <n> <text>".
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const text: string = msg?.text?.body?.trim() || "";
    if (!from || !text) return NextResponse.json({ ok: true });

    const owner = ownerNumber();
    if (owner && from !== owner.replace(/[^0-9]/g, "")) {
      await sendWhatsApp(from, "This assistant is private.");
      return NextResponse.json({ ok: true });
    }

    const creds = await decryptCreds(process.env.LR_MAIL_CREDS);
    if (!creds) {
      await sendWhatsApp(from, "Your mailbox is not linked for WhatsApp yet. Connect it in the portal under Mail, then link it for WhatsApp.");
      return NextResponse.json({ ok: true });
    }

    const lower = text.toLowerCase();
    if (lower === "inbox" || lower === "mail") {
      const list = await listInbox(creds, 7);
      const lines = list.map((m, i) => `${i + 1}. ${m.from}: ${m.subject}${m.attachments ? " 📎" : ""}`);
      await sendWhatsApp(from, lines.length ? `Your latest mail:\n\n${lines.join("\n")}\n\nReply "read 1" to open one.` : "Your inbox is empty.");
    } else if (lower.startsWith("read ")) {
      const n = Number(lower.split(" ")[1]);
      const list = await listInbox(creds, 7);
      const pick = list[n - 1];
      if (!pick) await sendWhatsApp(from, "I could not find that one. Send \"inbox\" to see the list.");
      else {
        const full = await readMessage(creds, pick.uid);
        await sendWhatsApp(from, `From ${full.from}\nSubject: ${full.subject}\n\n${full.text.slice(0, 1200)}\n\nReply "reply ${n} your message" to respond.`);
      }
    } else if (lower.startsWith("reply ")) {
      const rest = text.slice(6);
      const n = Number(rest.split(" ")[0]);
      const replyText = rest.slice(String(n).length).trim();
      const list = await listInbox(creds, 7);
      const pick = list[n - 1];
      if (!pick || !replyText) await sendWhatsApp(from, 'Use: reply <number> <your message>.');
      else {
        const r = await sendMail(creds, { to: pick.fromEmail, subject: `Re: ${pick.subject}`, text: replyText });
        await sendWhatsApp(from, r.ok ? `Sent your reply to ${pick.from}.` : `I could not send it: ${r.error}`);
      }
    } else {
      await sendWhatsApp(from, 'I can help with your mail. Try "inbox", "read 1", or "reply 1 your message".');
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
