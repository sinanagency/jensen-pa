// Unified mail adapter over the OAuth providers. Every connected account exposes
// the same three operations (list / read / send), normalised so the inbox,
// triage and reply UI never care whether a message lives in Microsoft 365 or
// Zoho. A unified message id is `${accountId}::${providerLocalId}`. Server-only.

import { freshToken, listAccounts, imapCreds, accountProvider } from "./mail-accounts";
import { zohoApiHost, Provider } from "./oauth";
import { listInbox as imapList, readMessage as imapRead, sendMail as imapSend, imapPackLocal, imapUnpackLocal } from "./mail-ops";
import { buildInviteIcs } from "./ics";

export type UMailSummary = {
  id: string; accountId: string; accountEmail: string; provider: Provider | "imap";
  from: string; fromEmail: string; subject: string; date: string; snippet: string;
  seen: boolean; attachments: number;
  // Present when the message arrived via auto-forwarding (e.g. Outlook -> larencontre.ae)
  // and was rescued from cPanel's spam folder. UI shows a small "via Outlook" badge.
  forwardedFrom?: "outlook" | "gmail" | "zoho";
};

export const IMAP_ACCOUNT = "imap";
export type UMailFull = UMailSummary & { text: string; to: string; messageId?: string };

const SEP = "::";
export function packId(accountId: string, local: string): string { return `${accountId}${SEP}${local}`; }
export function unpackId(id: string): { accountId: string; local: string } {
  const i = id.indexOf(SEP);
  return { accountId: id.slice(0, i), local: id.slice(i + SEP.length) };
}

// ---------- Microsoft Graph ----------
const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return res.json();
}

function addr(a: any): { name: string; email: string } {
  const e = a?.emailAddress || {};
  return { name: e.name || e.address || "", email: e.address || "" };
}

async function msList(accountId: string, accountEmail: string, token: string, limit: number): Promise<UMailSummary[]> {
  const q = `/me/mailFolders/inbox/messages?$top=${limit}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments&$orderby=receivedDateTime desc`;
  const j = await graphGet(token, q);
  return (j.value || []).map((m: any) => {
    const f = addr(m.from);
    return {
      id: packId(accountId, m.id), accountId, accountEmail, provider: "microsoft" as Provider,
      from: f.name || f.email, fromEmail: f.email, subject: m.subject || "(no subject)",
      date: m.receivedDateTime || "", snippet: m.bodyPreview || "", seen: !!m.isRead, attachments: m.hasAttachments ? 1 : 0,
    };
  });
}

async function msRead(accountId: string, accountEmail: string, token: string, local: string): Promise<UMailFull> {
  const m = await graphGet(token, `/me/messages/${local}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,internetMessageId,isRead,hasAttachments`);
  const f = addr(m.from);
  const text = (m.body?.contentType === "html" ? stripHtml(m.body?.content || "") : m.body?.content || m.bodyPreview || "");
  return {
    id: packId(accountId, m.id), accountId, accountEmail, provider: "microsoft",
    from: f.name || f.email, fromEmail: f.email, subject: m.subject || "", date: m.receivedDateTime || "",
    snippet: m.bodyPreview || "", seen: !!m.isRead, attachments: m.hasAttachments ? 1 : 0,
    text, to: (m.toRecipients || []).map((r: any) => addr(r).email).join(", "), messageId: m.internetMessageId,
  };
}

