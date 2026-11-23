import { eq, and, sql } from 'drizzle-orm';
import { type Ctx, schema, inTx, audit, one, rows } from '@/db';
import { D, m2, today } from '@/lib/money';
import { postEntry, reverseEntry, sysAccount } from './accounting';
import { pendingCheckAmount } from './bills';
const { bills, invoices, payments, paymentApps, checks, checkApps, bankAccounts, lienWaivers, reconciliations, reconItems } = schema;

type App = { billId: number; amount: string };

/** How much of a bill can still be paid, net of payments already posted and checks still in progress. */
export async function billRemaining(ctx: Ctx, billId: number, excludeCheckId = 0) {
  const [b] = await ctx.db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.companyId, ctx.companyId)));
  if (!b) throw new Error('Bill not found'); if (b.status === 'void') throw new Error(`Bill #${billId} is void`);
  return { bill: b, remaining: D(b.total).minus(b.amountPaid).minus(await pendingCheckAmount(ctx, billId, excludeCheckId)) };
}

/** Pay one or more bills. Dr Accounts Payable / Cr the account the money left. The expense itself was booked by the bill, so nothing is double-counted. */
export async function payBills(ctx0: Ctx, p: { date: string; method: string; accountId: number; reference?: string | null; memo?: string | null; apps: App[]; fromCheckId?: number }): Promise<number> {
  return inTx(ctx0, async ctx => {
    const apps = p.apps.filter(a => D(a.amount).gt(0)); if (!apps.length) throw new Error('Select at least one bill to pay');
    const ap = await sysAccount(ctx, 'ap'); const loaded = [];
    for (const a of apps) {
      const { bill, remaining } = await billRemaining(ctx, a.billId, p.fromCheckId ?? 0);
      if (D(a.amount).gt(remaining)) throw new Error(`Payment of ${m2(a.amount)} exceeds the open balance (${m2(remaining)}) on bill ${bill.billNo ?? '#' + bill.id}. It may already be paid or on another check.`);
      loaded.push({ bill, amount: D(a.amount) });
    }
    const total = loaded.reduce((s, l) => s.plus(l.amount), D(0)); const vendorId = loaded[0].bill.vendorId;
    const [pay] = await ctx.db.insert(payments).values({ companyId: ctx.companyId, direction: 'out', date: p.date, amount: m2(total), method: p.method, accountId: p.accountId, vendorId, reference: p.reference || null, memo: p.memo || null, createdBy: ctx.userId }).returning({ id: payments.id });
    const label = `Payment${p.method === 'check' && p.reference ? ' — check #' + p.reference : ' (' + p.method + ')'}`;
    const entryId = await postEntry(ctx, {
      date: p.date, memo: label, sourceType: 'payment', sourceId: pay.id,
      lines: [...loaded.map(l => ({ accountId: ap, debit: l.amount, vendorId: l.bill.vendorId, projectId: l.bill.projectId, memo: label })), { accountId: p.accountId, credit: total, vendorId, memo: label }],
    });
    await ctx.db.update(payments).set({ entryId }).where(eq(payments.id, pay.id));
    for (const l of loaded) {
      await ctx.db.insert(paymentApps).values({ paymentId: pay.id, billId: l.bill.id, amount: m2(l.amount) });
      await ctx.db.update(bills).set({ amountPaid: sql`${bills.amountPaid} + ${m2(l.amount)}::numeric` }).where(eq(bills.id, l.bill.id));
      // Track the lien waiver we now expect from this vendor for this project.
      if (l.bill.vendorId && l.bill.projectId) {
        const v = await one<{ requires_waiver: boolean; types: string[] | null }>(ctx.db, sql`
          SELECT v.requires_waiver, j.waiver_types AS types FROM vendors v LEFT JOIN projects p ON p.id = ${l.bill.projectId} LEFT JOIN jurisdictions j ON j.id = p.jurisdiction_id WHERE v.id = ${l.bill.vendorId}`);
        if (v?.requires_waiver) await ctx.db.insert(lienWaivers).values({ companyId: ctx.companyId, projectId: l.bill.projectId, vendorId: l.bill.vendorId, paymentId: pay.id, type: v.types?.[1] ?? v.types?.[0] ?? 'Unconditional – Progress Payment', amount: m2(l.amount), paymentDate: p.date, status: 'requested' });
      }
    }
    await audit(ctx, 'create', 'payment', pay.id, `${label}: ${m2(total)} applied to ${loaded.length} bill(s)`);
    return pay.id;
  });
}

