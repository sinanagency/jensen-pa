import { NextRequest } from "next/server";
import { streamClaude, Msg } from "@/lib/anthropic";
import { mentorSystem } from "@/lib/persona";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages, brief, entities, docs } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("messages required", { status: 400 });
    }
    const system = mentorSystem({ brief, entities, docs });
    const turns: Msg[] = messages
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-20);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const delta of streamClaude({ system, messages: turns, maxTokens: 1800 })) {
            controller.enqueue(encoder.encode(delta));
          }
        } catch (e: any) {
          controller.enqueue(encoder.encode(`\n\n[I hit an error reaching my reasoning: ${e?.message || e}]`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e: any) {
    return new Response(`error: ${e?.message || e}`, { status: 500 });
  }
}