async function msSend(token: string, to: string, subject: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: text }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph send ${res.status}: ${(await res.text()).slice(0, 240)}`);
}

// Send a real meeting INVITE (accept/decline) from Jensen's OWN mailbox as an
// iCalendar REQUEST over SMTP. Works on his plain-IMAP larencontre.ae account —
// no Microsoft Graph, no calendar API, no extra OAuth. The recipient's mail app
// (Outlook/Gmail/Apple) renders Accept/Decline; Jensen's own calendar picks it up
// as the organizer. Throws an honest error if no mailbox is connected.
// Compose + send a BRAND-NEW outbound email from Jensen's own mailbox to any
// address. reply_email only replies to an existing inbox message (needs an id);
// this is the missing "send a new email to someone" capability the bot wrongly
// told Jensen it lacked.
export async function sendNewEmail(opts: { toEmail: string; subject: string; body: string }): Promise<{ from: string }> {
  const accounts = await listAccounts();
  const imap = accounts.filter((a) => a.provider === "imap");
  const jensen = imap.find((a) => /jensen/i.test(a.email)) || imap[0];
  if (!jensen) throw new Error("No mailbox is connected to send from.");
  await sendUnified(jensen.id, opts.toEmail, opts.subject, opts.body);
  return { from: jensen.email };
}

export async function sendMeetingInviteEmail(opts: {
  toEmail: string; toName?: string; subject: string; whenLabel: string;
  start: Date; end: Date; location?: string; description?: string;
}): Promise<{ from: string; uid: string }> {
  const accounts = await listAccounts();
  // Jensen's personal mailbox: prefer the imap account with "jensen" in it, else
  // the first imap account (never the "info@" catch-all if a personal one exists).
  const imap = accounts.filter((a) => a.provider === "imap");
  const jensen = imap.find((a) => /jensen/i.test(a.email)) || imap[0];
  if (!jensen) throw new Error("No mailbox is connected to send the invite from.");
  const creds = await imapCreds(jensen.id);
  const uid = `lr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@larencontre.ae`;
  const ics = buildInviteIcs({
    uid, organizerEmail: jensen.email, organizerName: "Jensen Moonien",
    attendeeEmail: opts.toEmail, attendeeName: opts.toName,
    summary: opts.subject, location: opts.location, description: opts.description,
    start: opts.start, end: opts.end, method: "REQUEST",
  });
  const text = `You are invited to: ${opts.subject}\nWhen: ${opts.whenLabel}\n${opts.location ? `Where: ${opts.location}\n` : ""}${opts.description ? `\n${opts.description}\n` : ""}\nPlease accept or decline using the invite attached to this email.`;
  const r = await imapSend(creds, { to: opts.toEmail, subject: opts.subject, text, icalEvent: { method: "REQUEST", content: ics } });
  if (!r.ok) throw new Error(r.error || "Could not send the invite.");
  return { from: jensen.email, uid };
}

// ---------- Zoho Mail ----------
async function zohoAccount(token: string): Promise<{ accountId: string; email: string }> {
  const res = await fetch(`${zohoApiHost()}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) throw new Error(`Zoho accounts ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const j = await res.json();
  const a = (j.data || [])[0] || {};
  return { accountId: String(a.accountId || ""), email: a.primaryEmailAddress || a.mailboxAddress || "" };
}

async function zoList(accountId: string, accountEmail: string, token: string, limit: number): Promise<UMailSummary[]> {
  const z = await zohoAccount(token);
  const res = await fetch(`${zohoApiHost()}/api/accounts/${z.accountId}/messages/view?limit=${limit}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) throw new Error(`Zoho list ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const j = await res.json();
  return (j.data || []).map((m: any) => ({
    id: packId(accountId, `${m.folderId}/${m.messageId}`), accountId, accountEmail, provider: "zoho" as Provider,
    from: m.sender || m.fromAddress || "", fromEmail: m.fromAddress || "", subject: m.subject || "(no subject)",
    date: m.receivedTime ? new Date(Number(m.receivedTime)).toISOString() : "", snippet: m.summary || "",
    seen: m.status === "1" || m.isRead === true, attachments: Number(m.hasAttachment || 0) ? 1 : 0,
  }));
}

async function zoRead(accountId: string, accountEmail: string, token: string, local: string): Promise<UMailFull> {
  const z = await zohoAccount(token);
  const [folderId, messageId] = local.split("/");
  const res = await fetch(`${zohoApiHost()}/api/accounts/${z.accountId}/folders/${folderId}/messages/${messageId}/content`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) throw new Error(`Zoho read ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const j = await res.json();
  const d = j.data || {};
  return {
    id: packId(accountId, local), accountId, accountEmail, provider: "zoho",
    from: d.sender || d.fromAddress || "", fromEmail: d.fromAddress || "", subject: d.subject || "",
    date: d.receivedTime ? new Date(Number(d.receivedTime)).toISOString() : "", snippet: d.summary || "",
    seen: true, attachments: 0, text: stripHtml(d.content || ""), to: d.toAddress || "", messageId: d.messageId,
  };
}

