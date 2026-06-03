// IMAP read + SMTP send. Short-lived connections per request (serverless-safe).
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailCreds } from "./mailbox";

export type MailSummary = {
  uid: number; from: string; fromEmail: string; subject: string;
  date: string; snippet: string; seen: boolean; attachments: number;
};
export type MailFull = MailSummary & { text: string; to: string; messageId?: string; attachmentNames: string[] };

function imapClient(c: MailCreds): ImapFlow {
  return new ImapFlow({
    host: c.imapHost, port: c.imapPort, secure: c.imapPort === 993,
    auth: { user: c.email, pass: c.pass }, logger: false,
  });
}

// Login + count, used by connect to prove the mailbox is reachable.
export async function verifyMailbox(c: MailCreds): Promise<{ ok: boolean; count?: number; error?: string }> {
  const client = imapClient(c);
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX");
    await client.logout();
    return { ok: true, count: box.exists };
  } catch (e: any) {
    try { await client.close(); } catch {}
    return { ok: false, error: e?.responseText || e?.message || "Could not sign in to the mailbox." };
  }
}

export async function listInbox(c: MailCreds, limit = 25): Promise<MailSummary[]> {
  const client = imapClient(c);
  const out: MailSummary[] = [];
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX");
    const total = box.exists;
    if (!total) return [];
    const start = Math.max(1, total - limit + 1);
    for await (const msg of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true, bodyParts: ["text"] })) {
      const env = msg.envelope;
      const fromAddr = env?.from?.[0];
      const attachments = countAttachments(msg.bodyStructure);
      out.push({
        uid: msg.uid,
        from: fromAddr?.name || fromAddr?.address || "Unknown",
        fromEmail: fromAddr?.address || "",
        subject: env?.subject || "(no subject)",
        date: (env?.date || new Date(0)).toString(),
        snippet: "",
        seen: msg.flags?.has("\\Seen") ?? false,
        attachments,
      });
    }
    await client.logout();
    return out.reverse();
  } catch (e: any) {
    try { await client.close(); } catch {}
    throw new Error(e?.responseText || e?.message || "Could not read the inbox.");
  }
}

export async function readMessage(c: MailCreds, uid: number): Promise<MailFull> {
  const client = imapClient(c);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const msg: any = await client.fetchOne(String(uid), { uid: true, envelope: true, source: true, bodyStructure: true }, { uid: true });
    const env = msg.envelope;
    const fromAddr = env?.from?.[0];
    const { simpleParser } = await import("mailparser").catch(() => ({ simpleParser: null as any }));
    let text = ""; const attachmentNames: string[] = [];
    if (simpleParser && msg.source) {
      const parsed = await simpleParser(msg.source);
      text = parsed.text || parsed.html?.replace(/<[^>]+>/g, " ") || "";
      for (const a of parsed.attachments || []) attachmentNames.push(a.filename || "attachment");
    }
    await client.logout();
    return {
      uid, from: fromAddr?.name || fromAddr?.address || "Unknown", fromEmail: fromAddr?.address || "",
      subject: env?.subject || "(no subject)", date: (env?.date || new Date(0)).toString(),
      snippet: text.slice(0, 160), seen: true, attachments: attachmentNames.length,
      text: text.slice(0, 20000), to: env?.to?.map((t: any) => t.address).join(", ") || c.email,
      messageId: env?.messageId, attachmentNames,
    };
  } catch (e: any) {
    try { await client.close(); } catch {}
    throw new Error(e?.responseText || e?.message || "Could not open the message.");
  }
}

export type OutAttachment = { filename: string; content: string; contentType?: string }; // content = base64

export async function sendMail(c: MailCreds, opts: {
  to: string; subject: string; text: string; inReplyTo?: string; attachments?: OutAttachment[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465,
      auth: { user: c.email, pass: c.pass },
    });
    await transport.sendMail({
      from: c.email, to: opts.to, subject: opts.subject, text: opts.text,
      inReplyTo: opts.inReplyTo, references: opts.inReplyTo,
      attachments: (opts.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64"), contentType: a.contentType })),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not send." };
  }
}

function countAttachments(node: any): number {
  if (!node) return 0;
  let n = 0;
  const walk = (x: any) => {
    if (!x) return;
    if (x.disposition === "attachment") n++;
    (x.childNodes || []).forEach(walk);
  };
  walk(node);
  return n;
}
