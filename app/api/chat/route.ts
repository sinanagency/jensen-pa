import { NextRequest } from "next/server";
import { runConcierge } from "@/lib/concierge/loop";
import { senderFromToken } from "@/lib/accounts";
import { COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

// The portal chat is now the full concierge brain (tools + memory + grounding),
// the SAME runConcierge the WhatsApp worker calls (one-brain). It runs the tool
// loop to completion, then returns the final reply as a text/plain stream so the
// existing chat UI (which reads res.body) keeps working unchanged.
export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("messages required", { status: 400 });
    }
    const sender = await senderFromToken(req.cookies.get(COOKIE)?.value).catch(() => undefined);
    const { reply } = await runConcierge({ messages, channel: "portal", sender });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(reply));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e: any) {
    return new Response(`I hit an error: ${e?.message || e}`, { status: 200 });
  }
}
