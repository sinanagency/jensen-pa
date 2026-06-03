import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 90;

// Audio (base64) -> Whisper transcript -> Claude summary + extracted tasks.
// Powers voice notes, the end-of-day debrief, and meeting notes.
export async function POST(req: NextRequest) {
  try {
    const { audioBase64, mime, filename } = await req.json();
    if (!audioBase64) return NextResponse.json({ error: "audio required" }, { status: 400 });
    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

    const bytes = Buffer.from(audioBase64, "base64");
    const blob = new Blob([bytes], { type: mime || "audio/webm" });
    const form = new FormData();
    form.append("file", blob, filename || "audio.webm");
    form.append("model", "whisper-1");

    const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
    });
    if (!tr.ok) return NextResponse.json({ error: `Transcription failed: ${(await tr.text()).slice(0, 200)}` }, { status: 502 });
    const { text: transcript } = await tr.json();
    if (!transcript?.trim()) return NextResponse.json({ transcript: "", summary: "", tasks: [] });

    const extracted = await claudeJSON<{ summary: string; tasks: string[] }>(
      `You turn a spoken note or meeting transcript into a tight summary and a list of concrete action items for Jensen, an F&B consultant. ${NO_DASHES}`,
      `Transcript:\n${transcript}\n\nReturn JSON: { "summary": "2 to 4 sentence summary", "tasks": ["actionable item", ...] }`,
      900,
    );
    return NextResponse.json({ transcript, summary: extracted?.summary || "", tasks: extracted?.tasks || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
