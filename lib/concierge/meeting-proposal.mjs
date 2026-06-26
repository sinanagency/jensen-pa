// Digital Jensen meeting wrap-up: multi-bubble summary + a task PROPOSAL that
// Jensen must accept (KT #206574). Before this, /api/ingest auto-created every
// extracted task and shipped one wall-of-text message. Operator's contract:
// summary in multiple bubbles, then propose tasks, nothing lands on the board
// until he accepts. Pure + side-effect-free so the wall exercises the exact
// strings and selection logic prod uses (agent-clock pattern).

const Q_LABEL = { 1: "Do first", 2: "Schedule", 3: "Delegate", 4: "Drop" };

function strip(s) {
  return String(s || "").replace(/[—–]/g, ", ");
}

// Stable order the proposed tasks by quadrant (1..4), preserving within-quadrant
// sequence. The numbering Jensen sees and the numbering accept_meeting_tasks
// resolves both index into THIS array, so they can never drift apart.
export function orderProposedTasks(tasks) {
  return (tasks || [])
    .filter((t) => t && t.title && [1, 2, 3, 4].includes(Number(t.quadrant)))
    .map((t) => ({ title: strip(t.title).slice(0, 200), quadrant: Number(t.quadrant) }))
    .map((t, i) => ({ ...t, _i: i }))
    .sort((a, b) => (a.quadrant - b.quadrant) || (a._i - b._i))
    .map(({ title, quadrant }) => ({ title, quadrant }));
}

// Build the ordered list of WhatsApp bubbles (each becomes its own message).
// Bubble 1: the wrap line + summary. Bubble 2 (optional): decisions. Bubble 3:
// the numbered task proposal with the accept instruction. NEVER creates tasks.
export function buildMeetingBubbles({ title, summary, decisions, orderedTasks } = {}) {
  const bubbles = [];
  const t = strip(title) || "the meeting";

  const head = [`I finished ${t} and I have the notes for you.`];
  const sum = strip(summary);
  if (sum) { head.push(""); head.push(sum); }
  bubbles.push(head.join("\n"));

  const dec = (decisions || []).map(strip).filter(Boolean).slice(0, 8);
  if (dec.length) {
    bubbles.push(["Decisions I noted:", ...dec.map((d) => `• ${d}`)].join("\n"));
  }

  const tasks = orderedTasks || [];
  if (tasks.length) {
    const lines = ["Here are the action items I pulled. Nothing goes on your board until you say so."];
    lines.push("");
    tasks.forEach((t, i) => lines.push(`${i + 1}. ${t.title} _(${Q_LABEL[t.quadrant] || "Schedule"})_`));
    lines.push("");
    lines.push("Reply *add all* to put them on your board, or tell me which numbers, like *add 1, 3*. Say *skip* to drop them.");
    bubbles.push(lines.join("\n"));
  } else {
    bubbles.push("No action items came out of this one. I have kept the notes for you.");
  }

  return bubbles.map(strip);
}

// Resolve an acceptance selection against the stored, ordered proposal.
// which === "all" -> every task. An array of 1-based indices -> just those
// (out-of-range and duplicate indices are ignored, never throw). Returns the
// chosen task objects in display order.
export function selectProposedTasks(orderedTasks, which) {
  const tasks = orderedTasks || [];
  if (!tasks.length) return [];
  if (which === "all" || which === undefined || which === null) return tasks.slice();
  const idx = Array.isArray(which) ? which : [which];
  const want = new Set(
    idx.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= tasks.length),
  );
  return tasks.filter((_, i) => want.has(i + 1));
}
