# SPEC 003 — Finance as Personal Accountant

**Status:** scoped, build in next session
**Operator note 2026-06-12:** *"finance ... make it more robust it can do more things receive pdfs/invoice etc clacualte profit loss etc payable tax and generate reports and monthly expenses, it cna also do reccruing expense etc, basically a personal accoutnant, and do all things an accoutnatn can do, basically rpekace them."*

## Problem

The current `/finance` page is solid bookkeeping (income/expense entry, VAT position, corporate tax estimate, PDF receipt drop with LLM extract). It's a tracker. Jensen wants a personal accountant — proactive, recurring, reporting, doing the work he currently pays someone for.

## Outcome

When Jensen logs in next month, the platform has already:
- Logged his recurring expenses (rent, software, payroll, retainer fees out) automatically
- Categorised every transaction into a P&L
- Estimated his payable VAT for the quarter and corporate tax for the year
- Generated a one-page monthly statement he can send his auditor
- Flagged anomalies (a 4x normal expense, a missing recurring charge, an invoice never paid)

He stops paying a manual accountant.

## Scope (Phase 2.1, this spec)

1. **Recurring expenses table + UI**
   - `recurring_expenses` table (id, label, amount, vat_applies, day_of_month, category, entity_id, last_charged_at, status)
   - `/finance` panel: list recurring, add/edit, status pills (active/paused)
   - Daily cron at 03:00 UTC: for each active recurring whose day_of_month ≤ today's day AND last_charged_at < first-of-this-month, insert a finance row, update last_charged_at

2. **Categorise transactions**
   - Add `category` to `finance` table (rent, software, payroll, travel, professional fees, etc.)
   - LLM auto-categorisation on PDF drop (already in the path — just bind to category)
   - Filter pills on records: All / Income / Expense / by category

3. **P&L panel**
   - Monthly + quarterly + year-to-date
   - Per-entity breakdown (so Sohum revenue + costs, Panther separately, etc.)
   - Visual: simple revenue / cost / net bar, no chart noise

4. **Monthly statement generator**
   - "Download this month's statement" button
   - Branded PDF (same letterhead system as invoices): summary, transactions, VAT line, suggested next actions
   - Same `lib/pdf` pipeline as invoice (flowing HTML + headless Chrome, per the project's PDF memory)

5. **Anomaly + reminder flags**
   - On the page hero: 3 cards that surface alerts
     - "Office rent due 28 June (5 days)"
     - "Sohum retainer received Apr 27 + May 27, NOT June — chase?"
     - "Travel expense AED 4,200 on 3 Jun is 4× monthly average for that category"

## Out of scope (defer to Phase 2.2)

- Bank feed sync (Wio, Emirates NBD, ENBD direct integration)
- Multi-currency consolidation
- Wage runs / salary processing
- Reverse-charge VAT
- IFRS-grade compliance

## Effort estimate

| Block | Hours |
|---|---|
| Schema + migration | 0.5 |
| Recurring panel UI + add/edit | 1.5 |
| Daily cron + materialisation | 1 |
| Category column + filter pills + LLM auto-categorise binding | 1 |
| P&L panel | 1.5 |
| Monthly statement PDF (extends invoice letterhead) | 1.5 |
| Anomaly detection rules + hero cards | 1 |
| **Total** | **8 hrs** |

One full working session.

## Why deferred from "finish now"

This isn't a styling pass — it's a real accountant engine. Doing it in 30 minutes ships something broken. Doing it properly tomorrow ships something that actually replaces an accountant.
