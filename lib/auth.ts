// Minimal, real auth: a shared passphrase gate with an HMAC-signed session
// cookie. Works in both Node routes and the Edge middleware via Web Crypto.

export const COOKIE = "lr_session";
const DAY = 86_400;
const TTL = 30 * DAY;

function secret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "larencontre-dev-secret";
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}

export async function mintToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const body = `v1.${exp}`;
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, exp, sig] = parts;
  if (v !== "v1") return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`${v}.${exp}`);
  return timingSafeEqual(sig, expected);
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
