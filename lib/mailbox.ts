// Mailbox credentials, encrypted into an httpOnly cookie. No database, no OAuth
// app: Jensen connects his mailbox once with an app password (Outlook, Gmail, or
// custom IMAP/SMTP). Creds are AES-GCM encrypted with a key derived from
// SESSION_SECRET and never leave the server in plaintext.

export const MAIL_COOKIE = "lr_mail";

export type MailCreds = {
  provider: string;
  email: string;
  pass: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

export const PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; label: string }> = {
  outlook: { label: "Outlook / Microsoft 365", imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587 },
  gmail: { label: "Gmail / Google Workspace", imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 587 },
  larencontre: { label: "La Rencontre (larencontre.ae)", imapHost: "mail.larencontre.ae", imapPort: 993, smtpHost: "mail.larencontre.ae", smtpPort: 465 },
  custom: { label: "Custom IMAP / SMTP", imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 587 },
};

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD || "larencontre-dev-secret";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...b));
}
// Return a fresh ArrayBuffer (a valid BufferSource) from a base64 string.
function ab(s: string): ArrayBuffer {
  const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

export async function encryptCreds(creds: MailCreds): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(creds));
  const ivBuf = new ArrayBuffer(12); new Uint8Array(ivBuf).set(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBuf }, key, data);
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptCreds(token: string | undefined): Promise<MailCreds | null> {
  if (!token || !token.includes(".")) return null;
  try {
    const [ivB, ctB] = token.split(".");
    const key = await aesKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(ivB) }, key, ab(ctB));
    return JSON.parse(new TextDecoder().decode(pt)) as MailCreds;
  } catch {
    return null;
  }
}
