// Claude brain for La Rencontre. Thin Jensen adapters over the brain-core
// runClaude primitive. Jensen supplies its own API key (ANTHROPIC_API_KEY) and
// its own model ids (OPUS 4.8, SONNET 4.6). brain-core owns the wire format,
// prompt caching, and 429/529 backoff. We keep every existing exported function
// signature so callers don't break.
//
// Temperature note. brain-core's runClaude does not pass `temperature` in its
// request body today. Several Jensen callers depend on a non-default temperature
// (mail-triage at 0 for deterministic JSON, invoice/generate/brief in the 0.3-0.6
// band for warmth). When `opts.temperature` is set, we fall back to inline fetch
// so behavior is preserved. When it's omitted, we go through runClaude and pick
// up caching + 429/529 backoff for free. Streaming stays inline (brain-core
// ships non-streaming today).

import { runClaude } from "./brain-core/index.js";

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

// Inline non-streaming fallback for callers that need an explicit temperature.
// Same wire shape as brain-core's runClaude minus the cached tools array.
async function inlineAsk(opts: CallOpts): Promise<string> {
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
      temperature: opts.temperature,
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

// Non-streaming. Returns the text. Routes through brain-core's runClaude
// (prompt cache + 429/529 backoff) when temperature is unset; falls back to
// inline fetch when a caller pins temperature.
export async function askClaude(opts: CallOpts): Promise<string> {
  if (typeof opts.temperature === "number") return inlineAsk(opts);
  const data = await runClaude({
    model: opts.model || SONNET,
    anthropicKey: key(),
    system: opts.system,
    messages: opts.messages,
    tools: [],
    maxTokens: opts.maxTokens ?? 1500,
  });
  return (data?.content?.[0]?.text || "").trim();
}

// Vision OCR: read an image (a photographed or scanned invoice, a menu, a card)
// into clean text so it can live in the document brain. Returns "" on failure.
export async function readImage(base64: string, mediaType: string): Promise<string> {
  try {
    const data = await runClaude({
      model: SONNET,
      anthropicKey: key(),
      system: "",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Transcribe everything readable in this document or image into clean text. If it is an invoice or receipt, capture vendor, date, line items, amounts, totals, and any VAT or tax. Output only the transcribed content, no commentary." },
        ],
      }],
      tools: [],
      maxTokens: 1500,
    });
    return (data?.content?.[0]?.text || "").trim();
  } catch {
    return "";
  }
}

// OCR a PDF via Claude's native document block — for SCANNED / image-only PDFs
// (e.g. a passport scan) where the text-layer extractor (unpdf) gets nothing.
// Claude is the vetted endpoint (Law 3 PII) so a passport scan is safe to read
// here. Returns "" on failure so the caller can still file the doc. KT #348.
export async function readPdf(base64: string): Promise<string> {
  try {
    const data = await runClaude({
      model: SONNET,
      anthropicKey: key(),
      system: "",
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: "Transcribe everything readable in this document into clean text: all fields, names, numbers, dates, and any tables. If it is an ID/passport, capture the holder name, document number, dates and key fields. Output only the transcribed content, no commentary." },
        ],
      }],
      tools: [],
      maxTokens: 2000,
    });
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

// Streaming for the chat hero. Yields text deltas. brain-core doesn't ship a
// streaming primitive today, so this stays an inline fetch. When brain-core
// adds streamClaude, swap this over too.
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
