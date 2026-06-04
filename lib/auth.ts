// Minimal, real auth: a shared passphrase gate with an HMAC-signed session
// cookie. Works in both Node routes and the Edge middleware via Web Crypto.

export const COOKIE = "lr_session";
const DAY = 86_400;
const TTL = 30 * DAY;

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set: refusing to sign sessions with a default key.");
  return "larencontre-dev-only-do-not-use-in-prod";
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}

// url-safe base64 (works in both Edge and Node via Web APIs)
function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}

// Token format: v2.<exp>.<subjectB64>.<sig> — subject is the account id, so the
// server knows WHO is logged in (multi-user) while the signature still gates access.
export async function mintToken(sub = ""): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const sub64 = b64url(sub);
  const body = `v2.${exp}.${sub64}`;
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [v, exp, sub64, sig] = parts;
  if (v !== "v2") return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`${v}.${exp}.${sub64}`);
  return timingSafeEqual(sig, expected);
}

// Pull the account id out of a token (verify separately if it matters).
export function readSubject(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  try { return unb64url(parts[2]); } catch { return null; }
}

export function checkPassword(input: string): boolean {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  return timingSafeEqual(input.trim(), pw);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export const COOKIE_MAX_AGE = TTL;
