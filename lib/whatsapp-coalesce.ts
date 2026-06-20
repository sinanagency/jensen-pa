// Durable per-sender WhatsApp turn COALESCING for Dorje (jensen-pa).
// Ported from Sasa's proven fix (KT #327) per DORJE-COALESCING-HANDOFF.md.
//
// LIVE BUG (same one that hit Sasa): a sender fires "you're cool" then "thanks"
// as two quick WhatsApp messages and Dorje replies TWICE — two independent brain
// runs, one per inbound. The unit of work must be the conversational TURN (a
// burst), not the single message. brain-core's shouldProcess HAS a per-sender
// lock, but it is an IN-MEMORY Map (PROCESSING_LOCKS = new Map() in
// lib/brain-core/webhook-guard.js) that does NOT survive across Vercel
// serverless invocations, so it cannot coalesce the separate function calls.
// The claim here is DURABLE (Postgres-backed) instead.
//
// jensen-pa adaptation vs Sasa: jensen-pa is INLINE (no job queue) and has NO
// contact_id, so the claim is keyed by the SENDER PHONE. The chat store is
// chat_messages(role,content,party,ts) with NO direction/status column, so the
// burst is bounded by "all role='user' messages since the last role='assistant'"
// for this party (runConcierge persists the assistant reply, loop.ts:297) — the
// assistant reply is the natural turn boundary, no status flip needed.
//
// FAIL-OPEN (honesty law: never drop a turn, never leave a human un-replied):
// every DB touch is wrapped. If anything throws (table missing, query error),
// coalesceTurn returns { proceed:true, failOpen:true } with NO claim held, so the
// route falls straight through to the EXISTING single-message reply path. A
// coalescer bug can only ever degrade to a double-reply, never to silence.

import { admin } from "./db";

// How long the winner waits for the rest of a human's burst to land before it
// assembles the turn. WhatsApp bursts land within a few seconds; 7s covers
// "you're cool" + "thanks" without making the reply feel laggy. The route's
// maxDuration is 120s, so the hold is comfortably within budget, and a Meta
// retry during the hold is absorbed by the wa_seen dedup.
const SETTLE_MS = 7000;
// Claim TTL. A crashed winner's claim is overwritable past this, so a dropped
// invocation can never wedge a sender into permanent silence.
const CLAIM_TTL_MS = 90_000;
// Defensive cap on assembled burst text fed to the brain as one turn.
const MAX_BURST_CHARS = 6000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isUniqueViolation = (e: any): boolean => {
  const code = String(e?.code || "");
  const msg = String(e?.message || "");
  return code === "23505" || /duplicate key|unique/i.test(msg);
};

export type CoalesceOutcome = {
  // proceed: the route should run the brain for this invocation.
  proceed: boolean;
  // winner: true only when this invocation won the durable claim and assembled
  // the burst. false here means a loser (proceed:false) OR a fail-open
  // (proceed:true, winner:false, failOpen:true).
  winner: boolean;
  // failOpen: the coalescer degraded to the legacy single-message path because
  // of an error. The route proceeds normally; no claim is held.
  failOpen?: boolean;
  // command: when winner, the assembled burst text (all unanswered inbound from
  // this sender since the last reply, concatenated in order).
  command?: string;
  // claimedIds: the chat_messages rows folded into this turn (winner only).
  claimedIds?: string[];
};

// Best-effort coalesce signal for soak observability. Written to chat_messages on
// a SENTINEL party ("system") + channel "coalesce" so it is queryable
// (party=eq.system&channel=eq.coalesce) but is NEVER picked up by chatRecent
// (which reads party=jensen|taona), i.e. it cannot pollute the brain history.
async function emitCoalesce(kind: string, sender: string | null, payload: Record<string, any>): Promise<void> {
  try {
    await admin().from("chat_messages").insert({
      role: "system",
      content: `coalesce_${kind}: ${JSON.stringify({ s: sender ? sender.slice(-4) : null, ...payload })}`.slice(0, 400),
      channel: "coalesce",
      party: "system",
      ts: Date.now(),
    });
  } catch { /* best-effort; observability must never block or throw */ }
}

// The durable claim lives as a row in the EXISTING `kv` table, keyed by
// `coalesce:<sender>`. kv(key PRIMARY KEY, value jsonb) already exists, so this
// needs NO new table / no DDL / no Supabase dashboard access — the service key's
// PostgREST data layer is enough. The PK on `key` makes a concurrent second
// insert a 23505 unique_violation = the loser. expires_at is carried in the
// value for the steal-if-stale self-heal (KT #336, supersedes the wa_turn_claim
// table approach which could not be created on Jensen's Supabase account).
const claimKey = (sender: string) => `coalesce:${sender}`;

