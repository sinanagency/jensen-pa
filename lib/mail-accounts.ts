// Connected mailboxes (multi-account) for the portal. Stored in Supabase kv under
// "mail_accounts": public fields in the clear, OAuth tokens sealed (AES-GCM).
// Tokens auto-refresh on use. Server-only.

import { kvGet, kvSet } from "./db";
import { seal, open } from "./secretbox";
import { Provider, TokenSet, refreshToken } from "./oauth";

const KEY = "mail_accounts";

type StoredAccount = {
  id: string;
  provider: Provider;
  email: string;
  createdAt: number;
  enc: string; // sealed TokenSet
};

export type PublicAccount = { id: string; provider: Provider; email: string; createdAt: number };

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `acc_${Date.now().toString(36)}`; }
}

async function all(): Promise<StoredAccount[]> {
  return kvGet<StoredAccount[]>(KEY, []);
}
async function save(list: StoredAccount[]): Promise<void> {
  await kvSet(KEY, list);
}

export async function listAccounts(): Promise<PublicAccount[]> {
  return (await all()).map(({ id, provider, email, createdAt }) => ({ id, provider, email, createdAt }));
}

// Add or replace by (provider, email) so re-connecting the same mailbox updates tokens.
export async function upsertAccount(provider: Provider, email: string, tokens: TokenSet): Promise<PublicAccount> {
  const list = await all();
  const enc = await seal(tokens);
  const existing = list.find((a) => a.provider === provider && a.email.toLowerCase() === email.toLowerCase());
  let acct: StoredAccount;
  if (existing) {
    existing.enc = enc;
    acct = existing;
  } else {
    acct = { id: uid(), provider, email, createdAt: Date.now(), enc };
    list.push(acct);
  }
  await save(list);
  return { id: acct.id, provider: acct.provider, email: acct.email, createdAt: acct.createdAt };
}

export async function removeAccount(id: string): Promise<void> {
  await save((await all()).filter((a) => a.id !== id));
}

// Return a valid access token for an account, refreshing + persisting if expired.
export async function freshToken(id: string): Promise<{ provider: Provider; email: string; accessToken: string }> {
  const list = await all();
  const acct = list.find((a) => a.id === id);
  if (!acct) throw new Error("Mailbox not found.");
  let tokens = await open<TokenSet>(acct.enc);
  if (!tokens) throw new Error("Mailbox needs reconnecting.");

  if (tokens.expiresAt <= Date.now()) {
    if (!tokens.refreshToken) throw new Error("Mailbox needs reconnecting (no refresh token).");
    tokens = await refreshToken(acct.provider, tokens.refreshToken);
    acct.enc = await seal(tokens);
    await save(list);
  }
  return { provider: acct.provider, email: acct.email, accessToken: tokens.accessToken };
}
