// IMAP read + SMTP send. Short-lived connections per request (serverless-safe).
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailCreds } from "./mailbox";

// Forwarder fingerprint used by the spam-rescue branch. When a message lands
// in the spam folder because auto-forwarding broke SPF/DKIM, we tag the source
// provider so the UI can show "via Outlook" / "via Gmail" badges. Direct
// (non-forwarded) mail leaves this undefined.
export type ForwarderSource = "outlook" | "gmail" | "zoho";
export type MailSummary = {
  uid: number; folder: string; from: string; fromEmail: string; subject: string;
  date: string; snippet: string; seen: boolean; attachments: number;
  forwardedFrom?: ForwarderSource;
};
export type MailFull = MailSummary & { text: string; to: string; messageId?: string; attachmentNames: string[] };

// Pack/unpack (folder, uid) into a single string for the unified message id when
// the message lives outside INBOX (e.g. INBOX.spam after DMARC-broken forwarding).
// Plain numeric local = INBOX (back-compat).
const FOLDER_SEP = "|";
export function imapPackLocal(folder: string, uid: number): string {
  return folder === "INBOX" ? String(uid) : `${folder}${FOLDER_SEP}${uid}`;
}
export function imapUnpackLocal(local: string): { folder: string; uid: number } {
  const i = local.indexOf(FOLDER_SEP);
  if (i < 0) return { folder: "INBOX", uid: Number(local) };
  return { folder: local.slice(0, i), uid: Number(local.slice(i + 1)) };
}

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

// outlook.com auto-forwarding strips/breaks SPF/DKIM, so cPanel SpamAssassin
// dumps forwarded mail in INBOX.spam tagged ***SPAM***. We auto-discover the
// spam folder and pull legitimate forwards (Received header passes through
// Microsoft) back into the unified inbox.
async function discoverSpamFolder(client: ImapFlow): Promise<string | null> {
  try {
    const list: any[] = await client.list();
    const hit = list.find((f) => /\b(spam|junk)\b/i.test(f.path || ""));
    return hit?.path || null;
  } catch { return null; }
}

const OUTLOOK_RE = /outlook\.com|office365\.com|protection\.outlook\.com|hotmail\.com|live\.com|microsoft\.com/i;
const GMAIL_RE = /gmail\.com|googlemail\.com/i;
const ZOHO_RE = /zoho\.com|zoho\.eu|zoho\.in/i;
function classifyForwarder(headersBlob: string | undefined): ForwarderSource | null {
  if (!headersBlob) return null;
  if (OUTLOOK_RE.test(headersBlob)) return "outlook";
  if (GMAIL_RE.test(headersBlob)) return "gmail";
  if (ZOHO_RE.test(headersBlob)) return "zoho";
  return null;
}
function stripSpamPrefix(s: string): string {
  return (s || "").replace(/^\*{1,3}\s*SPAM\s*\*{1,3}\s*/i, "");
}

export async function listInbox(c: MailCreds, limit = 25): Promise<MailSummary[]> {
  const client = imapClient(c);
  const out: MailSummary[] = [];
  try {
    await client.connect();

    // 1) INBOX — straight read.
    {
      const box = await client.mailboxOpen("INBOX");
      if (box.exists) {
        const start = Math.max(1, box.exists - limit + 1);
        for await (const msg of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true })) {
          const env = msg.envelope;
          const fromAddr = env?.from?.[0];
          out.push({
            uid: msg.uid, folder: "INBOX",
            from: fromAddr?.name || fromAddr?.address || "Unknown",
            fromEmail: fromAddr?.address || "",
            subject: env?.subject || "(no subject)",
            date: (env?.date || new Date(0)).toString(),
            snippet: "",
            seen: msg.flags?.has("\\Seen") ?? false,
            attachments: countAttachments(msg.bodyStructure),
          });
        }
      }
    }

    // 2) Spam folder — only pull messages that look forwarded from outlook.com
    // (DMARC-on-forward false positive). Real spam stays buried.
    const spamFolder = await discoverSpamFolder(client);
    if (spamFolder) {
      try {
        const box = await client.mailboxOpen(spamFolder);
        if (box.exists) {
          const start = Math.max(1, box.exists - limit + 1);
          for await (const msg of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true, headers: ["received", "x-forwarded-to", "x-forwarded-for", "x-ms-exchange-organization-originalclientipaddress", "authentication-results"] })) {
            const hdr: string = (msg as any).headers ? (msg as any).headers.toString("utf-8") : "";
            const forwardedFrom = classifyForwarder(hdr);
            if (!forwardedFrom) continue; // real spam, not a broken forward — skip
            const env = msg.envelope;
            const fromAddr = env?.from?.[0];
            out.push({
              uid: msg.uid, folder: spamFolder,
              from: fromAddr?.name || fromAddr?.address || "Unknown",
              fromEmail: fromAddr?.address || "",
              subject: stripSpamPrefix(env?.subject || "(no subject)"),
              date: (env?.date || new Date(0)).toString(),
              snippet: "",
              seen: msg.flags?.has("\\Seen") ?? false,
              attachments: countAttachments(msg.bodyStructure),
              forwardedFrom,
            });
          }
        }
      } catch { /* spam folder unreadable — skip silently */ }
    }

    await client.logout();
    // newest first, cap at limit
    return out
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, limit);
  } catch (e: any) {
    try { await client.close(); } catch {}
    throw new Error(e?.responseText || e?.message || "Could not read the inbox.");
  }
}

export async function readMessage(c: MailCreds, uid: number, folder: string = "INBOX"): Promise<MailFull> {
  const client = imapClient(c);
  try {
    await client.connect();
    await client.mailboxOpen(folder);
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
      uid, folder,
      from: fromAddr?.name || fromAddr?.address || "Unknown", fromEmail: fromAddr?.address || "",
      subject: stripSpamPrefix(env?.subject || "(no subject)"), date: (env?.date || new Date(0)).toString(),
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
  // A calendar meeting REQUEST. nodemailer wires it as the correct text/calendar
  // part so the recipient (Outlook/Gmail/Apple) shows Accept/Decline.
  icalEvent?: { method: string; content: string };
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465,
      auth: { user: c.email, pass: c.pass },
    });
    await transport.sendMail({
      from: c.email, to: opts.to, subject: opts.subject, text: opts.text,
      inReplyTo: opts.inReplyTo, references: opts.inReplyTo,
      ...(opts.icalEvent ? { icalEvent: { method: opts.icalEvent.method, content: opts.icalEvent.content } } : {}),
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
