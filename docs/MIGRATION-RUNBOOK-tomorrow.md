# Tomorrow with Jensen — Migration Runbook (10 minutes)

> Goal: turn on the real "wait for the boss to confirm" layer (so the bot can't approve its own risky actions), and confirm Jensen's passport works end-to-end. Follow the steps in order. Nothing here can break the live bot — the new table is empty until I wire it on, and the code is already deployed in a fail-safe (switched-off) state.

---

## PART 1 — Run the database change (you, on Jensen's Supabase)

**Step 1.** Open this exact link in your browser (Jensen may need to be logged into Supabase, or do it on his screen):
👉 **https://supabase.com/dashboard/project/zsxynizxvxsamjbrhuwc/sql/new**
You should land on a page titled **SQL Editor** with an empty box to type in.

**Step 2.** Click inside the big empty box, then copy **everything** in the grey block below and paste it in:

```sql
create table if not exists pending_actions (
  id                  uuid primary key default gen_random_uuid(),
  party               text        not null,
  tool                text        not null,
  args                jsonb       not null default '{}'::jsonb,
  args_hash           text        not null,
  proposed_inbound_id text,
  status              text        not null default 'pending'
                        check (status in ('pending','confirmed','executed','expired','cancelled')),
  confirm_inbound_id  text,
  result              jsonb,
  error               text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists pending_actions_party_status_idx
  on pending_actions (party, status, created_at desc);

create unique index if not exists pending_actions_open_uniq
  on pending_actions (party, tool, args_hash)
  where status = 'pending';
```

**Step 3.** Click the green **Run** button (bottom-right of the box, or press **Cmd/Ctrl + Enter**).

**Step 4.** Look at the result strip at the bottom. You want to see **"Success. No rows returned"** (green). That's it — the table is created.
- If you instead see a red error, **stop** and send me the exact red text. Do not retry.

**Step 5 (proof it worked).** Clear the box, paste this, and Run it:
```sql
select count(*) from pending_actions;
```
You should get a result of **0**. (Zero is correct — it's a new empty table.)

**➡️ Send me back:** "migration done, count is 0" (or the red error text if it failed).

---

## PART 2 — Confirm Jensen's passport works (Jensen, on his phone)

**Step 6.** Have Jensen send his **passport** to the bot on WhatsApp (a PDF or a clear photo — same as he'd normally send a doc).

**Step 7.** The bot should reply something like *"I've vaulted your passport under identity, restricted..."* (an honest confirmation — not "I saved it" and then losing it).

**Step 8.** Have Jensen text the bot: **"send me my passport"**

**Step 9.** Within a few seconds the bot should send the **actual passport file** back into the chat.

**➡️ Send me back:** "passport vaulted + came back ✅" (or describe whatever the bot actually said/did).

---

## PART 3 — What I do (me, after you send back Part 1)

Once you confirm the migration ran, I:
1. Wire the confirm layer onto the live bot (it's already built + tested, switched-off, waiting on this table).
2. Run an independent skeptic on it (so it can't break a real "yes").
3. Deploy + prove it live, then tell you it's on.

That closes the biggest remaining hole — the bot approving its own risky actions (sending contracts, deletes) without a real confirmation from you.

---

### If anything looks wrong
Send me the exact text on screen (a screenshot is fine). Don't retry a failed step. Nothing here is irreversible — the worst case is "the table didn't get created," which changes nothing about the live bot.
