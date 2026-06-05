// Voice-note transcription via OpenAI Whisper. WhatsApp voice notes arrive as
// OGG/Opus; Whisper handles that natively. Server-only.

export async function transcribeAudio(buf: Buffer, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: mime || "audio/ogg" });
  const filename = mime?.includes("ogg") ? "audio.ogg"
    : mime?.includes("mp3") || mime?.includes("mpeg") ? "audio.mp3"
    : mime?.includes("wav") ? "audio.wav"
    : mime?.includes("m4a") || mime?.includes("mp4") ? "audio.m4a"
    : "audio.bin";
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  // No language pin — Jensen may speak English, French (Mauritian background),
  // or a mix. Whisper auto-detects and that's safer than forcing en.
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  return (j?.text || "").trim() || null;
}
