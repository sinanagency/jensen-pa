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
// Doctrine touchpoints:
// - Law 1 (persona-purity): WhatsApp summary is first-person Jensen.
// - Law 2 (send-chokepoint): outbound goes through sendTextAndLog.
// - Law 5 (no em-dashes): NO_DASHES rule in the extraction prompt + a final
//   strip on the WhatsApp body for belt-and-braces.
// - Law 7 (source-of-truth): tasks land in Supabase tasks table, the canonical
//   store. No side-tables.

import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";
import { createTask } from "@/lib/concierge/ops";
import { sendTextAndLog } from "@/lib/sendTextAndLog";

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

const QUADRANT_LABEL: Record<number, string> = {
  1: "Do first",
  2: "Schedule",
  3: "Delegate",
  4: "Drop",
};

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

function buildWhatsAppBody(opts: {
  title: string;
  summary: string;
  decisions: string[];
  tasks: ExtractedTask[];
}): string {
  const { title, summary, decisions, tasks } = opts;
  const q1 = tasks.filter((t) => t.quadrant === 1);
  const q2 = tasks.filter((t) => t.quadrant === 2);
  const q3 = tasks.filter((t) => t.quadrant === 3);

  const lines: string[] = [];
  lines.push(`I finished ${title || "the meeting"} and I have the notes for you.`);
  if (summary) { lines.push(""); lines.push(summary); }
  if (decisions.length) {
    lines.push("");
    lines.push("Decisions I noted:");
    decisions.slice(0, 5).forEach((d) => lines.push(`• ${d}`));
  }
  if (q1.length) {
    lines.push("");
    lines.push("On you, do first:");
    q1.slice(0, 6).forEach((t) => lines.push(`• ${t.title}`));
  }
  if (q2.length) {
    lines.push("");
    lines.push("To schedule when you can:");
    q2.slice(0, 4).forEach((t) => lines.push(`• ${t.title}`));
  }
  if (q3.length) {
    lines.push("");
    lines.push("Worth delegating:");
    q3.slice(0, 3).forEach((t) => lines.push(`• ${t.title}`));
  }
  lines.push("");
  lines.push("The full list is in your Tasks tab.");
  return stripDashes(lines.join("\n"));
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.INGEST_KEY && req.headers.get("x-api-key") !== process.env.INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const id = String(body?.id || "").slice(0, 80);
    const title = String(body?.title || "Untitled meeting").slice(0, 200);

    // Failure path: meeting-bot couldn't capture (waiting room, password, etc).
    // WhatsApp Jensen the reason, write nothing to tasks.
    if (body?.error) {
      const reason = String(body.error).slice(0, 240);
      const fail = stripDashes(
        `I could not capture ${title}. Reason: ${reason}. If you send me the recording or transcript, I will still write the notes for you.`,
      );
      const to = ownerJensenNumber();
      if (to) await sendTextAndLog(to, fail, { party: "jensen" });
      return NextResponse.json({ ok: true, mode: "failure-relayed" });
    }

    const transcript = String(body?.transcript || "").trim();
    if (!transcript) return NextResponse.json({ ok: false, error: "transcript required" }, { status: 400 });

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

    // Write tasks. createTask already soft-dedups by exact-title-while-open
    // (Memorae's worst bug). We collect ids for the ack.
    const created: { id: string; title: string; quadrant: number; deduped?: boolean }[] = [];
    for (const t of rawTasks.slice(0, 20)) {
      try {
        const r = await createTask({ title: stripDashes(t.title).slice(0, 200), quadrant: t.quadrant as number });
        created.push(r as any);
      } catch {
        // single-task failures don't block the whole batch
      }
    }

    // WhatsApp Jensen with the summary + the do-first list. sendTextAndLog
    // handles the chokepoint, the dash-strip, the audit log, and the dev-mode
    // reroute if this is Taona running the smoke harness.
    const to = ownerJensenNumber();
    let msgOk = false;
    if (to) {
      const text = buildWhatsAppBody({ title, summary, decisions, tasks: rawTasks as ExtractedTask[] });
      const r = await sendTextAndLog(to, text, { party: "jensen" });
      msgOk = !!r.ok;
    }

    return NextResponse.json({
      ok: true,
      meetingId: id,
      taskCount: created.length,
      decisionCount: decisions.length,
      whatsappOk: msgOk,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
