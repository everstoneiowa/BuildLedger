# Progress record

Version 0.1 — first working build. Updated 2026-11-23.

"Verified" below means one of: **T** = covered by the automated tests in `tests/workflows.test.ts` (19 tests, run
against both the embedded database and over the PostgreSQL wire protocol); **B** = exercised end-to-end through the
real UI in a browser (`tests/e2e/browser_walkthrough.py`); **P** = generated PDF opened and inspected.

## Working

| Area | What works | Verified |
|---|---|---|
| Setup, sign-in, roles | First-run company setup, sessions, 5 roles, per-user check-printing permission, server-side enforcement | B, T (permission matrix) |
| Dashboard | All listed tiles, 3 charts, project/period/custom-range filters, recent transactions and documents, upcoming payments, 6 quick actions | B |
| Projects | Create/edit with every listed field; 12-tab workspace (overview, ledger, invoices & receipts, vendors, client, payments, checks, lien waivers, documents, budget, reports, closeout); company-wide views | B |
| Bills & expenses | Vendor bills, receipts, one-step paid expenses, multi-category split, new vendor inline, attach files while entering, edit (reverse + re-post), void | T, B |
| Duplicate detection | Same vendor + invoice number, or same vendor + amount within 7 days; warns before saving | T |
| Internally prepared payment requests | Separate PR- numbering, labelled everywhere, own PDF stating it was not issued by the vendor | T (numbering), code path shared with bills |
| Vendors & clients | Profiles with cross-project bills, payments, checks, waivers, documents, balances; encrypted tax ID; insurance expiry flag; archive | B |
| Lien waivers | Auto-tracked on every project payment to flagged vendors; types configurable per jurisdiction; missing-waiver warnings; attach document | T, B |
| Double-entry ledger | Chart of accounts, AP, AR, immutable entries (DB trigger), reversals, manual journal entries, audit log | T |
| Checks | Draft → print → issue → clear; unique numbers; over-payment and double-payment blocked; void with reason; reprint tracking; top/middle/bottom layouts; alignment offsets; test print; voucher stubs | T, B, P |
| Bank reconciliation | Statement balance, tick cleared items, must reach $0.00, marks checks cleared | T, B |
| Client invoices | Sequential INV- numbers, line items, tax, partial payments, edit, void, branded PDF | T, B, P |
| Mileage | Trips, odometer or direct miles, vehicles, rates by effective date, monthly/quarterly/annual/by-project report, estimated deduction | T, B |
| Business expenses | Separate from project cost, included company-wide; auditable allocation to projects (equal or by direct cost) | T, B |
| Profitability | Original/revised budget, actual, committed unpaid, remaining, variance, revenue, gross profit, margin, allocated overhead, net; budget by category; change orders | T, B |
| Documents | Multi-file drag-drop, 10 default folders, auto-filing by what it is attached to, preview (PDF/images), rename, describe, tag, versions, many links per file, de-duplicated storage, soft delete | T, B |
| Search | Projects, vendors, clients, bills, invoices, checks, documents; by name, number, address or exact amount; checks hidden without permission | B |
| Reports | 15 reports incl. P&L (accrual/cash), balance sheet, trial balance, general ledger, cash flow, period summaries, project profitability, project ledger, final project ledger, AP/AR aging, vendor payments, check register, business expenses, mileage — each on screen, print, PDF, Excel, CSV | T (all 15 × 3 formats), B, P |
| Table features | Sort, search, filter, pagination, totals, CSV export on every list | B |
| Responsive | Collapsing sidebar, stacked forms on phones | B (390 px) |

## Built but NOT verified — treat as unfinished

- **AI invoice reading** (`/api/extract`). Written against the Anthropic Messages API; never run because no API key was available. Hidden unless `ANTHROPIC_API_KEY` is set.
- **MICR line on blank check stock.** Code path exists; never tested with a real MICR font, toner or bank. Labelled experimental in the app. Pre-printed stock is the supported path.
- **Check alignment on physical paper.** Positions were checked on the rendered PDF only. Run the alignment test against your actual stock and adjust offsets before printing a live check.
- **A real PostgreSQL server under concurrent load.** Tests pass over the Postgres wire protocol with a single connection; multi-connection behaviour on a hosted Postgres has not been exercised.
- **Logo on invoices** and **company settings forms**: built, not clicked through in the browser run.

## Not built yet

- Automated backups inside the app (use database and disk backups — see README)
- Bank statement import (reconciliation is manual tick-off)
- One-click ZIP export of all project documents (files download individually; reports export as PDF/Excel/CSV)
- Recurring business expenses, payment approvals, payment reminder emails
- Splitting one bill across several projects in the UI (the schema supports it; overhead allocation covers the reporting need)
- Work-in-progress capitalisation for spec homes; cash-basis balance sheet
- Three-per-page check format; printing several checks in one run
- Automatic document naming; customizable invoice templates beyond logo, company details and payment text
- Password reset by email, two-factor sign-in, sign-in rate limiting
- Cloud object storage adapter (S3 etc.); data import from QuickBooks/spreadsheets
- Multi-company switching (data model is ready)

## Decisions worth remembering

1. Costs are booked by the bill; payments and checks only move the liability. This is what prevents double counting.
2. Posted entries are immutable at the database level. Never add an "edit entry" feature — reverse and re-post.
3. A check posts nothing until issued, and is cleared only by reconciliation.
4. Overhead allocation is memo-only: it changes project profitability reports, never the ledger.
5. `amount_paid` on bills/invoices is a cache maintained inside the same transaction as the payment; a test asserts it always equals the sum of live payment applications.
6. Mileage rates are data, keyed by effective date. 2026 seed is $0.725 (IRS Notice 2026-10); confirm any mid-year change at irs.gov.
7. TypeScript is pinned to 5.x because Next.js 15 does not support TypeScript 7.

## Migrations

- `0000` — initial schema (all tables). Integrity triggers are applied idempotently at startup from `src/db/index.ts`.
