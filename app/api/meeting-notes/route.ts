import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 45;

// A meeting transcript -> notes + action items, each routed to its Eisenhower
// quadrant (1 do first, 2 schedule, 3 delegate, 4 drop) so tasks land where they belong.
export async function POST(req: NextRequest) {
  try {
    const { transcript, title } = await req.json();
    if (!transcript?.trim()) return NextResponse.json({ error: "transcript required" }, { status: 400 });
    const out = await claudeJSON<{ summary: string; decisions: string[]; tasks: { title: string; quadrant: number }[] }>(
      [
        "You turn a meeting transcript into executive notes and action items for Jensen, an F&B consultant.",
        "For each action item assign an Eisenhower quadrant: 1 = urgent and important (do first), 2 = important not urgent (schedule), 3 = urgent not important (delegate), 4 = neither (drop).",
        NO_DASHES,
      ].join("\n"),
      `${title ? `Meeting: ${title}\n` : ""}Transcript:\n${transcript.slice(0, 24000)}\n\nReturn JSON: {"summary":"3 to 5 sentences","decisions":["..."],"tasks":[{"title":"action","quadrant":1}]}`,
      1400,
    );
    return NextResponse.json(out || { summary: "", decisions: [], tasks: [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