/** Money received from a client against invoices. Dr deposit account / Cr Accounts Receivable. */
export async function receivePayment(ctx0: Ctx, p: { date: string; method: string; accountId: number; reference?: string | null; memo?: string | null; apps: { invoiceId: number; amount: string }[] }): Promise<number> {
  return inTx(ctx0, async ctx => {
    const apps = p.apps.filter(a => D(a.amount).gt(0)); if (!apps.length) throw new Error('Select at least one invoice');
    const ar = await sysAccount(ctx, 'ar'); const loaded = [];
    for (const a of apps) {
      const [inv] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, a.invoiceId), eq(invoices.companyId, ctx.companyId)));
      if (!inv || inv.status === 'void') throw new Error('Invoice not found');
      const remaining = D(inv.total).minus(inv.amountPaid);
      if (D(a.amount).gt(remaining)) throw new Error(`Payment exceeds the open balance (${m2(remaining)}) on invoice ${inv.number}`);
      loaded.push({ inv, amount: D(a.amount) });
    }
    const total = loaded.reduce((s, l) => s.plus(l.amount), D(0));
    const [pay] = await ctx.db.insert(payments).values({ companyId: ctx.companyId, direction: 'in', date: p.date, amount: m2(total), method: p.method, accountId: p.accountId, clientId: loaded[0].inv.clientId, reference: p.reference || null, memo: p.memo || null, createdBy: ctx.userId }).returning({ id: payments.id });
    const label = `Customer payment${p.reference ? ' — ref ' + p.reference : ''}`;
    const entryId = await postEntry(ctx, {
      date: p.date, memo: label, sourceType: 'payment', sourceId: pay.id,
      lines: [{ accountId: p.accountId, debit: total, clientId: loaded[0].inv.clientId, memo: label }, ...loaded.map(l => ({ accountId: ar, credit: l.amount, clientId: l.inv.clientId, projectId: l.inv.projectId, memo: `${label} (${l.inv.number})` }))],
    });
    await ctx.db.update(payments).set({ entryId }).where(eq(payments.id, pay.id));
    for (const l of loaded) {
      await ctx.db.insert(paymentApps).values({ paymentId: pay.id, invoiceId: l.inv.id, amount: m2(l.amount) });
      await ctx.db.update(invoices).set({ amountPaid: sql`${invoices.amountPaid} + ${m2(l.amount)}::numeric` }).where(eq(invoices.id, l.inv.id));
    }
    await audit(ctx, 'create', 'payment', pay.id, `${label}: ${m2(total)}`);
    return pay.id;
  });
}

export async function voidPayment(ctx0: Ctx, id: number, reason: string) {
  return inTx(ctx0, async ctx => {
    const [p] = await ctx.db.select().from(payments).where(and(eq(payments.id, id), eq(payments.companyId, ctx.companyId)));
    if (!p) throw new Error('Payment not found'); if (p.status === 'void') return;
    const cleared = await one(ctx.db, sql`SELECT ri.id FROM recon_items ri JOIN journal_lines jl ON jl.id = ri.journal_line_id JOIN reconciliations r ON r.id = ri.reconciliation_id WHERE jl.entry_id = ${p.entryId} AND r.status = 'completed'`);
    if (cleared) throw new Error('This payment has cleared the bank in a completed reconciliation and cannot be voided. Record a correcting entry instead.');
    await ctx.db.execute(sql`DELETE FROM recon_items WHERE journal_line_id IN (SELECT id FROM journal_lines WHERE entry_id = ${p.entryId})`);
    if (p.entryId) await reverseEntry(ctx, p.entryId, { date: today(), memo: `Void payment #${id}: ${reason}` });
    const apps = await ctx.db.select().from(paymentApps).where(eq(paymentApps.paymentId, id));
    for (const a of apps) {
      if (a.billId) await ctx.db.update(bills).set({ amountPaid: sql`${bills.amountPaid} - ${a.amount}::numeric` }).where(eq(bills.id, a.billId));
      if (a.invoiceId) await ctx.db.update(invoices).set({ amountPaid: sql`${invoices.amountPaid} - ${a.amount}::numeric` }).where(eq(invoices.id, a.invoiceId));
    }
    await ctx.db.update(lienWaivers).set({ status: 'not_required', notes: 'Payment voided' }).where(and(eq(lienWaivers.paymentId, id), eq(lienWaivers.status, 'requested')));
    await ctx.db.update(payments).set({ status: 'void', memo: `${p.memo ? p.memo + ' — ' : ''}VOID: ${reason}` }).where(eq(payments.id, id));
    await audit(ctx, 'void', 'payment', id, `Payment #${id} voided: ${reason}`);
  });
}

