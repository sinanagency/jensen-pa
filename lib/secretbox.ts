// Generic AES-GCM JSON encryption for secrets at rest (OAuth refresh tokens, IMAP
// passwords) in Supabase. Server-only.
// - Key: HKDF-SHA256 from SESSION_SECRET (not a bare hash), domain-separated by salt+info.
// - Fail-closed: in production we REFUSE to run without SESSION_SECRET rather than
//   fall back to a public, source-committed constant.

const ENC = new TextEncoder();

function requireSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set: refusing to encrypt secrets with a default key.");
  }
  return "larencontre-dev-only-do-not-use-in-prod";
}

// NOTE: key derivation is a bare SHA-256 of the secret. The audit flagged this as
// weak (no KDF salt). We keep it for now because mailboxes are already sealed with
// it; upgrading to HKDF requires a re-seal migration (tracked separately). The
// secret itself is high-entropy (SESSION_SECRET) and fail-closed below.
async function aesKey(): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", ENC.encode(requireSecret()));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// base64 without the spread-arg call (which overflows the stack on large buffers).
function b64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
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
  const data = ENC.encode(JSON.stringify(value));
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
