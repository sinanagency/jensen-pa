// Connected mailboxes (multi-account) for the portal. Each account is its OWN kv
// row ("mail_account:<id>") with an index row ("mail_accounts_index") listing ids.
// Public fields in the clear, secrets sealed (AES-GCM). Tokens auto-refresh on use.
//
// Per-account rows (not one array blob) are deliberate: OAuth refresh rotates the
// refresh token (Microsoft invalidates the old one), and refreshes happen
// concurrently across accounts. A single shared blob would let one refresh's
// write clobber another's freshly-rotated token (last-writer-wins) and brick the
// account. With per-account rows, a refresh writes only its own row. Server-only.

import { kvGet, kvSet } from "./db";
import { seal, open } from "./secretbox";
import { Provider, TokenSet, refreshToken } from "./oauth";
import type { MailCreds } from "./mailbox";

const INDEX = "mail_accounts_index";
const LEGACY = "mail_accounts"; // old single-array key, migrated on first read
const row = (id: string) => `mail_account:${id}`;

export type AccountKind = Provider | "imap";

type StoredAccount = {
  id: string;
  provider: AccountKind;
  email: string;
  createdAt: number;
  enc: string; // sealed TokenSet (OAuth) or sealed MailCreds (imap)
};

export type PublicAccount = { id: string; provider: AccountKind; email: string; createdAt: number };

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `acc_${Date.now().toString(36)}`; }
}

// One-time migration: if the old array blob exists, split it into per-account rows.
async function migrateLegacy(): Promise<void> {
  const legacy = await kvGet<StoredAccount[] | null>(LEGACY, null);
  if (!legacy || !Array.isArray(legacy) || legacy.length === 0) {
    if (legacy) await kvSet(LEGACY, null);
    return;
  }
  const ids: string[] = [];
  for (const a of legacy) {
    if (!a?.id) continue;
    await kvSet(row(a.id), a);
    ids.push(a.id);
  }
  // merge into any existing index, then drop the legacy blob
  const existing = await kvGet<string[]>(INDEX, []);
  const merged = Array.from(new Set([...existing, ...ids]));
  await kvSet(INDEX, merged);
  await kvSet(LEGACY, null);
}

async function ids(): Promise<string[]> {
  const idx = await kvGet<string[]>(INDEX, []);
  if (idx.length === 0) {
    // either truly empty, or not yet migrated — try migration once.
    await migrateLegacy();
    return kvGet<string[]>(INDEX, []);
  }
  return idx;
}

async function getRow(id: string): Promise<StoredAccount | null> {
  return kvGet<StoredAccount | null>(row(id), null);
}

async function all(): Promise<StoredAccount[]> {
  const list = await Promise.all((await ids()).map((id) => getRow(id)));
  return list.filter((a): a is StoredAccount => !!a);
}

export async function listAccounts(): Promise<PublicAccount[]> {
  return (await all()).map(({ id, provider, email, createdAt }) => ({ id, provider, email, createdAt }));
}

async function putAccount(a: StoredAccount): Promise<void> {
  await kvSet(row(a.id), a);
  const idx = await kvGet<string[]>(INDEX, []);
  if (!idx.includes(a.id)) await kvSet(INDEX, [...idx, a.id]);
}

async function findByEmail(provider: AccountKind, email: string): Promise<StoredAccount | null> {
  const e = email.toLowerCase();
  return (await all()).find((a) => a.provider === provider && a.email.toLowerCase() === e) || null;
}

export async function upsertAccount(provider: Provider, email: string, tokens: TokenSet): Promise<PublicAccount> {
  const enc = await seal(tokens);
  const existing = await findByEmail(provider, email);
  const acct: StoredAccount = existing
    ? { ...existing, enc }
    : { id: uid(), provider, email, createdAt: Date.now(), enc };
  await putAccount(acct);
  return { id: acct.id, provider: acct.provider, email: acct.email, createdAt: acct.createdAt };
}

export async function upsertImapAccount(email: string, creds: MailCreds): Promise<PublicAccount> {
  const enc = await seal(creds);
  const existing = await findByEmail("imap", email);
  const acct: StoredAccount = existing
    ? { ...existing, enc }
    : { id: uid(), provider: "imap", email, createdAt: Date.now(), enc };
  await putAccount(acct);
  return { id: acct.id, provider: acct.provider, email: acct.email, createdAt: acct.createdAt };
}

export async function removeAccount(id: string): Promise<void> {
  await kvSet(row(id), null);
  const idx = await kvGet<string[]>(INDEX, []);
  if (idx.includes(id)) await kvSet(INDEX, idx.filter((x) => x !== id));
}

export async function imapCreds(id: string): Promise<MailCreds> {
  const acct = await getRow(id);
  if (!acct) throw new Error("Mailbox not found.");
  const c = await open<MailCreds>(acct.enc);
  if (!c) throw new Error("Mailbox needs reconnecting.");
  return c;
}

export async function accountProvider(id: string): Promise<AccountKind | null> {
  return (await getRow(id))?.provider ?? null;
}

// Return a valid access token for an OAuth account, refreshing + persisting if
// expired. Writes ONLY this account's row (no cross-account clobber).
export async function freshToken(id: string): Promise<{ provider: Provider; email: string; accessToken: string }> {
  const acct = await getRow(id);
  if (!acct) throw new Error("Mailbox not found.");
  if (acct.provider === "imap") throw new Error("Not an OAuth mailbox.");
  const oauthProvider: Provider = acct.provider;
  let tokens = await open<TokenSet>(acct.enc);
  if (!tokens) throw new Error("Mailbox needs reconnecting.");

  if (tokens.expiresAt <= Date.now()) {
    if (!tokens.refreshToken) throw new Error("Mailbox needs reconnecting (no refresh token).");
    tokens = await refreshToken(oauthProvider, tokens.refreshToken);
    await kvSet(row(id), { ...acct, enc: await seal(tokens) });
  }
  return { provider: oauthProvider, email: acct.email, accessToken: tokens.accessToken };
}