// Acquire the durable per-sender claim. Returns true if THIS invocation won it.
async function acquireClaim(db: any, sender: string, traceId: string | null): Promise<boolean> {
  const now = Date.now();
  const row = { key: claimKey(sender), value: { expires_at: now + CLAIM_TTL_MS, claimed_by: "whatsapp.route", trace_id: traceId } };
  // Fast path: insert. The PK on kv.key rejects a concurrent sibling => loser.
  const { error } = await db.from("kv").insert(row);
  if (!error) return true;
  if (!isUniqueViolation(error)) throw error; // schema-class error -> fail-open upstream
  // A claim already exists. If EXPIRED (a crashed prior winner), steal it so the
  // sender is never wedged into silence: delete the stale row, then re-insert.
  const { data: existing } = await db.from("kv").select("value").eq("key", claimKey(sender)).limit(1);
  const exp = existing && existing[0] ? Number(existing[0].value?.expires_at) : NaN;
  if (Number.isFinite(exp) && exp < now) {
    // Confirmed stale in JS; delete it and re-insert. The tiny race (two
    // invocations both stealing) degrades to a double-reply at worst, never silence.
    await db.from("kv").delete().eq("key", claimKey(sender));
    const { error: e2 } = await db.from("kv").insert(row);
    return !e2;
  }
  return false;
}

// Assemble the burst: ALL inbound (role='user') for this party SINCE the last
// reply (role='assistant'), chronological, concatenated. The assistant reply is
// the turn boundary, so once the winner replies the next burst starts cleanly.
async function assembleBurst(db: any, party: string): Promise<{ command: string; ids: string[] }> {
  const { data: lastAsst } = await db
    .from("chat_messages")
    .select("ts")
    .eq("party", party)
    .eq("role", "assistant")
    .order("ts", { ascending: false })
    .limit(1);
  const sinceTs: number = lastAsst && lastAsst[0] ? Number(lastAsst[0].ts) : 0;

  let q = db
    .from("chat_messages")
    .select("id,content,ts")
    .eq("party", party)
    .eq("role", "user")
    .order("ts", { ascending: true })
    .limit(20);
  if (sinceTs) q = q.gt("ts", sinceTs);
  const { data } = await q;
  const rows = (data || []) as { id: string; content: string | null }[];
  const ids = rows.map((r) => r.id);
  const command = rows
    .map((r) => String(r.content || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_BURST_CHARS);
  return { command, ids };
}

// The gate. Called inline in the webhook route, AFTER the inbound is saved and
// BEFORE the brain runs.
//   - winner  -> { proceed:true, winner:true, command, claimedIds }
//   - loser   -> { proceed:false, winner:false }            (route returns, no send)
//   - failOpen-> { proceed:true, winner:false, failOpen:true } (route replies to
//                 the single message it already has)
//
// `fallbackCommand` is the single-message text already resolved, used on the
// fail-open / empty-burst paths so the bot always has something to say. This
// function try/catches its own DB work and never throws; the route still wraps
// the call defensively (the fail-open seam).
export async function coalesceTurn(
  sender: string | null,
  party: string,
  traceId: string | null,
  fallbackCommand: string,
): Promise<CoalesceOutcome> {
  // No sender to key the claim on -> nothing durable to coalesce against.
  if (!sender) return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };

  const db = admin();
  let won = false;
  try {
    won = await acquireClaim(db, sender, traceId);
  } catch (e: any) {
    // Schema-class error (e.g. the kv table unreachable). FAIL-OPEN:
    // process this one message and reply, exactly like the pre-coalescer flow.
    await emitCoalesce("fail_open", sender, { stage: "acquire", error: String(e?.message || e).slice(0, 200) });
    return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };
  }

  if (!won) {
    // LOSER. Another invocation for this sender holds the claim and will fold
    // this message's text into its turn (the message is already in chat_messages,
    // so the winner's burst read sees it). Return without replying (exactly-once).
    await emitCoalesce("noop", sender, { reason: "another invocation holds the claim" });
    return { proceed: false, winner: false };
  }

  // WINNER. Settle so the rest of the human's burst lands, then assemble.
  try {
    await sleep(SETTLE_MS);
    const { command, ids } = await assembleBurst(db, party);
    // Empty burst read (rows already past a prior assistant boundary, or a
    // transient miss) -> fall back to the single message so we still reply.
    const finalCommand = command && command.trim() ? command : fallbackCommand;
    await emitCoalesce("winner", sender, { burst: ids.length, chars: finalCommand.length });
    return { proceed: true, winner: true, command: finalCommand, claimedIds: ids };
  } catch (e: any) {
    // Assembly failed AFTER we won. Release the claim so the next message can
    // recover, and fail-open on the single message (never silent).
    try { await db.from("kv").delete().eq("key", claimKey(sender)); } catch {}
    await emitCoalesce("fail_open", sender, { stage: "assemble", error: String(e?.message || e).slice(0, 200) });
    return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };
  }
}

// Release the durable claim. The route calls this AFTER the winner's reply is
// sent so a crash mid-brain leaves the claim to expire (TTL) rather than wedging
// the sender. Best effort: a failure here only risks a later harmless
// re-coalesce or a TTL wait, never silence.
export async function finishTurn(sender: string | null): Promise<void> {
  if (!sender) return;
  try {
    await admin().from("kv").delete().eq("key", claimKey(sender));
  } catch { /* best effort: TTL sweep / next acquire overwrite covers it */ }
}
