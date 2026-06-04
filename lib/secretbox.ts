// Generic AES-GCM JSON encryption, keyed off SESSION_SECRET. Used to store OAuth
// refresh/access tokens at rest in Supabase so a DB leak never exposes mailboxes.
// Server-only. Same primitive as lib/mailbox.ts, generalised to any JSON value.

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD || "larencontre-dev-secret";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...b));
}
function ab(s: string): ArrayBuffer {
  const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

export async function seal(value: any): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivBuf = new ArrayBuffer(12); new Uint8Array(ivBuf).set(iv);
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBuf }, key, data);
  return `${b64(iv)}.${b64(ct)}`;
}

export async function open<T = any>(token: string | undefined | null): Promise<T | null> {
  if (!token || !token.includes(".")) return null;
  try {
    const [ivB, ctB] = token.split(".");
    const key = await aesKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(ivB) }, key, ab(ctB));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}
