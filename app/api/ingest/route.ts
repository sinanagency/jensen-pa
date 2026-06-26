// The meeting-bot's callback endpoint. When a Digital Jensen capture finishes,
// the meeting-bot POSTs the transcript + notes here. We extract Eisenhower
// tasks, file them in Supabase (dedup-aware via ops.createTask), then WhatsApp
// Jensen a summary in his own first-person voice via the send-chokepoint.
//
// Auth: x-api-key must match INGEST_KEY env. Body shape (success):
//   { id, title, transcript, notes, durationSec, source }
// Body shape (failure):
//   { id, title, error, source }
//
// 2026-06-12 (KT #234): added outcome classifier. The Zomato call at 17:00
// had the bot attended-and-recording but Jatin never spoke. The old code
// path called the extractor on a near-empty transcript, got a hallucinated
// summary, and shipped "I finished {title} and I have the notes for you"
// to Jensen. Now: classify the transcript first. If empty (short audio +
// thin transcript), skip the extractor entirely and ship a single
// ask-once-then-silent message instead, marking events.outcome='empty'
// so the rest of the system knows not to re-probe.
//
// Doctrine touchpoints:
// - Law 1 (persona-purity): WhatsApp summary is first-person Jensen.
// - Law 2 (send-chokepoint): outbound goes through sendTextAndLog.
// - Law 5 (no em-dashes): NO_DASHES rule in the extraction prompt + a final
//   strip on the WhatsApp body for belt-and-braces.
// - Law 7 (source-of-truth): tasks land in Supabase tasks table, the canonical
//   store. No side-tables.

import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";
import { setPendingMeetingTasks, clearPendingMeetingTasks } from "@/lib/concierge/ops";
import { orderProposedTasks, buildMeetingBubbles } from "@/lib/concierge/meeting-proposal.mjs";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { sbHeaders, sbRest } from "@/lib/db";
import { classifyOutcome, buildEmptyOutcomeMessage, isTerminalOutcome, type MeetingOutcome } from "@/lib/meeting-outcome";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingNotes = {
  summary?: string;
  decisions?: string[];
  topics?: string[];
  attendees?: string[];
  actions?: { who?: string; what?: string; due?: string }[];
};
type ExtractedTask = { title: string; quadrant: 1 | 2 | 3 | 4 };

function ownerJensenNumber(): string | null {
  // Default identity is canonical; OWNER_WHATSAPP also lists Jensen but is
  // comma-separated (Jensen + Taona). Pick Jensen specifically: first entry
  // that is NOT Taona's developer number.
  const TAONA = "971501168462";
  const raw = process.env.OWNER_WHATSAPP || "";
  const digits = raw.split(",").map((n) => n.replace(/[^0-9]/g, "")).filter(Boolean);
  const jensen = digits.find((d) => d !== TAONA);
  return jensen || "971528902032";
}

function stripDashes(s: string): string {
  return String(s || "").replace(/—/g, ", ").replace(/–/g, ", ");
}