async function zoSend(token: string, fromEmail: string, to: string, subject: string, text: string): Promise<void> {
  const z = await zohoAccount(token);
  const res = await fetch(`${zohoApiHost()}/api/accounts/${z.accountId}/messages`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fromAddress: z.email || fromEmail, toAddress: to, subject, content: text, mailFormat: "plaintext" }),
  });
  if (!res.ok) throw new Error(`Zoho send ${res.status}: ${(await res.text()).slice(0, 240)}`);
}

// ---------- unified dispatch ----------
function imapToSummary(accountId: string, accountEmail: string, m: any): UMailSummary {
  return {
    id: packId(accountId, imapPackLocal(m.folder || "INBOX", m.uid)), accountId, accountEmail, provider: "imap",
    from: m.from, fromEmail: m.fromEmail, subject: m.subject, date: m.date, snippet: m.snippet, seen: m.seen, attachments: m.attachments,
    forwardedFrom: m.forwardedFrom,
  };
}

export async function aggregateInbox(perAccount = 15): Promise<UMailSummary[]> {
  const accounts = await listAccounts();
  let errors = 0;
  const batches = await Promise.all(accounts.map(async (a) => {
    try {
      if (a.provider === "imap") {
        const creds = await imapCreds(a.id);
        return (await imapList(creds, perAccount)).map((m) => imapToSummary(a.id, a.email, m));
      }
      const t = await freshToken(a.id);
      return a.provider === "microsoft"
        ? await msList(a.id, a.email, t.accessToken, perAccount)
        : await zoList(a.id, a.email, t.accessToken, perAccount);
    } catch { errors++; return [] as UMailSummary[]; }
  }));
  // Never report a false "inbox clear". If EVERY account failed to read, that is
  // an error, not an empty inbox: throw so the tool surfaces it honestly. A
  // partial failure (some accounts read) still returns what we could fetch.
  if (accounts.length > 0 && errors === accounts.length) {
    throw new Error(`could not read inbox: all ${accounts.length} mail account(s) failed`);
  }
  return batches.flat().sort((x, y) => (y.date || "").localeCompare(x.date || ""));
}

export async function readUnified(id: string): Promise<UMailFull> {
  const { accountId, local } = unpackId(id);
  const a = (await listAccounts()).find((x) => x.id === accountId);
  if (a?.provider === "imap") {
    const creds = await imapCreds(accountId);
    const { folder, uid } = imapUnpackLocal(local);
    const m: any = await imapRead(creds, uid, folder);
    return { ...imapToSummary(accountId, a.email, m), text: m.text || "", to: m.to || "", messageId: m.messageId };
  }
  const t = await freshToken(accountId);
  return t.provider === "microsoft"
    ? msRead(accountId, a?.email || t.email, t.accessToken, local)
    : zoRead(accountId, a?.email || t.email, t.accessToken, local);
}

export async function sendUnified(accountId: string, to: string, subject: string, text: string): Promise<void> {
  const kind = await accountProvider(accountId);
  if (kind === "imap") {
    const creds = await imapCreds(accountId);
    const r = await imapSend(creds, { to, subject, text });
    if (!r.ok) throw new Error(r.error || "Could not send.");
    return;
  }
  const t = await freshToken(accountId);
  return t.provider === "microsoft" ? msSend(t.accessToken, to, subject, text) : zoSend(t.accessToken, t.email, to, subject, text);
}

export async function hasAccounts(): Promise<boolean> {
  return (await listAccounts()).length > 0;
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
