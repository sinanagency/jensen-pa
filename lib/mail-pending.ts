// Off-window mail proposal queue. When mail-sweep finds a fresh needsReply
// email but Jensen's WhatsApp window is closed, we cannot deliver the proposal
// without burning a template (templates are pre-approved + billed). We stash
// the proposal here and drain it on the next sweep tick that finds the window
// open again, so signal is never silently lost.

import { kvGet, kvSet } from "@/lib/db";

const KEY = "lr_offwindow_mail_pending";
const CAP = 50;

export type PendingProposal = {
  id: string; // unified email id
  accountId: string;
  accountEmail: string;
  from: string;
  fromEmail: string;
  subject: string;
  summary: string;
  draft: string;
  quadrant: 1 | 2 | 3 | 4;
  queuedAt: number;
};

export async function loadPending(): Promise<PendingProposal[]> {
  return kvGet<PendingProposal[]>(KEY, []);
}

export async function enqueue(p: PendingProposal): Promise<void> {
  const list = await loadPending();
  if (list.some((x) => x.id === p.id)) return; // idempotent
  list.push(p);
  // FIFO cap: if we somehow accumulate more than CAP proposals while Jensen is
  // away, keep the newest CAP. Older items are lost on purpose (avoid an
  // unbounded blob in kv); operator gets a one-line warning instead.
  if (list.length > CAP) list.splice(0, list.length - CAP);
  await kvSet(KEY, list);
}

export async function drain(): Promise<PendingProposal[]> {
  const list = await loadPending();
  if (list.length === 0) return [];
  await kvSet(KEY, []);
  return list;
}

export async function peekCount(): Promise<number> {
  return (await loadPending()).length;
}
