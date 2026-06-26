// Wall: WhatsApp delivery-status capture (KT #206576). The webhook records
// Meta's sent->delivered->read (or failed) lifecycle so "did it land?" is a
// column, not inferred from acceptance. These checks pin the monotonic ranking
// and the Meta-payload parsing the webhook runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldApplyStatus, parseStatuses, STATUS_RANK } from "../../lib/concierge/wa-delivery.mjs";

test("lifecycle only advances, never downgrades", () => {
  assert.equal(shouldApplyStatus(null, "sent"), true);
  assert.equal(shouldApplyStatus("sent", "delivered"), true);
  assert.equal(shouldApplyStatus("delivered", "read"), true);
  // out-of-order: a late 'delivered' after 'read' must NOT downgrade
  assert.equal(shouldApplyStatus("read", "delivered"), false);
  assert.equal(shouldApplyStatus("delivered", "sent"), false);
  assert.equal(shouldApplyStatus("read", "read"), false);
});

test("failed is recorded only before delivery, not after", () => {
  assert.equal(shouldApplyStatus(null, "failed"), true);
  assert.equal(shouldApplyStatus("sent", "failed"), true);
  assert.equal(shouldApplyStatus("delivered", "failed"), false); // already landed
  assert.equal(shouldApplyStatus("read", "failed"), false);
  // a real status can still advance past a failed state
  assert.equal(shouldApplyStatus("failed", "delivered"), true);
});

test("unknown status is ignored", () => {
  assert.equal(shouldApplyStatus("sent", "bogus"), false);
  assert.equal(shouldApplyStatus(null, ""), false);
  assert.ok(STATUS_RANK.read > STATUS_RANK.delivered);
});

test("parseStatuses pulls wamid, status, ms-timestamp and error from a Meta payload", () => {
  const value = {
    statuses: [
      { id: "wamid.AAA", status: "delivered", timestamp: "1782470000", recipient_id: "971528902032" },
      { id: "wamid.BBB", status: "failed", timestamp: "1782470005", errors: [{ code: 131047, title: "Re-engagement message" }] },
      { id: "", status: "sent" },            // no wamid -> dropped
      { id: "wamid.CCC", status: "" },        // no status -> dropped
    ],
  };
  const out = parseStatuses(value);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { wamid: "wamid.AAA", status: "delivered", at: 1782470000000, error: null });
  assert.equal(out[1].wamid, "wamid.BBB");
  assert.equal(out[1].status, "failed");
  assert.equal(out[1].error, "Re-engagement message");
});

test("a webhook with no statuses array yields nothing (it is an inbound, not a status)", () => {
  assert.equal(parseStatuses({ messages: [{ id: "x", from: "971" }] }).length, 0);
  assert.equal(parseStatuses(undefined).length, 0);
  assert.equal(parseStatuses({}).length, 0);
});
