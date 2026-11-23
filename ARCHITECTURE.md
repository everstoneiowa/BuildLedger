# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript | Server-rendered pages read the database directly; forms call server actions. No separate API to keep in sync. |
| Database | PostgreSQL via Drizzle ORM | Relational integrity, `numeric(14,2)` money, transactions, triggers. Drizzle is used instead of Prisma because it has no native engine binary and lets reports be written in plain SQL. |
| Local database | PGlite (PostgreSQL compiled to WebAssembly) | Same SQL dialect and migrations as production with zero setup. Chosen automatically when `DATABASE_URL` is empty. |
| Money math | `decimal.js` in code, `numeric` in SQL | No floating point anywhere in a financial calculation. |
| PDFs | `pdf-lib` | Exact point-level positioning (needed for checks), pure JavaScript. |
| Excel | `exceljs` | Real `.xlsx` with numeric cells and currency formats. |
| Styling / charts | Tailwind CSS 4, Recharts | |
| Auth | Email + password (scrypt), server-side sessions in the database, HTTP-only cookie | No third-party dependency holding the keys to financial data. |
| Secrets at rest | AES-256-GCM keyed from `APP_SECRET` | Bank routing/account numbers and vendor tax IDs. Only last-4 is ever displayed. |
| Files | Content-addressed blobs on private disk, served only through an authenticated route | One stored file, many links. |

## The accounting model

Everything financial is a balanced journal entry in one general ledger. Nothing else holds money totals.

```
accounts ──< journal_lines >── journal_entries
                 │  dimensions: project_id, vendor_id, client_id, category_id
```

`postEntry()` in `src/services/accounting.ts` is the only code that writes to the ledger. It rejects any entry whose
debits and credits differ. A database trigger rejects every UPDATE or DELETE on `journal_entries`, `journal_lines`
and `audit_log`, so history cannot be rewritten even by a bug or a direct SQL session. Corrections are new entries:

| Event | Entry |
|---|---|
| Vendor bill / expense / payment request saved | Dr cost account(s) by category · Cr Accounts Payable |
| Bill paid (check issued, card, ACH, cash) | Dr Accounts Payable · Cr bank / credit card / owner-paid |
| Client invoice issued | Dr Accounts Receivable · Cr Revenue (· Cr Sales Tax Payable) |
| Client payment received | Dr bank · Cr Accounts Receivable |
| Edit a bill or invoice | Reverse the old entry, post the corrected one |
| Void a bill, invoice, payment, check | Reversing entry |
| Opening bank balance | Dr bank · Cr Owner's Equity |

**Why nothing is double-counted:** the cost is recorded once, by the bill. Paying it — by check or otherwise — only
moves the balance from Accounts Payable to the bank. A check is a *payment instrument* attached to a payment; it posts
nothing itself.

**Project ledgers are views.** A project's ledger, budget-versus-actual, profitability and final report are all
`WHERE project_id = …` queries over the same journal lines the company P&L uses. They cannot disagree.

**Accrual and cash.** Accrual reports read the ledger directly. Cash-basis P&L and profitability recognise bills and
invoices as they are paid, pro-rating each payment across the bill's lines (`plBase()` in `src/services/reports.ts`).
Balance sheet and trial balance are accrual only, and say so.

**Simplification to know about:** project costs are expensed as incurred to "Direct Construction Costs". They are not
capitalised to work-in-progress inventory and released at sale. Your accountant may want that for spec homes; it is a
contained change (categories map to accounts) and is listed in PROGRESS.md.

## Records and relationships

```
companies ─┬─ users, sessions, audit_log, sequences
           ├─ accounts ── bank_accounts (encrypted numbers, check layout, next check #)
           ├─ categories (project | overhead, parent → sub-category, → posting account)
           ├─ jurisdictions (lien-waiver types and notes per state)
           ├─ clients ──< projects >── jurisdictions
           │                 ├─< project_budgets (per category)   ├─< change_orders
           ├─ vendors
           ├─ bills ──< bill_lines (category, project, amount)        [kind: vendor | internal PR-####]
           │     └─< overhead_allocations (memo-only share of a general expense per project)
           ├─ invoices ──< invoice_lines                               [INV-####, own sequence]
           ├─ payments ──< payment_apps >── bills | invoices
           ├─ checks ──< check_apps >── bills        check.payment_id → payments (set when issued)
           ├─ reconciliations ──< recon_items >── journal_lines (bank account lines that cleared)
           ├─ lien_waivers → project, vendor, payment, document
           ├─ documents → blobs (sha256)   ──< document_links >── project | vendor | client | bill | invoice | waiver
           └─ vehicles, mileage_rates (by effective date), mileage_trips
```

Every top-level table carries `company_id`, and every query filters by it, so more companies can be added later
without restructuring. The UI currently assumes one.

## Check lifecycle

```
draft ──print──▶ printed ──record as issued──▶ issued ──bank reconciliation──▶ cleared
   └──────────────── void (reason required; number is never reused) ◀──────┘ (not after cleared)
```

- Draft and printed checks reserve the bill's balance, so the same bill cannot be put on two checks or also paid by ACH.
- Only "record as issued" posts to the books.
- Only completing a bank reconciliation marks a check cleared.
- Check numbers are unique per bank account (database constraint).
- Printing requires the `checks.print` permission; each print, reprint, issue, void and clear is written to the audit log.

## Roles

| Role | Can |
|---|---|
| Owner, Administrator | Everything, including bank accounts, users, tax IDs, check printing |
| Bookkeeper | All accounting; prints checks only if individually authorized |
| Project manager | Projects, bills/expenses, documents, mileage. No checks, banking, company reports or settings |
| Read-only | View and export; changes nothing |

Permissions are enforced on the server in every action and route (`src/lib/perm.ts`, `src/lib/action.ts`), not just hidden in the UI.

## Code map

```
src/db/schema.ts        every table            src/services/accounting.ts  ledger posting, reversal
src/db/index.ts         connection, triggers   src/services/bills.ts       payables, duplicates, allocation
src/lib/pdf.ts          checks, invoices       src/services/payments.ts    payments, checks, reconciliation
src/lib/export.ts       report → PDF/XLSX/CSV  src/services/invoices.ts    receivables
src/app/actions.ts      all server actions     src/services/reports.ts     every report and summary
src/app/(app)/…         pages                  src/services/documents.ts   file storage and linking
tests/workflows.test.ts accounting tests       drizzle/                    SQL migrations
```
