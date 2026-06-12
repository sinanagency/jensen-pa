// Minimal Langfuse trace helper. Wraps fire-and-forget around the existing
// raw-fetch Anthropic calls in lib/anthropic.ts and lib/concierge/loop.ts.
// Doctrine: never block delivery. A Langfuse outage MUST NOT slow Jensen
// down. Same instinct as mirrorToChatwoot in lib/chatwoot-mirror.ts.

let _langfuse: any = null;

function client() {
  if (_langfuse) return _langfuse;
  const host = process.env.LANGFUSE_HOST;
  const pk = process.env.LANGFUSE_PUBLIC_KEY;
  const sk = process.env.LANGFUSE_SECRET_KEY;
  if (!host || !pk || !sk) return null;
  try {
    const { Langfuse } = require("langfuse");
    _langfuse = new Langfuse({ baseUrl: host, publicKey: pk, secretKey: sk });
    return _langfuse;
  } catch {
    return null;
  }
}

type TraceArgs = {
  name: string;
  model: string;
  input: any;
  output?: string;
  startedAt?: number;
  endedAt?: number;
  usage?: { input?: number; output?: number };
  metadata?: Record<string, any>;
  party?: string;
};

export function traceLLM(args: TraceArgs): void {
  const lf = client();
  if (!lf) return;
  try {
    const trace = lf.trace({
      name: args.name,
      userId: args.party || "jensen",
      metadata: args.metadata || {},
    });
    trace.generation({
      name: args.name,
      model: args.model,
      input: args.input,
      output: args.output,
      startTime: args.startedAt ? new Date(args.startedAt) : undefined,
      endTime: args.endedAt ? new Date(args.endedAt) : undefined,
      usage: args.usage ? { input: args.usage.input, output: args.usage.output, unit: "TOKENS" } : undefined,
    });
    lf.flushAsync().catch(() => {});
  } catch {
    /* never block */
  }
}
