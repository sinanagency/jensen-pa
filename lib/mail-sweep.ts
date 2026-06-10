// Mail autopilot. Pulls every connected mailbox, classifies new arrivals with the
// existing triage Haiku, and pushes a WhatsApp proposal to Jensen for every
// fresh email that needs a human reply. Idempotent: tracks seen unified-ids in
// kv so the same email never pings twice. The proposal includes the unified
// email id so when Jensen says "yes / send / lfg" the concierge LLM can dispatch
// reply_email(id, body, confirm:true) without inventing state.
//
// Send chokepoint: every outbound WhatsApp goes through sendTextAndLog (Law 2).
// Send constraint (Law 8 + Taona's "never auto reply"): this module NEVER sends
// mail itself. It only proposes drafts to WhatsApp and marks the email seen.
// The actual send happens later through the existing reply_email tool, which
// already gates on confirm:true.

import { aggregateInbox, type UMailSummary } from "@/lib/mail-provider";
import { triageInbox, type TriagedMail } from "@/lib/mail-triage";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { kvGet, kvSet } from "@/lib/db";
import { whoIs } from "@/lib/whatsapp";

const SEEN_KEY = "lr_mail_seen";
const SEEN_CAP = 500;

// Sender patterns we never propose drafts for, even if triage says needsReply.
// These are first-line defence against noise; triage's needsReply flag is the
// second line. A sender is filtered if ANY pattern matches.
const NOISE_PATTERNS: RegExp[] = [
  /\bno-?reply\b/i,
  /\bdonotreply\b/i,
  /\bjobalerts?-noreply\b/i,
  /@linkedin\.com$/i,
  /@.*facebookmail\.com$/i,
  /@.*instagram\.com$/i,
  /@.*googleplay-noreply/i,
  /@marketing\./i,
  /@notifications?\./i,
  /@email\./i,
  /@event\./i,
  /@editorial\./i,
  /@security\./i,
  /@registration\./i,
  /@drinks-intel\.com$/i,
  /@sevenrooms\.com$/i,
  /@.*gitex\.com$/i,
  /@.*linktr\.ee$/i,
  /@.*virginmobile\.ae$/i,
  /@.*wio\.io$/i,
];

function isNoise(fromEmail: string): boolean {
  const e = (fromEmail || "").toLowerCase();
  if (!e) return true;
  return NOISE_PATTERNS.some((re) => re.test(e));
}

type SeenMap = Record<string, number>;

async function loadSeen(): Promise<SeenMap> {
  return kvGet<SeenMap>(SEEN_KEY, {});
}

async function saveSeen(seen: SeenMap): Promise<void> {
  // FIFO eviction: keep newest SEEN_CAP entries by timestamp.
  const entries = Object.entries(seen);
  if (entries.length > SEEN_CAP) {
    entries.sort((a, b) => b[1] - a[1]);
    seen = Object.fromEntries(entries.slice(0, SEEN_CAP));
  }
  await kvSet(SEEN_KEY, seen);
}

// Build the WhatsApp proposal body. No em-dashes (Law 5), first person (Law 1).
function buildProposal(m: TriagedMail): string {
  const q = m.quadrant === 1 ? "Q1 (urgent, important)"
          : m.quadrant === 2 ? "Q2 (important)"
          : m.quadrant === 3 ? "Q3 (urgent only)"
          : "Q4";
  const fromLine = m.from && m.from !== m.fromEmail ? `${m.from} <${m.fromEmail}>` : (m.fromEmail || m.from);
  const lines = [
    "I noticed a new email that needs your eyes.",
    "",
    `From: ${fromLine}`,
    `Subject: ${m.subject}`,
    `Mailbox: ${m.accountEmail}`,
    `Priority: ${q}`,
    "",
    `What it says: ${m.summary}`,
    "",
    "My draft reply:",
    `"${m.draft.trim()}"`,
    "",
    "Reply 'yes' to send as is, 'change to: ...' to edit, or 'skip' to drop.",
    "",
    `(email_id: ${m.id})`,
  ];
  return lines.join("\n");
}