// Best-effort write of events.outcome. Schema migration events_outcome.sql
// added the column with a CHECK constraint. We swallow errors so a Supabase
// glitch never blocks the WhatsApp ack to Jensen (Law 2: send happens first,
// state-write second). The id passed in is the meeting-bot's `body.id` which
// is the same id the dispatcher picked up from events.id at queue time.
// classifyOutcome + buildEmptyOutcomeMessage live in lib/meeting-outcome.ts
// because Next.js App Router route files can only export route handlers, not
// arbitrary helpers, and the verify script needs to import them.
async function setEventOutcome(id: string, outcome: MeetingOutcome | "awaiting_human_verdict" | "resolved_by_email"): Promise<void> {
  if (!id) return;
  try {
    const res = await fetch(sbRest(`events?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ outcome }),
    });
    if (!res.ok) {
      // Don't throw, just log: a missing row or constraint mismatch must not
      // break the ack to Jensen. The fallback is the system stays in the
      // old null-outcome state, which the old code already handled.
      console.warn("setEventOutcome: PATCH failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("setEventOutcome: exception", e);
  }
}

// Read the current outcome for an event id so the max-1-retry guard can
// short-circuit a duplicate callback. Returns null on miss/error so the
// caller's default path runs (fail-open on read: better one extra WhatsApp
// than a silent drop of a legitimate first capture).
async function getEventOutcome(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const res = await fetch(sbRest(`events?id=eq.${encodeURIComponent(id)}&select=outcome&limit=1`), {
      headers: sbHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const v = rows[0]?.outcome;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.INGEST_KEY && req.headers.get("x-api-key") !== process.env.INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const id = String(body?.id || "").slice(0, 80);
    const title = String(body?.title || "Untitled meeting").slice(0, 200);
    // Use the dispatcher's phone from the callback query param if available,
    // then from the body payload (zanii-meetingbot passes it in newer deploys),
    // otherwise fall back to ownerJensenNumber().
    const dispatchPhone = (req.nextUrl.searchParams.get("phone") || body?.phone || "").replace(/[^0-9]/g, "");

    // Max-1-retry guard. If the meeting-bot calls back for an event whose
    // outcome is already terminal (we have already shipped Jensen one ack),
    // short-circuit. See lib/meeting-outcome.ts isTerminalOutcome for the
    // policy. This catches the 2026-06-12 Zomato pattern where three empty-
    // outcome probes landed within 55 minutes for the same events.id.
    if (id) {
      const existing = await getEventOutcome(id);
      if (isTerminalOutcome(existing)) {
        return NextResponse.json({ ok: true, mode: "already-acked", meetingId: id, outcome: existing });
      }
    }

    // Lifecycle pings (KT #362, opt-in via dispatch lifecycle:true). These land
    // BEFORE the terminal callback and carry no transcript and no error, so they
    // must be handled before the error/empty branches (otherwise a join ping would
    // wrongly trip the empty-capture path). Fired at most once each by the engine.
    // Not a terminal outcome, so we never write events.outcome here, and the real
    // notes callback still flows through.
    // Gate on event PRESENCE (not a two-string whitelist): handle the known ones,
    // and for ANY other event value acknowledge + return WITHOUT falling through
    // to the error/empty relay. A future/unknown lifecycle event must never be
    // mistaken for a failed capture and write a terminal outcome that then blocks
    // the real transcript callback via the max-1-retry guard. KT #362, hardened.
    if (body?.event) {
      if (body.event === "joined" || body.event === "waiting") {
        const to = dispatchPhone || ownerJensenNumber();
        const msg = stripDashes(
          body.event === "joined"
            ? `I am in ${title} now. I will send you the summary and the action items here when it wraps.`
            : `I am at the door for ${title}, waiting to be let in from the meeting waiting room. Please admit Digital Jensen so I can join and take the notes.`,
        );
        if (to) await sendTextAndLog(to, msg, { party: "jensen" });
      }
      return NextResponse.json({ ok: true, mode: `lifecycle-${body.event}` });
    }

    // Failure path: meeting-bot couldn't capture (waiting room, password, etc).
    // WhatsApp Jensen the reason, write nothing to tasks.
    if (body?.error) {
      const reason = String(body.error).slice(0, 240);
      const fail = stripDashes(
        `I could not capture ${title}. Reason: ${reason}. If you send me the recording or transcript, I will still write the notes for you.`,
      );
      const to = dispatchPhone || ownerJensenNumber();
      if (to) await sendTextAndLog(to, fail, { party: "jensen" });
      return NextResponse.json({ ok: true, mode: "failure-relayed" });
    }

    const transcript = String(body?.transcript || "").trim();
    if (!transcript) {
      // KT #361/#362: a truly-empty capture must NOT be a silent 400 that leaves
      // Jensen with no word. Mirror the empty-outcome path: the bot connected but
      // came away with nothing (most often left in the waiting room). Tell Jensen
      // once and mark the outcome so the retry guard stops re-probing.
      const to = dispatchPhone || ownerJensenNumber();
      const durationSec = typeof body?.durationSec === "number" ? body.durationSec : undefined;
      if (to) await sendTextAndLog(to, buildEmptyOutcomeMessage(title, durationSec), { party: "jensen" });
      await setEventOutcome(id, "empty");
      return NextResponse.json({ ok: true, mode: "empty-capture-relayed", meetingId: id });
    }

    // KT #234: classify the meeting OUTCOME before calling the extractor.
    // An empty audio capture (Zomato 2026-06-12 incident) used to fall
    // through to the extractor + the "I finished + here are notes" canned
    // line, producing a hallucinated summary that broke trust. Now an empty
    // outcome ships a single ask-once message and writes events.outcome so
    // the rest of the system stops re-probing whether it happened.
    const incomingNotes: IncomingNotes = (body?.notes && typeof body.notes === "object") ? body.notes : {};
    const durationSec = typeof body?.durationSec === "number" ? body.durationSec : undefined;
    const outcome = classifyOutcome({
      transcript,
      durationSec,
      notesSummary: incomingNotes.summary,
    });
    if (outcome === "empty") {
      const to = dispatchPhone || ownerJensenNumber();
      const msg = buildEmptyOutcomeMessage(title, durationSec);
      if (to) await sendTextAndLog(to, msg, { party: "jensen" });
      await setEventOutcome(id, "empty");
      return NextResponse.json({ ok: true, mode: "empty-outcome", meetingId: id });
    }

    // Same extractor as /api/meeting-notes, kept inline so this route owns the
    // full contract (transcript -> tasks -> WhatsApp -> ack).
    const extracted = await claudeJSON<{
      summary: string;
      decisions: string[];
      tasks: ExtractedTask[];
    }>(
      [
        "You turn a meeting transcript into executive notes and action items for Jensen, an F&B consultant in Dubai.",
        "Assign each action item an Eisenhower quadrant: 1=do first (urgent and important), 2=schedule (important not urgent), 3=delegate (urgent not important), 4=drop (neither).",
        "Tasks must be concrete, single-sentence, starting with a verb. No vague 'follow up' style entries unless the transcript names what to follow up on.",
        NO_DASHES,
      ].join("\n"),
      `${title ? `Meeting: ${title}\n` : ""}Transcript:\n${transcript.slice(0, 24000)}\n\nReturn JSON: {"summary":"3 to 5 sentences in plain prose","decisions":["..."],"tasks":[{"title":"action","quadrant":1}]}`,
      1600,
    );

    const summary = stripDashes(String(extracted?.summary || ""));
    const decisions = (extracted?.decisions || []).map(stripDashes).filter(Boolean).slice(0, 8);
    const rawTasks = (extracted?.tasks || []).filter((t) => t && t.title && [1, 2, 3, 4].includes(t.quadrant as number));

    // PROPOSE, never auto-populate (KT #206574). Park the extracted tasks in kv
    // as a pending proposal; they land on the board ONLY when Jensen accepts via
    // accept_meeting_tasks. The summary goes out in MULTIPLE bubbles, ending with
    // a numbered proposal he can accept ("add all" / "add 1, 3") or skip.
    const orderedTasks = orderProposedTasks(rawTasks as any);
    if (orderedTasks.length) {
      await setPendingMeetingTasks({ title, proposedAt: Date.now(), tasks: orderedTasks }).catch(() => {});
    } else {
      // No items proposed: clear any stale proposal so an old one cannot be
      // accepted against the wrong meeting.
      await clearPendingMeetingTasks().catch(() => {});
    }

    const bubbles = buildMeetingBubbles({ title, summary, decisions, orderedTasks });
    const to = dispatchPhone || ownerJensenNumber();
    let msgOk = false;
    if (to) {
      for (const b of bubbles) {
        const r = await sendTextAndLog(to, b, { party: "jensen" });
        msgOk = !!r.ok || msgOk;
      }
    }

    // Mark the happened outcome only AFTER the ack has shipped. If every send
    // failed we leave outcome null so a manual retry isn't blocked by a stale
    // state.
    if (msgOk) await setEventOutcome(id, "happened");

    return NextResponse.json({
      ok: true,
      meetingId: id,
      proposedTaskCount: orderedTasks.length,
      autoCreated: false,
      decisionCount: decisions.length,
      bubbles: bubbles.length,
      whatsappOk: msgOk,
      outcome: "happened",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
