// Anti-fake-done rail. A cheap second pass checks that any claim of a completed
// action in the reply is backed by a tool that actually succeeded this turn.
// Fail-open: if the check itself errors, we don't block the reply.

import { claudeJSON } from "../anthropic";
import { COMPLETION_TOOLS } from "./tools";

type ToolRun = { name: string; ok: boolean };

export async function verifyReply(reply: string, runs: ToolRun[]): Promise<{ ok: boolean; issue?: string }> {
  // Fast path: if no completion-style verbs, skip.
  if (!/\b(done|created|added|saved|recorded|logged|booked|scheduled|filed|sent|updated|deleted|set|drafted)\b/i.test(reply)) {
    return { ok: true };
  }
  const succeeded = runs.filter((r) => r.ok && COMPLETION_TOOLS.has(r.name)).map((r) => r.name);
  try {
    const out = await claudeJSON<{ fabricated: boolean; issue?: string }>(
      "You verify an assistant reply against the tools it actually ran successfully this turn. " +
        "If the reply claims it completed a WRITE action (created/saved/recorded/sent/updated/deleted/scheduled/filed) that is NOT supported by a matching successful tool below, set fabricated=true and name the unsupported claim. " +
        "Drafting/showing/explaining without claiming it was saved is fine. Return JSON {fabricated:boolean, issue?:string}.",
      `Successful write tools this turn: ${succeeded.length ? succeeded.join(", ") : "(none)"}\n\nReply:\n${reply}`,
      300
    );
    if (out?.fabricated) return { ok: false, issue: out.issue || "claimed an action that did not run" };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
