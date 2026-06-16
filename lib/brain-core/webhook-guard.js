// @sinanagency/brain-core/webhook-guard
//
// Cross-bot webhook dedup + media-pending buffer. Shared logic that every
// WhatsApp bot in the fleet (Jensen, Sasa, CTH) needs because Meta sends:
//   1. Duplicate webhooks with different wamids for the same message
//   2. Image+text as two separate webhooks (text arrives first)
//
// Each bot supplies adapters (seenByWamid, logToChat) that wire to its own
// Supabase tables. The primitive lives here, the adapters live in the bot.
//
// KT #302 (2026-06-16): ported from the hand-rolled concurrency guard in
// Jensen's route.ts that proved the pattern before the brain-core lift.

const PROCESSING_LOCKS = new Map();
const MEDIA_PENDING = new Map();
const MEDIA_WAIT_MS = 2500;

function register(name) {
    try {
        const { register: reg } = require("./tool-registry.js");
        reg({
            name: `webhook-guard.${name}`,
            category: "chokepoint",
            description: `Webhook dedup and media-pending buffer for bot ${name}`,
            registeredAt: new Date().toISOString(),
            kt: 302,
            run: async (input, adapters) => {
                return shouldProcess(name, input.sender, input.wamid, input.text, adapters);
            },
        });
    } catch {}
}

function resolveMediaRef(text) {
    return /^(this|here|see|attached|image|photo|pic|screenshot|look|check|this is|here is|see attached|see this)$/i.test(String(text || "").trim());
}

export async function shouldProcess(adapterName, sender, wamid, text, adapters) {
    // 1) Wamid dedup: atomic insert on wa_seen table
    if (wamid) {
        const seen = await adapters.seenByWamid(wamid);
        if (seen) return { action: "skip", reason: "duplicate_wamid" };
    }

    // 2) Concurrency guard: 2s processing lock per sender (Meta sends same
    //    message with different wamids, observed 2026-06-16 on Jensen).
    const now = Date.now();
    const lockKey = `${adapterName}::${sender}`;
    const lastSeen = PROCESSING_LOCKS.get(lockKey);
    if (lastSeen && now - lastSeen < 2000) {
        if (text) await adapters.logToChat(sender, text).catch(() => {});
        return { action: "skip", reason: "concurrent_duplicate" };
    }
    PROCESSING_LOCKS.set(lockKey, now);

    // 3) Media-pending buffer: short media-referencing text that arrives
    //    before the image webhook. Buffer and wait for the image.
    if (text && resolveMediaRef(text)) {
        MEDIA_PENDING.set(sender, { text, ts: now });
        await new Promise((resolve) => {
            let done = false;
            const iv = setInterval(() => {
                if (!MEDIA_PENDING.has(sender)) { clearInterval(iv); if (!done) { done = true; resolve(); } }
            }, 100);
            setTimeout(() => {
                if (done) return;
                clearInterval(iv); done = true;
                const buf = MEDIA_PENDING.get(sender);
                if (buf && buf.ts === now) MEDIA_PENDING.delete(sender);
                resolve();
            }, MEDIA_WAIT_MS);
        });
        if (!MEDIA_PENDING.has(sender)) return { action: "skip", reason: "merged_with_media" };
        MEDIA_PENDING.delete(sender);
    }

    return { action: "process" };
}

export function mediaArrived(sender) {
    // Called by the bot's media handler when an image/document webhook lands.
    // Returns the buffered text (or null) so the caller can combine it with
    // the caption. Clears the buffer so the text waiter resolves.
    const buf = MEDIA_PENDING.get(sender);
    if (!buf) return null;
    MEDIA_PENDING.delete(sender);
    return buf.text;
}

export function registerWebhookGuard() {
    // Auto-register on first import. The bot calls this once at startup to
    // add the primitive to the registry for introspection / dream cycle.
    register("default");
}

export function _resetForTest() {
    PROCESSING_LOCKS.clear();
    MEDIA_PENDING.clear();
}
