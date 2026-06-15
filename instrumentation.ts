// instrumentation.ts, Next.js boot hook.
// Runs ONCE per server process start (Vercel cold-start, dev server up).
//
// PURPOSE: boot-time schema-drift detection (KT #295, 2026-06-16). On cold
// start, probe every (table, columns) pair in JENSEN_SCHEMA_MANIFEST
// against the live DB. If drift detected, log loud to Vercel build logs +
// write a system row to chat_messages so the operator sees it on the next
// portal load.
//
// The webhook ingress fail-closed wall on Sasa (commit 8ecf930) catches
// the same class of drift at first inbound. Jensen does not yet have that
// wall (chatAppend swallows all errors). The boot guard here is the
// primary alarm until the ingress wall ships.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { admin } = await import("./lib/db");
    const { checkSchema, formatSchemaResult } = await import("./lib/brain-core/index.js");
    const { JENSEN_SCHEMA_MANIFEST } = await import("./lib/schema-manifest");

    // Cast: SupabaseClient's PostgrestFilterBuilder is THENable but typed as
    // a builder, not a Promise. checkSchema awaits it, which works at runtime.
    const result = await checkSchema({ db: admin() as any, manifest: JENSEN_SCHEMA_MANIFEST });
    if (result.ok) {
      console.log(`[schema-guard] ${formatSchemaResult(result)}`);
      return;
    }

    console.error(`[schema-guard] DRIFT DETECTED: ${formatSchemaResult(result)}`);

    // Write a system-role row to chat_messages audit channel so the next
    // portal load shows it (per the subagent's pattern in dispatch.ts for
    // wall refusals).
    try {
      const db = admin();
      await db.from("chat_messages").insert({
        role: "system",
        content: `dorje.schema_drift: ${formatSchemaResult(result)}`,
        channel: "boot",
        party: "jensen",
        ts: Date.now(),
      });
    } catch {}

    // Do NOT crash the cold start. Vercel would retry forever. The deploy
    // log carries the loud alert; portal carries the persistent breadcrumb.
  } catch (e: any) {
    try { console.error(`[schema-guard] guard self-failed: ${String(e?.message || e).slice(0, 300)}`); } catch {}
  }
}