export type SweepResult = {
  ok: boolean;
  scanned: number;
  newUnseen: number;
  proposed: number;
  filteredNoise: number;
  notNeedingReply: number;
  seeded: boolean;
  errors?: string[];
};

// Pick the WhatsApp number to ping. Defaults to first owner (Jensen). When
// JENSEN_MODE=TRAINING, route to the admin number instead so Taona can shake
// the autopilot down without spamming Jensen.
function recipientNumber(): string | null {
  const raw = process.env.OWNER_WHATSAPP || "";
  const nums = raw.split(",").map((n) => n.trim()).filter(Boolean);
  if (nums.length === 0) return null;
  const training = (process.env.JENSEN_MODE || "").trim() === "TRAINING";
  if (training) {
    const admin = nums.find((n) => whoIs(n).role === "admin");
    if (admin) return admin;
  }
  const owner = nums.find((n) => whoIs(n).role === "owner");
  return owner || nums[0];
}

export async function sweepAndPropose(): Promise<SweepResult> {
  const errors: string[] = [];
  let aggregated: UMailSummary[] = [];
  try {
    // perAccount=25 picks up bursts; aggregateInbox already merges across all
    // connected mailboxes and sorts newest-first.
    aggregated = await aggregateInbox(25);
  } catch (e: any) {
    errors.push(`aggregate: ${e?.message || String(e)}`);
    return { ok: false, scanned: 0, newUnseen: 0, proposed: 0, filteredNoise: 0, notNeedingReply: 0, seeded: false, errors };
  }

  const seen = await loadSeen();
  const seededFirstRun = Object.keys(seen).length === 0;

  // Mark every fetched id as seen up front so a partial failure mid-loop never
  // re-pings already-handled mail on the next run.
  const now = Date.now();
  const unseen = aggregated.filter((m) => !(m.id in seen));
  for (const m of aggregated) seen[m.id] = now;
  await saveSeen(seen);

  // First run: seed only, don't propose. Otherwise a freshly-deployed cron
  // would dump 50 historical proposals into WhatsApp the first time it fires.
  if (seededFirstRun) {
    return { ok: true, scanned: aggregated.length, newUnseen: unseen.length, proposed: 0, filteredNoise: 0, notNeedingReply: 0, seeded: true, errors };
  }

  // Drop obvious noise BEFORE the triage call so we don't spend Haiku tokens on
  // LinkedIn job alerts and sevenrooms confirmations.
  const candidates = unseen.filter((m) => !isNoise(m.fromEmail));
  const filteredNoise = unseen.length - candidates.length;
  if (candidates.length === 0) {
    return { ok: true, scanned: aggregated.length, newUnseen: unseen.length, proposed: 0, filteredNoise, notNeedingReply: 0, seeded: false, errors };
  }

  let triaged: TriagedMail[] = [];
  try {
    triaged = await triageInbox(candidates);
  } catch (e: any) {
    errors.push(`triage: ${e?.message || String(e)}`);
    return { ok: false, scanned: aggregated.length, newUnseen: unseen.length, proposed: 0, filteredNoise, notNeedingReply: 0, seeded: false, errors };
  }

  const needsReply = triaged.filter((m) => m.needsReply && (m.draft || "").trim().length > 0);
  const notNeedingReply = triaged.length - needsReply.length;

  const to = recipientNumber();
  if (!to) {
    errors.push("OWNER_WHATSAPP not configured");
    return { ok: false, scanned: aggregated.length, newUnseen: unseen.length, proposed: 0, filteredNoise, notNeedingReply, seeded: false, errors };
  }

  let proposed = 0;
  for (const m of needsReply) {
    try {
      const body = buildProposal(m);
      const r = await sendTextAndLog(to, body, { party: "jensen" });
      if (r.ok) proposed++;
      else errors.push(`whatsapp send failed for ${m.id}`);
    } catch (e: any) {
      errors.push(`propose ${m.id}: ${e?.message || String(e)}`);
    }
  }

  return { ok: errors.length === 0, scanned: aggregated.length, newUnseen: unseen.length, proposed, filteredNoise, notNeedingReply, seeded: false, errors: errors.length ? errors : undefined };
}
