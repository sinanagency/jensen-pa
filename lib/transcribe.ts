// Voice-note transcription. Thin Jensen adapter over @sinanagency/intake's
// transcribeAudio primitive. WhatsApp voice notes arrive as OGG/Opus; Whisper
// handles that natively. Server-only.
//
// Signature preserved (Buffer in, Promise<string | null> out — null on missing
// key or empty result, so the WhatsApp handler can degrade gracefully).
// Intake's primitive takes base64 + opts and returns "" on failure, so we
// convert at the boundary and re-emit null for the legacy null contract.

import { transcribeAudio as intakeTranscribeAudio } from "./intake/index.js";

export async function transcribeAudio(buf: Buffer, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base64 = buf.toString("base64");
  const out = await intakeTranscribeAudio(base64, mime || "audio/ogg", { openaiKey: key });
  const trimmed = (out || "").trim();
  return trimmed || null;
}
