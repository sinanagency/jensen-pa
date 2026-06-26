// Deterministic "updated list" command (KT node #206540: a deterministic ROUTE
// for the action, not the LLM re-deciding the format every turn). The operator
// stated the contract verbatim on 2026-06-26: "when I say 'updated list' give me
// quadrants plus all upcoming reminders." Before this, the free-form brain led
// with "Today's Calendar", truncated the quadrants, and showed today-only
// reminders, forcing him to correct it three times in one thread.
//
// Pure + clock-free on purpose (agent-clock pattern): the caller passes tasks,
// events, and the Dubai `today`, so the SAME logic the bot runs is the logic the
// wall test exercises. Zero drift between proof and production.

const Q_LABELS = {
  1: "Q1 - Urgent + Important",
  2: "Q2 - Important, Not Urgent",
  3: "Q3 - Urgent, Not Important",
  4: "Q4 - Drop",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Whole-message intent match. TIGHT on purpose: it fires only when the message is
// essentially "(give me) (the/my) (full/updated/complete/...) list (general/everything)".
// It must NOT hijack a compound command ("updated list and add X") or a scoped
// query ("list tasks for Acme") — those still go to the brain.
export function isUpdatedListRequest(text) {
  let t = normalize(text);
  if (!t) return false;
  if (!/\blist\b/.test(t)) return false;
  // Any other action verb means it is a compound command, not a pure list request.
  if (/\b(add|create|new|remove|delete|drop|schedule|book|remind|reminder|send|email|move|mark|complete|completed|done|file|record|draft|update|change|rename|set|cancel|find|search|who|what|when|where|why|how)\b/.test(t)) return false;
  // Strip lead-ins, possessives, and known qualifiers. If "list" is all that is
  // left (optionally with a stray "everything"/"general"), it is a list request.
  t = t
    .replace(/\b(give|me|show|send|gimme|i|want|can|get|pull|up|please|now|thanks|the|my|a|an)\b/g, " ")
    .replace(/\b(full|fully|updated|update|complete|completed|whole|entire|general|current|latest|everything|with|of|all)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t === "list";
}

// YYYY-MM-DD -> a stable weekday/day/month label without timezone drift. Calendar
// dates carry no time-of-day, so anchor at UTC noon (never crosses a day boundary).
function prettyDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function reminderLabel(e, today, tomorrow) {
  const when = e.date === today ? "Today" : e.date === tomorrow ? "Tomorrow" : prettyDate(e.date);
  const time = e.time ? ` ${e.time}` : "";
  return `${when}${time} - ${e.title}`;
}

// The canonical render. WhatsApp formatting only (*single asterisks* for bold,
// "• " bullets). No em-dashes (the send chokepoint also strips them, belt + braces).
export function formatUpdatedList({ tasks, events, today, name } = {}) {
  const who = name || "Jensen";
  // Bucket every open task. A row with a missing/invalid quadrant falls into Q2
  // (the same default createTask uses) so a task is NEVER silently dropped from
  // the list, the whole point of "give me everything".
  const open = (tasks || [])
    .filter((t) => !t.done)
    .map((t) => ({ ...t, q: [1, 2, 3, 4].includes(Number(t.quadrant)) ? Number(t.quadrant) : 2 }));
  const lines = [`Here is your full list, ${who}.`];

  for (const q of [1, 2, 3, 4]) {
    lines.push("");
    lines.push(`*${Q_LABELS[q]}*`);
    const items = open.filter((t) => t.q === q);
    if (!items.length) lines.push("• Nothing here.");
    else for (const it of items) lines.push(`• ${it.title}`);
  }

  // Upcoming reminders = every FUTURE event plus today's not-yet-past events
  // (each event fires a reminder 5 min before start). Date-then-time ordered.
  const tomorrow = addDays(today, 1);
  const upcoming = (events || [])
    .filter((e) => e.date && (e.date > today || (e.date === today && e.status !== "past")))
    .slice()
    .sort((a, b) => (a.date === b.date ? String(a.time || "").localeCompare(String(b.time || "")) : a.date.localeCompare(b.date)));

  lines.push("");
  lines.push("*Upcoming Reminders*");
  if (!upcoming.length) lines.push("• Nothing scheduled.");
  else for (const e of upcoming) lines.push(`• ${reminderLabel(e, today, tomorrow)}`);

  return lines.join("\n");
}
