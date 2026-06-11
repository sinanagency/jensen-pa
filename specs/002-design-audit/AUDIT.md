# jensen-pa Design + Information Architecture Audit

> Generated 2026-06-12. Reads code, not vibes. Each finding has evidence + fix.

## Executive summary

The platform was built quickly, mostly correctly at the component level, but it now violates its own doctrine in three load-bearing ways, and the information architecture has grown an attic.

**The three load-bearing problems:**

1. **Theme breaks Law 4 (white-editorial-luxury).** The codebase is on a dark, glassy, purple aesthetic. The doctrine explicitly forbids that. The 2026-06-10 memory `feedback_white_editorial_over_dark` recorded a similar dark page being rejected as "wack." The current portal is the same instinct, deployed.

2. **Information architecture has 21 user-facing pages.** A single-tenant concierge for one founder does not need 21 destinations. Three categories of overlap are eating cognitive space: writing surfaces (brain + notes + journal), time surfaces (tasks + calendar + meetings), and mail surfaces (inbox + mail).

3. **Tonight's ingest is half-invisible.** Of the four tables I populated, two surface in the existing UI (entities → /portfolio, contacts → /contacts via `assembleState`), one is hidden (876 `brain_facts` have no consumer page), and **268 docs are 100% invisible** because `assembleState()` hardcodes `docs: []` and the `/brain` page (mislabelled "Documents" in nav) stores its own client-uploaded files, not the server `docs` table.

Each is fixable. Below is the ranked list with code locations + the fix.

---

## P0 — must-fix before next user-facing change

### P0-1. Make the 268 server docs visible in the portal

**Evidence:** `lib/db.ts:assembleState()` returns `docs: []` always. Comment: *"docs live in their own server resource (large, see lib/docs server ops)."* `/api/docs` GET exists and returns `listServerDocs()`, but no page consumes the new `docs` table where the OpenAI-export work landed 268 rows. The `/brain` page (nav-labelled "Documents") consumes `/api/docs` BUT through a client-side cache (`lib/docs-client`) that was built before the server table was the source of truth.

**Why this matters:** Jensen logs in tomorrow expecting to see his 112 contracts, 28 proposals, 9 Upaya pitch decks, 33 documents, etc. They are in the database. They will not appear on screen.

**Fix:** New page `/app/docs/page.tsx` reading directly from `/api/docs`, grouped by `folder`. Filter pills: All / Contracts / Proposals / Decks / Operations / Pricing / Brand. Each card shows title, folder, doc_date, linked entity name (via join), and a download/open affordance. Remove the "Documents" alias on `/brain`; rename `/brain` to "Memory" since it actually holds brain_facts, not documents.

**Effort:** half-day. Page is ~200 lines; the API + data already exist.

---

### P0-2. Tighten the dark/purple execution to Mayfair grade

**OVERRIDE 2026-06-12, operator note:** Purple is part of his brand and stays. The doctrine's "white editorial luxury" applies to OTHER brands; jensen-pa keeps the dark-purple identity. The fix below is now about EXECUTION grade, not palette swap.

**Evidence:** `app/globals.css:1-10` opens with the comment *"Dark luxury. Black canvas, white and grey type, purple as a restrained accent."* That is the precise opposite of doctrine Law 4 (*"white editorial luxury, generous whitespace, sparing gold accents on white. Dark mode is opt-in, never default. No glassmorphism."*).

Token-level violations:

| What | Current | Should be |
|---|---|---|
| What | Current | Tighten to |
|---|---|---|
| Canvas | `#0a0a0c` near-black | KEEP (his brand) |
| Type | `#f6f6f8` white-on-dark | KEEP |
| Accent | `#7c6bb0` lavender / `#8b5cf6` violet | KEEP, use sparingly |
| Cards | `rgba(255,255,255,0.04)` glass | Tighter glass: less blur, hairline gold-purple border on hover only |
| Body bg | `radial-gradient` purple haze | Slow it down, single haze not double radial |
| Fonts | Space Grotesk + Cormorant Garamond | KEEP Cormorant for wordmarks. Replace Space Grotesk with Inter for body, keep Cormorant as serif accent. |
| Body bg layer | `<video autoPlay loop>` looping video | Replace looping video with a static low-poly PNG (the poster). Same visual, no shimmer. |