/* ───────────── Checks ───────────── */
export type CheckInput = { bankAccountId: number; number?: number | null; date: string; payee?: string | null; payeeAddress?: string | null; memo?: string | null; projectId?: number | null; apps: App[] };

export async function createCheck(ctx0: Ctx, input: CheckInput): Promise<number> {
  return inTx(ctx0, async ctx => {
    const apps = input.apps.filter(a => D(a.amount).gt(0)); if (!apps.length) throw new Error('Select at least one bill for this check to pay');
    const [bank] = await ctx.db.select().from(bankAccounts).where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.companyId, ctx.companyId)));
    if (!bank) throw new Error('Bank account not found');
    let vendorId: number | null = null, projectId = input.projectId ?? null, total = D(0);
    for (const a of apps) {
      const { bill, remaining } = await billRemaining(ctx, a.billId);
      if (D(a.amount).gt(remaining)) throw new Error(`Bill ${bill.billNo ?? '#' + bill.id} only has ${m2(remaining)} left to pay — it may already be paid or on another check`);
      if (vendorId !== null && bill.vendorId !== vendorId) throw new Error('All bills on one check must belong to the same vendor');
      vendorId = bill.vendorId; projectId = projectId ?? bill.projectId; total = total.plus(a.amount);
    }
    const v = vendorId ? await one<{ name: string; address: string | null }>(ctx.db, sql`SELECT name, address FROM vendors WHERE id = ${vendorId}`) : null;
    const payee = input.payee?.trim() || v?.name; if (!payee) throw new Error('A payee is required');
    const number = input.number || bank.nextCheckNumber;
    const dup = await one(ctx.db, sql`SELECT id FROM checks WHERE bank_account_id = ${bank.id} AND number = ${number}`);
    if (dup) throw new Error(`Check number ${number} has already been used on this bank account`);
    const [c] = await ctx.db.insert(checks).values({ companyId: ctx.companyId, bankAccountId: bank.id, number, date: input.date, payee, payeeAddress: input.payeeAddress ?? v?.address ?? null, amount: m2(total), memo: input.memo || null, vendorId, projectId, createdBy: ctx.userId }).returning({ id: checks.id });
    await ctx.db.insert(checkApps).values(apps.map(a => ({ checkId: c.id, billId: a.billId, amount: m2(a.amount) })));
    if (number >= bank.nextCheckNumber) await ctx.db.update(bankAccounts).set({ nextCheckNumber: number + 1 }).where(eq(bankAccounts.id, bank.id));
    await audit(ctx, 'create', 'check', c.id, `Check #${number} drafted to ${payee} for ${m2(total)}`);
    return c.id;
  });
}
async function loadCheck(ctx: Ctx, id: number) {
  const [c] = await ctx.db.select().from(checks).where(and(eq(checks.id, id), eq(checks.companyId, ctx.companyId)));
  if (!c) throw new Error('Check not found'); return c;
}
export async function updateCheck(ctx: Ctx, id: number, patch: { date: string; payee: string; payeeAddress?: string | null; memo?: string | null }) {
  const c = await loadCheck(ctx, id); if (c.status !== 'draft') throw new Error('Only draft checks can be edited. Void and re-issue instead.');
  await ctx.db.update(checks).set({ date: patch.date, payee: patch.payee, payeeAddress: patch.payeeAddress || null, memo: patch.memo || null }).where(eq(checks.id, id));
  await audit(ctx, 'update', 'check', id, `Check #${c.number} edited`, { before: c, after: patch });
}
/** Called whenever the printable PDF is produced. Printing never implies issued or cleared. */
export async function markPrinted(ctx: Ctx, id: number) {
  const c = await loadCheck(ctx, id); if (c.status === 'voided') throw new Error('A voided check cannot be printed');
  const reprint = c.printCount > 0;
  await ctx.db.update(checks).set({ printCount: c.printCount + 1, printedAt: new Date(), status: c.status === 'draft' ? 'printed' : c.status }).where(eq(checks.id, id));
  await audit(ctx, reprint ? 'reprint' : 'print', 'check', id, `Check #${c.number} ${reprint ? `reprinted (print ${c.printCount + 1})` : 'printed'}`);
}
/** The check has been handed over or mailed: this is the moment the payment hits the books. */
export async function issueCheck(ctx0: Ctx, id: number) {
  return inTx(ctx0, async ctx => {
    const c = await loadCheck(ctx, id); if (!['draft', 'printed'].includes(c.status)) throw new Error(`This check is already ${c.status}`);
    const [bank] = await ctx.db.select().from(bankAccounts).where(eq(bankAccounts.id, c.bankAccountId));
    const apps = await ctx.db.select().from(checkApps).where(eq(checkApps.checkId, id));
    const paymentId = await payBills(ctx, { date: c.date, method: 'check', accountId: bank.accountId, reference: String(c.number), memo: c.memo, apps: apps.map(a => ({ billId: a.billId, amount: a.amount })), fromCheckId: id });
    await ctx.db.update(checks).set({ status: 'issued', issuedAt: new Date(), paymentId }).where(eq(checks.id, id));
    await audit(ctx, 'issue', 'check', id, `Check #${c.number} recorded as issued`);
  });
}
export async function voidCheck(ctx0: Ctx, id: number, reason: string) {
  if (!reason?.trim()) throw new Error('A reason is required to void a check');
  return inTx(ctx0, async ctx => {
    const c = await loadCheck(ctx, id); if (c.status === 'voided') return;
    if (c.status === 'cleared') throw new Error('This check has cleared the bank and cannot be voided');
    if (c.paymentId) await voidPayment(ctx, c.paymentId, `Check #${c.number} voided — ${reason}`);
    await ctx.db.update(checks).set({ status: 'voided', voidedAt: new Date(), voidReason: reason }).where(eq(checks.id, id));
    await audit(ctx, 'void', 'check', id, `Check #${c.number} voided: ${reason}`);
  });
}

