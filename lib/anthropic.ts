// Claude brain for La Rencontre. Raw fetch (no SDK), with prompt caching on the
// system prompt so the grounded persona + context are cheap across a conversation.

const API = "https://api.anthropic.com/v1/messages";
export const OPUS = "claude-opus-4-8";
export const SONNET = "claude-sonnet-4-6";
export const HAIKU = "claude-haiku-4-5-20251001";

// Jensen's hard style rule, mirrored from Taona's: never use dashes as punctuation.
export const NO_DASHES =
  "Never use the dash characters em dash or en dash, and do not use a hyphen as a sentence break or aside. Use commas, periods, colons, or parentheses instead. Normal hyphenated words are fine.";

function key(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error("ANTHROPIC_API_KEY is not set");
  return k;
}

export type Msg = { role: "user" | "assistant"; content: string };

type CallOpts = {
  system: string;
  messages: Msg[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

// Non-streaming. Returns the text. Caches the system block.
export async function askClaude(opts: CallOpts): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": key(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || SONNET,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.4,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: opts.messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  return (data?.content?.[0]?.text || "").trim();
}

// Vision OCR: read an image (a photographed or scanned invoice, a menu, a card)
// into clean text so it can live in the document brain. Returns "" on failure.
export async function readImage(base64: string, mediaType: string): Promise<string> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Transcribe everything readable in this document or image into clean text. If it is an invoice or receipt, capture vendor, date, line items, amounts, totals, and any VAT or tax. Output only the transcribed content, no commentary." },
          ],
        }],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data?.content?.[0]?.text || "").trim();
  } catch {
    return "";
  }
}

// JSON helper for tool-like extraction.
export async function claudeJSON<T = any>(system: string, user: string, maxTokens = 1500): Promise<T | null> {
  const text = await askClaude({
    system: system + "\nReturn ONLY valid minified JSON, no prose, no code fences.",
    messages: [{ role: "user", content: user }],
    maxTokens,
  });
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]) as T; } catch { return null; } }
    return null;
  }
}

// Streaming for the chat hero. Yields text deltas.
export async function* streamClaude(opts: CallOpts): AsyncGenerator<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": key(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || SONNET,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.5,
      stream: true,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: opts.messages,
    }),
  });
  if (!res.ok || !res.body) {
    const body = res.body ? await res.text() : "";
    throw new Error(`Claude stream ${res.status}: ${body.slice(0, 400)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          yield evt.delta.text as string;
        }
      } catch { /* ignore keepalive / partial */ }
    }
  }
}
