// Server-only account store. Lives in the Supabase `kv` table under "accounts"
// (one source of truth, same as the rest of state). Passwords are PBKDF2-SHA256
// hashed with a per-account salt — we never store or log the raw password.
// Used ONLY from the nodejs /api/auth route (node:crypto), never from Edge/client.

import { pbkdf2Sync, randomBytes, timingSafeEqual as tEq, randomUUID } from "node:crypto";
import { kvGet, kvSet } from "./db";

export type Role = "admin" | "owner";
export type Account = {
  id: string;
  name: string;
  email: string;
  role: Role;
  salt: string; // hex
  hash: string; // hex
  createdAt: number;
};
// what we hand back to the client — never the salt/hash
export type SafeAccount = Pick<Account, "id" | "name" | "email" | "role">;

const KEY = "accounts";
const ITER = 120_000;
const KEYLEN = 32;

function hashPw(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, ITER, KEYLEN, "sha256").toString("hex");
}

export function makeHash(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: hashPw(password, salt) };
}

export function verifyPw(password: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashPw(password, salt), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && tEq(a, b);
}

export async function getAccounts(): Promise<Account[]> {
  return kvGet<Account[]>(KEY, []);
}

async function saveAccounts(list: Account[]): Promise<void> {
  await kvSet(KEY, list);
}

const norm = (s: string) => s.trim().toLowerCase();

// Login identifier matches either email or name (case-insensitive).
export async function findAccount(identifier: string): Promise<Account | null> {
  const id = norm(identifier);
  const list = await getAccounts();
  return list.find((a) => norm(a.email) === id || norm(a.name) === id) || null;
}

export function toSafe(a: Account): SafeAccount {
  return { id: a.id, name: a.name, email: a.email, role: a.role };
}

export async function hasOwner(): Promise<boolean> {
  return (await getAccounts()).some((a) => a.role === "owner");
}

export async function createAccount(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): Promise<Account> {
  const list = await getAccounts();
  const taken = list.some(
    (a) => norm(a.email) === norm(input.email) || norm(a.name) === norm(input.name)
  );
  if (taken) throw new Error("An account with that email or name already exists.");
  const { salt, hash } = makeHash(input.password);
  const acct: Account = {
    id: randomUUID(),
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    salt,
    hash,
    createdAt: Date.now(),
  };
  await saveAccounts([...list, acct]);
  return acct;
}

// Seed/replace the admin account (idempotent — used by the seed script).
export async function upsertAdmin(name: string, email: string, password: string): Promise<void> {
  const list = await getAccounts();
  const rest = list.filter((a) => a.role !== "admin");
  const { salt, hash } = makeHash(password);
  const admin: Account = {
    id: randomUUID(),
    name: name.trim(),
    email: email.trim(),
    role: "admin",
    salt,
    hash,
    createdAt: Date.now(),
  };
  await saveAccounts([admin, ...rest]);
}