**Why this matters:** A guest at a Mayfair hotel sees the lobby first. The portal IS the lobby. Dark + purple + glass + ambient video reads "crypto startup" not "private concierge."

**Fix:** Rewrite the `:root` block in `globals.css` with the white token set. Update `app/layout.tsx` font imports (Space Grotesk → Inter, Cormorant Garamond → Fraunces). Remove the `<video>` background in `Shell.tsx`. Replace glass cards with solid cards: `background: #ffffff; border: 1px solid rgba(20,20,29,0.08);`. Remove `body::before` + `body::after` gradient layers. Keep the same structural CSS classes so individual pages don't need to be rewritten — just the tokens.

**Effort:** one full day. The token migration is mechanical; the visual tuning across 21 pages will need eyeball iteration.

---

### P0-3. Fold the writing surfaces

**Evidence:** Three pages all write text into `db.notes` or sibling tables:
- `/notes` — `useDB()`, `db.notes` filtered by `kind in ("note","idea","link")`
- `/journal` — `useDB()`, `db.notes` filtered by `kind === "journal"`
- `/brain` — client-side uploaded files (mislabelled "Documents")

Three nav targets, same conceptual space (his writing). Nav reads `Notes · Journal · Documents` which sounds like three places but is actually one with three filters.

**Fix:** One page, `/notes`, with tabs: *Notes · Journal · Ideas*. Move `/journal` to a tab inside `/notes`. Rename `/brain` to `/memory` and keep it as the brain_facts viewer (the bot's grounded memory). Add new `/docs` per P0-1 for the actual documents.

**Net change in nav targets:** writing surfaces go from 3 to 1.

**Effort:** half-day.

---

## P1 — fix before public launch

### P1-1. Fold the time surfaces

**Evidence:** Three pages all relate to time:
- `/tasks` — todos with Eisenhower quadrants
- `/calendar` — events from `db.events`
- `/meetings` — meeting transcription tool

**Fix:** Tasks and calendar collapse into one `/today` (which already exists at `/`). Meetings becomes a feature inside `/today` (a "Record" affordance that captures + transcribes a meeting and writes tasks back to today's list). Net: 3 → 1.

**Effort:** half-day for the nav consolidation; meetings page stays at `/meetings` for now since it has its own recording UX.

---

### P1-2. Fold the mail surfaces

**Evidence:** `/inbox` and `/mail` are both email surfaces. `/inbox` does 4-quadrant triage (Eisenhower). `/mail` does account management + reading. Different focus, same noun.

**Fix:** Single `/mail` page with two views toggled by a header pill: *Quadrants · All mail*. Rename nav to "Mail" only. `/inbox` redirects to `/mail`.

**Effort:** half-day.

---

### P1-3. Rationalise the nav

**Evidence:** `components/Shell.tsx:25-44` defines 5 pills + 2 groups × ~5-7 items each = 17 reachable destinations from the top bar. A concierge for one person should have ~7 primary destinations.

**Fix:** New IA, three pills + two folded menus:

```
Top pills (always visible):
  Today        — home, brief, today's tasks
  Concierge    — chat with Rencontre (was /mentor)
  Mail         — folded /inbox + /mail

Folded menus:
  Operate
    Tasks, Calendar, Finance, Store, Contacts, Portfolio
  Studio
    Documents (NEW, the 268), Memory (renamed /brain),
    Notes (folded /notes + /journal), Meetings, Generate,
    Invoice, Legal
```

Nav target count drops from 17 → 14, and "Documents" finally means documents.

---

### P1-4. Make brain_facts visible (or hide them)

**Evidence:** 877 `brain_facts` are queryable by the bot but have no UI. There IS a `/memory` route but it shows `listMemory()` from `lib/concierge/brain.ts`, which DOES return brain_facts. Need to verify whether the 877 archive_facts surface or whether the page filters them out.

**Fix:** Read `/app/memory/page.tsx`. If it filters by `kind=fact|directive` only and excludes `archive_fact`, add the new kind. Add a section header *"From your archive"* and group those 877 separately so they don't drown the directives.

**Effort:** one hour.

---

## P2 — quality nits that compound

### P2-1. Remove the looping background video

**Evidence:** `components/Shell.tsx:84-89` renders a fixed-position `<video autoPlay muted loop>` behind every page. Doctrine doesn't explicitly ban video bg, but Mayfair restraint does. A printed menu doesn't shimmer.

### P2-2. Quadrant colors lean strong

**Evidence:** Q2 (the growth zone) is `#8b5cf6` violet. With the white-canvas migration, this becomes hard to harmonise. Either keep quadrant colors muted but distinct (use desaturated jewel tones at ~30% chroma) or drop colors and use weight/size to differentiate quadrants.

### P2-3. 17KB globals.css with no module structure

**Evidence:** `app/globals.css` is one big file. Easy to bit-rot. With the theme migration, this is the right time to split:
- `globals.css` — reset + tokens only
- `nav.css` — Shell + topbar
- `cards.css` — card patterns
- `forms.css` — inputs + buttons
- Per-page CSS for anything truly local

### P2-4. Icon library is full Lucide

**Evidence:** Every page imports 6-10 icons from lucide-react. That's fine — but the icons are 1.8 stroke which reads heavy on white. Drop to 1.2 stroke for the new theme. One-line global change.

### P2-5. Generic "Loading…" instead of placeholders

**Evidence:** Most pages do `if (!db) return <Shell><div className="muted">Loading…</div></Shell>`. A Mayfair concierge doesn't say "loading." Use shimmer-skeletons of the actual layout. (Stripe does this. So does Linear.)

### P2-6. Modals lack a single design

**Evidence:** Several pages use ad-hoc modals (Portfolio's add-form, Contacts' scan-card, Legal's blueprint). Worth unifying into one Sheet component (Linear-style slide-over from right edge).

---

## Recommended migration order

| Phase | Scope | Effort | Unlocks |
|---|---|---|---|
| 1 | P0-1: build `/docs` page + nav fix | half-day | Jensen sees his 268 docs |
| 2 | P0-2: theme tokens swap | full day | Mayfair grade visual |
| 3 | P0-3: fold notes/journal/brain into Memory + Notes | half-day | Cleaner nav |
| 4 | P1-1 + P1-2: fold time + mail surfaces | one day | 21 pages → ~12 pages |
| 5 | P1-3: nav restructure | half-day | 17 nav targets → 14 |
| 6 | P1-4: surface brain_facts | one hour | Memory page reflects all 877 facts |
| 7 | P2 nits | rolling | Polish |

**Total to get from current → posh-and-top-notch:** roughly 3-4 working days.

---

## What's NOT broken (worth keeping)

- The `Shell.tsx` structural layout (header, pills, groups, content area) is sound. The CSS *tokens* are wrong; the CSS *structure* is fine.
- The `useDB()` + `lib/store.ts` + `/api/state` round-trip is well-designed (server-of-truth, client mirror for first paint). Don't replace it.
- The hybrid retrieval brain (`lib/concierge/brain.ts`) is excellent and doesn't need a single line changed.
- The send-chokepoint pattern (`lib/sendTextAndLog.ts`) holds the doctrine cleanly.
- The font loading approach (next/font, three families, CSS variables) is the right pattern. Just swap which fonts get loaded.
- The cron infrastructure + webhook whitelist in middleware is solid.

The bones are good. The clothes are wrong, and the wardrobe is overstocked.
