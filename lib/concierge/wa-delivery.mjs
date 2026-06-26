// WhatsApp delivery-status capture (KT #206576). Meta posts message-status
// updates (sent -> delivered -> read, or failed) to the SAME webhook as inbound
// messages, under value.statuses[]. jensen-pa used to ignore them, so it only
// ever knew Meta ACCEPTED a message (it got a wamid), never whether it reached
// the handset. That gap made the Sotiris non-delivery un-diagnosable in real
// time and let "delivered" be claimed off acceptance alone.
//
// Pure + side-effect free so the wall exercises the exact ranking + parsing prod
// uses (agent-clock pattern).

export const STATUS_RANK = { accepted: 0, sent: 1, delivered: 2, read: 3 };

// Monotonic lifecycle: only advance, never downgrade — Meta statuses can arrive
// out of order (a late "delivered" after a "read"). "failed" is recorded only if
// the message has not already reached delivered/read (a failure after delivery is
// stale noise we must not let overwrite a real delivery).
export function shouldApplyStatus(current, incoming) {
  if (!incoming) return false;
  if (incoming === "failed") return !(current === "delivered" || current === "read");
  const ci = STATUS_RANK[incoming];
  if (ci === undefined) return false;
  const cc = current === "failed" ? -1 : (STATUS_RANK[current] ?? -1);
  return ci > cc;
}

// Extract the status updates from a Meta webhook `value` object. Returns
// [{ wamid, status, at, error }], dropping anything without a wamid + status.
export function parseStatuses(value) {
  const arr = Array.isArray(value?.statuses) ? value.statuses : [];
  return arr
    .map((s) => ({
      wamid: s?.id || "",
      status: s?.status || "",
      at: s?.timestamp ? Number(s.timestamp) * 1000 : null,
      error:
        Array.isArray(s?.errors) && s.errors.length
          ? String(s.errors[0]?.title || s.errors[0]?.message || s.errors[0]?.code || "").slice(0, 200)
          : null,
    }))
    .filter((s) => s.wamid && s.status);
}
