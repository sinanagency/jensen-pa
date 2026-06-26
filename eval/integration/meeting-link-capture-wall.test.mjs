// Wall: deterministic meeting-link capture (KT #206573).
// Failure (25 Jun): Jensen sent "sotiris meeting tomorrow send me a reminder
// with this link: <teams url>". The bot replied "Teams link saved" but never
// wrote events.meeting_url, so today "send me the link" found nothing and the
// reminder went out linkless. The reminder cron ALREADY renders meeting_url; the
// missing half was capturing it. meetingUrlForWrite is the deterministic capture
// the dispatch seam runs on every create_event / update_event.

import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingUrlForWrite, extractMeetingLink } from "../../lib/digital-u.js";

const SOTIRIS = "sotiris meeting tomorrow send me a reminder with this link: https://teams.microsoft.com/meet/41145142143720?p=3nfr7UHTRBIV3r6UVa";
const LINK = "https://teams.microsoft.com/meet/41145142143720?p=3nfr7UHTRBIV3r6UVa";

test("captures the link from the operator's scheduling message", () => {
  assert.equal(extractMeetingLink(SOTIRIS), LINK);
  assert.equal(meetingUrlForWrite(undefined, SOTIRIS), LINK);
});

test("no link in the message means no write (never clobbers to null)", () => {
  assert.equal(meetingUrlForWrite(undefined, "move sotiris to 3pm"), undefined);
  assert.equal(meetingUrlForWrite(undefined, ""), undefined);
  assert.equal(meetingUrlForWrite(undefined, null), undefined);
});

test("an explicit link the model passed wins over the message", () => {
  assert.equal(meetingUrlForWrite("https://zoom.us/j/99887766", "no link in here"), "https://zoom.us/j/99887766");
  // explicit value that is wrapped in prose still resolves to the bare url
  assert.equal(meetingUrlForWrite("join here https://meet.google.com/abc-defg-hij", "ignored"), "https://meet.google.com/abc-defg-hij");
});

test("Zoom, Teams and Google Meet links are all recognised, trailing punctuation trimmed", () => {
  assert.equal(extractMeetingLink("here: https://us02web.zoom.us/j/123456789?pwd=AbCdEf."), "https://us02web.zoom.us/j/123456789?pwd=AbCdEf");
  assert.equal(extractMeetingLink("(https://meet.google.com/xyz-abcd-efg)"), "https://meet.google.com/xyz-abcd-efg");
  assert.equal(extractMeetingLink("link https://teams.live.com/meet/93021, thanks"), "https://teams.live.com/meet/93021");
});

test("a message with no meeting link at all returns null", () => {
  assert.equal(extractMeetingLink("can you send me the deck for upaya"), null);
  assert.equal(extractMeetingLink("https://example.com/not-a-meeting"), null);
});
