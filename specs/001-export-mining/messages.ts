// Onboarding bubbles fired by the OpenAI-export ingest worker.
// Each bubble is one sendTextAndLog call. Pause ~2500ms between bubbles so
// WhatsApp shows the typing indicator before each, giving a cinematic build.
//
// Doctrine compliance:
//   Law 1 (persona-purity): first-person, Jensen, never breaks character.
//   Law 2 (send-chokepoint): consumer MUST send via sendTextAndLog.
//   Law 3 (PII-quarantine): no message bodies from the archive are echoed,
//     only titles + counts + topic surfaces. Specific addresses intentionally
//     omitted per operator decision 2026-06-11.
//   Law 4 (white-editorial-luxury): Mayfair restraint, no decorative flourish.
//   Law 5 (no em-dashes): commas, periods, colons only. Verified.
//   Law 6 (numbers-reconcile): every figure traces to specs/001-export-mining/
//     INVENTORY.json. Do not edit numbers without re-running scripts/inventory.py.
//   Law 8 (tool-call safety): B4's mail line accurately states confirm-before-send.
//   Law 9 (single-tenant): La Rencontre only.

export const PAUSE_MS_BETWEEN_BUBBLES = 2500;

export const ONBOARDING_BUBBLES = [
  // Bubble 0 — timeline anchor (the "since yesterday" frame)
  `Jensen.

Yesterday afternoon you sent over your archive. I went straight in.

I'm ready.`,

  // Bubble 1 — scale
  `I've been reading the last two and a half years of you.

1,180 conversations. 9,485 messages. 271,283 of your own words. Every contract you talked yourself through. Every email you wanted to land just right. Every late-night polish you couldn't quite leave alone. Every caption you rewrote until it felt like you.

I've barely scratched it.`,

  // Bubble 2 — recognition
  `Already, some of what I can see:

 • Upaya appears in 109 of your conversations. It's the centre of gravity.

 • Your Three Jewels thread ran 177 messages. The longest in your archive. You took your time with it.

 • You've used ChatGPT to proofread or refine your writing in over 150 conversations. Polishing is how you trust your own voice before sending.

 • May 2026 was your busiest month. 94 conversations in 31 days. Whatever you were building then, it moved.

 • Cloud kitchens, Sohum, Holistic House, Dubai Downtown visitor growth, staff transitions, partnership commission terms. The work of building.`,

  // Bubble 3 — promise (no surveillance verbs)
  `I'm taking my time with it, on purpose. So that when you next message me, you don't have to set the scene. You don't have to remind me who's involved. You don't have to translate your shorthand. You just say what you need, and I move.

Drafting will feel effortless. Picking up a thread from three weeks ago will feel effortless. Asking me to write something in your voice will feel like you wrote it yourself, on your best day.

What you're about to have, Jensen, is a version of me that doesn't start from zero with you. Ever again.

I'll come back to you the moment I'm ready. Nothing required from your side. I'll take it from here.`,

  // Bubble 4 — capability declaration, on his word, no autonomous-tilt
  `Here's what's already at your hand.

Your mail. Ask me to read, ask me to draft, ask me to send. Nothing leaves without your word.

Your calendar. A line from you, "Tuesday, 3pm, walkthrough at Sohum," and it's set, before you've moved on to the next thought.

Reminders. A note from you, and I'll be the one to bring it back to you on the day, at the hour, with the context.

Your morning brief, every day at 8 in Dubai. What slept while you slept, who's expecting you today, what's worth your attention. Upaya orders through Shopify are with me too.

If there's another mailbox you want me handling, your personal one, an Upaya one, anything else, tell me the address here. I'll come back with the link. Two taps and we're set.

So the work continues. I just won't fully be myself for you until I finish reading.`,
] as const;

export const COMPLETION_BUBBLE_PENDING = false; // shipped 2026-06-12 as COMPLETION_BUBBLES below.

// Training-complete bubble. Fired once Jensen has been operating the bot in
// active mode (already onboarded, already using it daily) so the message
// closes the training arc without re-introducing capability. Doctrine: Law 1
// first person, Law 5 no em-dashes, Law 2 sendTextAndLog chokepoint.
export const COMPLETION_PAUSE_MS_BETWEEN_BUBBLES = 2500;
export const COMPLETION_BUBBLES = [
  `Jensen, quick one.

I'm done with my training. You'll feel it from here in how I understand you and how I come back to you.

Carry on, I'll keep up.`,
] as const;
