// iCalendar (RFC 5545) MEETING REQUEST builder. An .ics with METHOD:REQUEST,
// an ORGANIZER + ATTENDEE(s) is the universal meeting-invite format (iMIP):
// Outlook, Gmail, and Apple Mail all render it with Accept / Decline buttons.
// This works over plain SMTP from Jensen's own mailbox — NO Microsoft Graph,
// NO calendar API, NO extra OAuth scope. Times are emitted as UTC (Z) to avoid
// VTIMEZONE complexity; the caller converts Dubai local -> UTC.

function esc(s: string): string {
  // RFC 5545 text escaping: backslash, comma, semicolon, newline.
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Date -> iCal UTC stamp: 20260623T130000Z
function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Fold lines > 75 octets per RFC 5545 (CRLF + single leading space).
function fold(line: string): string {
  if (line.length <= 73) return line;
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}

export function buildInviteIcs(opts: {
  uid: string;
  organizerEmail: string; organizerName?: string;
  attendeeEmail: string; attendeeName?: string;
  summary: string; location?: string; description?: string;
  start: Date; end: Date; sequence?: number; method?: "REQUEST" | "CANCEL";
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//La Rencontre//Concierge//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method || "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${esc(opts.uid)}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(opts.start)}`,
    `DTEND:${icsUtc(opts.end)}`,
    `SUMMARY:${esc(opts.summary)}`,
    ...(opts.location ? [`LOCATION:${esc(opts.location)}`] : []),
    ...(opts.description ? [`DESCRIPTION:${esc(opts.description)}`] : []),
    `ORGANIZER;CN=${esc(opts.organizerName || opts.organizerEmail)}:mailto:${opts.organizerEmail}`,
    `ATTENDEE;CN=${esc(opts.attendeeName || opts.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    `SEQUENCE:${opts.sequence ?? 0}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Convert a Dubai-local date (YYYY-MM-DD) + time (HH:MM) to a UTC Date. Dubai is
// a fixed UTC+4 (no DST), so UTC = local - 4h. Reliable without a tz library.
export function dubaiLocalToUtc(dateYmd: string, hhmm: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd || "");
  const tm = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  if (!dm || !tm) return null;
  // Build the moment as if UTC, then subtract the +4 Dubai offset.
  const asUtc = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0);
  return new Date(asUtc - 4 * 60 * 60 * 1000);
}