/* ───────────── Bank reconciliation ───────────── */
export async function startReconciliation(ctx: Ctx, r: { bankAccountId: number; statementDate: string; endingBalance: string }) {
  const open = await one(ctx.db, sql`SELECT id FROM reconciliations WHERE bank_account_id = ${r.bankAccountId} AND status = 'open'`);
  if (open) throw new Error('Finish the reconciliation already in progress for this account first');
  const last = await one<{ ending: string }>(ctx.db, sql`SELECT ending_balance::text ending FROM reconciliations WHERE bank_account_id = ${r.bankAccountId} AND status = 'completed' ORDER BY statement_date DESC, id DESC LIMIT 1`);
  const [rec] = await ctx.db.insert(reconciliations).values({ companyId: ctx.companyId, bankAccountId: r.bankAccountId, statementDate: r.statementDate, beginningBalance: last?.ending ?? '0', endingBalance: m2(r.endingBalance) }).returning({ id: reconciliations.id });
  await audit(ctx, 'create', 'reconciliation', rec.id, `Reconciliation started for statement dated ${r.statementDate}`);
  return rec.id;
}
export async function reconciliationData(ctx: Ctx, id: number) {
  const rec = await one<any>(ctx.db, sql`SELECT r.id, r.bank_account_id, r.statement_date::text, r.beginning_balance::text, r.ending_balance::text, r.status, b.account_id, b.name bank_name FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id WHERE r.id = ${id} AND r.company_id = ${ctx.companyId}`);
  if (!rec) throw new Error('Reconciliation not found');
  // Voided payments (an entry plus its reversal) net to zero and never reached the bank, so both are left out.
  const items = await rows<{ id: number; date: string; memo: string | null; debit: string; credit: string; cleared: boolean; reference: string | null; method: string | null; party: string | null; source_type: string }>(ctx.db, sql`
    SELECT jl.id, je.date::text, je.memo, jl.debit::text, jl.credit::text, (ri.id IS NOT NULL) AS cleared, p.reference, p.method, coalesce(v.name, c.name) party, je.source_type
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    LEFT JOIN recon_items ri ON ri.journal_line_id = jl.id
    LEFT JOIN payments p ON je.source_type = 'payment' AND p.id = je.source_id
    LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN clients c ON c.id = p.client_id
    WHERE jl.account_id = ${rec.account_id} AND je.date <= ${rec.statement_date}::date AND (ri.id IS NULL OR ri.reconciliation_id = ${id})
      AND je.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.reverses_id = je.id)
    ORDER BY je.date, jl.id`);
  const clearedNet = items.filter(i => i.cleared).reduce((a, i) => a.plus(i.debit).minus(i.credit), D(0));
  const clearedBalance = D(rec.beginning_balance).plus(clearedNet);
  return { rec, items, clearedBalance: m2(clearedBalance), difference: m2(D(rec.ending_balance).minus(clearedBalance)) };
}
export async function toggleReconItem(ctx: Ctx, reconId: number, lineId: number, on: boolean) {
  const { rec, items } = await reconciliationData(ctx, reconId);
  if (rec.status !== 'open') throw new Error('This reconciliation is already completed');
  if (!items.some(i => i.id === lineId)) throw new Error('That transaction is not part of this reconciliation');
  if (on) await ctx.db.insert(reconItems).values({ reconciliationId: reconId, journalLineId: lineId }).onConflictDoNothing();
  else await ctx.db.delete(reconItems).where(and(eq(reconItems.reconciliationId, reconId), eq(reconItems.journalLineId, lineId)));
}
export async function completeReconciliation(ctx0: Ctx, id: number) {
  return inTx(ctx0, async ctx => {
    const { rec, difference } = await reconciliationData(ctx, id);
    if (rec.status !== 'open') throw new Error('Already completed');
    if (!D(difference).isZero()) throw new Error(`The reconciliation is off by ${difference}. It must be zero to finish.`);
    await ctx.db.update(reconciliations).set({ status: 'completed', completedAt: new Date(), completedBy: ctx.userId }).where(eq(reconciliations.id, id));
    const cleared = await rows<{ id: number; number: number }>(ctx.db, sql`
      UPDATE checks SET status = 'cleared', cleared_at = ${rec.statement_date}::date WHERE status = 'issued' AND payment_id IN (
        SELECT p.id FROM payments p JOIN journal_lines jl ON jl.entry_id = p.entry_id JOIN recon_items ri ON ri.journal_line_id = jl.id WHERE ri.reconciliation_id = ${id}) RETURNING id, number`);
    for (const c of cleared) await audit(ctx, 'clear', 'check', c.id, `Check #${c.number} cleared (statement ${rec.statement_date})`);
    await audit(ctx, 'complete', 'reconciliation', id, `Reconciliation completed for statement ${rec.statement_date}; ${cleared.length} check(s) cleared`);
  });
}
export async function cancelReconciliation(ctx: Ctx, id: number) {
  const { rec } = await reconciliationData(ctx, id); if (rec.status !== 'open') throw new Error('Completed reconciliations cannot be deleted');
  await ctx.db.delete(reconItems).where(eq(reconItems.reconciliationId, id));
  await ctx.db.delete(reconciliations).where(eq(reconciliations.id, id));
  await audit(ctx, 'delete', 'reconciliation', id, 'Open reconciliation discarded');
}
