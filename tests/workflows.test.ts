import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
process.env.PGLITE_DIR = 'memory'; process.env.APP_SECRET = 'test-secret'; process.env.STORAGE_DIR = '/tmp/bl-test-files';
import { getDb, rows, one, schema, type Ctx } from '@/db';
import { createCompany } from '@/services/seed';
import { createBill, updateBill, voidBill, findDuplicateBills, allocateOverhead } from '@/services/bills';
import { createCheck, markPrinted, issueCheck, voidCheck, payBills, receivePayment, startReconciliation, reconciliationData, toggleReconItem, completeReconciliation } from '@/services/payments';
import { createInvoice } from '@/services/invoices';
import { postEntry, ledgerBalanced, accountByCode } from '@/services/accounting';
import { runReport, projectSummaries, REPORTS } from '@/services/reports';
import { saveDocument } from '@/services/documents';
import { amountInWords } from '@/lib/money';
import { checkPdf } from '@/lib/pdf';
import { reportPdf, reportXlsx, reportCsv } from '@/lib/export';

let ctx: Ctx; let cat: Record<string, number>; let bankId: number; let bankGl: number;
let projA: number, projB: number, electrician: number, client: number;
const amount = (r: any, sec: number, name: string) => r.sections[sec].rows.find((x: any) => x.name === name)?.amount;

beforeAll(async () => {
  const db = await getDb();
  ctx = await createCompany(db, { companyName: 'Test Builders LLC', userName: 'Owner', email: 'o@example.com', password: 'password123' });
  cat = Object.fromEntries((await rows<any>(db, sql`SELECT id, name FROM categories`)).map(c => [c.name, c.id]));
  const b = await one<any>(db, sql`SELECT id, account_id FROM bank_accounts`); bankId = b.id; bankGl = b.account_id;
  await postEntry(ctx, { date: '2026-01-01', memo: 'Opening balance', sourceType: 'opening', lines: [{ accountId: bankGl, debit: '500000' }, { accountId: await accountByCode(ctx, '3000'), credit: '500000' }] });
  [{ id: client }] = await db.insert(schema.clients).values({ companyId: ctx.companyId, name: 'Jane Buyer' }).returning();
  [{ id: projA }] = await db.insert(schema.projects).values({ companyId: ctx.companyId, name: 'Maple St', number: 'P-001', budget: '300000', contractPrice: '400000', clientId: client }).returning();
  [{ id: projB }] = await db.insert(schema.projects).values({ companyId: ctx.companyId, name: 'Oak Ave', number: 'P-002', budget: '250000' }).returning();
  [{ id: electrician }] = await db.insert(schema.vendors).values({ companyId: ctx.companyId, name: 'Bright Electric', kind: 'subcontractor', requiresWaiver: true }).returning();
});

describe('money helpers', () => {
  it('writes check amounts in words', () => {
    expect(amountInWords('1234.56')).toBe('One Thousand Two Hundred Thirty-Four and 56/100');
    expect(amountInWords('100000')).toBe('One Hundred Thousand and 00/100');
    expect(amountInWords('0.07')).toBe('Zero and 07/100');
    expect(amountInWords('2000019.10')).toBe('Two Million Nineteen and 10/100');
  });
});

describe('Workflow A — paying a subcontractor by check', () => {
  let billId: number, checkId: number;
  it('saves an uploaded invoice as an unpaid bill with its document linked', async () => {
    const doc = await saveDocument(ctx, { name: 'bright-1001.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 fake invoice') });
    billId = await createBill(ctx, { vendorId: electrician, projectId: projA, billNo: '1001', date: '2026-02-10', dueDate: '2026-03-10', lines: [{ categoryId: cat['Electrical'], amount: '12500.00', description: 'Rough-in' }], docIds: [doc] });
    const [p] = await projectSummaries(ctx, { projectId: projA });
    expect(p.actualCost).toBe('12500.00'); expect(p.unpaid).toBe('12500.00'); expect(p.paid).toBe('0.00');
    const links = await rows(ctx.db, sql`SELECT entity_type FROM document_links WHERE document_id = ${doc} ORDER BY 1`);
    expect(links.map((l: any) => l.entity_type)).toEqual(['bill', 'project', 'vendor']);
  });
  it('flags a likely duplicate invoice', async () => {
    const d = await findDuplicateBills(ctx, { vendorId: electrician, billNo: '1001', total: '99.00', date: '2026-06-01' });
    expect(d.length).toBe(1);
  });
  it('stores identical file content only once', async () => {
    await saveDocument(ctx, { name: 'copy.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 fake invoice') });
    expect((await one<any>(ctx.db, sql`SELECT count(*)::int n FROM blobs`)).n).toBe(1);
  });
  it('drafts a check, blocks paying the same bill twice, and prints without touching the books', async () => {
    checkId = await createCheck(ctx, { bankAccountId: bankId, date: '2026-02-15', apps: [{ billId, amount: '12500.00' }] });
    await expect(createCheck(ctx, { bankAccountId: bankId, date: '2026-02-15', apps: [{ billId, amount: '12500.00' }] })).rejects.toThrow(/left to pay/);
    await expect(payBills(ctx, { date: '2026-02-15', method: 'ach', accountId: bankGl, apps: [{ billId, amount: '100' }] })).rejects.toThrow(/exceeds/);
    await markPrinted(ctx, checkId);
    const c = await one<any>(ctx.db, sql`SELECT status, print_count, number FROM checks WHERE id = ${checkId}`);
    expect(c.status).toBe('printed'); expect(c.number).toBe(1001);
    expect((await one<any>(ctx.db, sql`SELECT amount_paid::text p FROM bills WHERE id = ${billId}`)).p).toBe('0.00');
    const pdf = await checkPdf(ctx, checkId); expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('rejects a duplicate check number on the same account', async () => {
    const other = await createBill(ctx, { vendorId: electrician, projectId: projB, billNo: '1002', date: '2026-02-12', lines: [{ categoryId: cat['Electrical'], amount: '800' }] });
    await expect(createCheck(ctx, { bankAccountId: bankId, number: 1001, date: '2026-02-15', apps: [{ billId: other, amount: '800' }] })).rejects.toThrow(/already been used/);
  });
  it('issuing the check pays the bill, relieves A/P, and expects a lien waiver', async () => {
    await issueCheck(ctx, checkId);
    const b = await one<any>(ctx.db, sql`SELECT amount_paid::text p FROM bills WHERE id = ${billId}`); expect(b.p).toBe('12500.00');
    const [p] = await projectSummaries(ctx, { projectId: projA });
    expect(p.actualCost).toBe('12500.00'); // cost counted once — by the bill, not again by the check
    expect(p.paid).toBe('12500.00'); expect(p.unpaid).toBe('0.00');
    const w = await rows<any>(ctx.db, sql`SELECT status, amount::text FROM lien_waivers WHERE project_id = ${projA}`);
    expect(w).toEqual([{ status: 'requested', amount: '12500.00' }]);
    const tb = await runReport(ctx, 'trial-balance', { to: '2026-12-31' });
    const ap = tb.sections[0].rows.find((r: any) => r.code === '2000'); expect(ap!.credit).toBe('800.00');
  });
  it('reconciliation clears the check; cleared checks cannot be voided', async () => {
    const rec = await startReconciliation(ctx, { bankAccountId: bankId, statementDate: '2026-02-28', endingBalance: '487500.00' });
    let d = await reconciliationData(ctx, rec); expect(d.items.length).toBe(2);
    await expect(completeReconciliation(ctx, rec)).rejects.toThrow(/off by/);
    for (const i of d.items) await toggleReconItem(ctx, rec, i.id, true);
    d = await reconciliationData(ctx, rec); expect(d.difference).toBe('0.00');
    await completeReconciliation(ctx, rec);
    expect((await one<any>(ctx.db, sql`SELECT status FROM checks WHERE id = ${checkId}`)).status).toBe('cleared');
    await expect(voidCheck(ctx, checkId, 'oops')).rejects.toThrow(/cleared/);
  });
});

describe('Workflow B — expenses, corrections and voids', () => {
  it('records a card-paid expense in one step', async () => {
    const cc = await accountByCode(ctx, '2100');
    await createBill(ctx, { payee: 'Lumber Yard', projectId: projA, date: '2026-03-01', lines: [{ categoryId: cat['Framing'], amount: '4321.09' }], payNow: { accountId: cc, method: 'card' } });
    const [p] = await projectSummaries(ctx, { projectId: projA }); expect(p.actualCost).toBe('16821.09'); expect(p.paid).toBe('16821.09');
  });
  it('editing a bill reverses and re-posts instead of rewriting history', async () => {
    const id = await createBill(ctx, { vendorId: electrician, projectId: projA, billNo: '1003', date: '2026-03-05', lines: [{ categoryId: cat['Electrical'], amount: '1000' }] });
    const before = (await one<any>(ctx.db, sql`SELECT count(*)::int n FROM journal_entries`)).n;
    await updateBill(ctx, id, { vendorId: electrician, projectId: projA, billNo: '1003', date: '2026-03-05', lines: [{ categoryId: cat['Electrical'], amount: '1200' }] });
    expect((await one<any>(ctx.db, sql`SELECT count(*)::int n FROM journal_entries`)).n).toBe(before + 2);
    const [p] = await projectSummaries(ctx, { projectId: projA }); expect(p.actualCost).toBe('18021.09');
    await voidBill(ctx, id, 'entered in error');
    const [p2] = await projectSummaries(ctx, { projectId: projA }); expect(p2.actualCost).toBe('16821.09');
  });
  it('the database itself refuses to change posted entries', async () => {
    await expect(ctx.db.execute(sql`UPDATE journal_lines SET debit = 1 WHERE id = 1`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`DELETE FROM journal_entries WHERE id = 1`)).rejects.toThrow();
  });
  it('voiding an issued check reopens the bill and keeps the number retired', async () => {
    const billId = (await one<any>(ctx.db, sql`SELECT id FROM bills WHERE bill_no = '1002'`)).id;
    const chk = await createCheck(ctx, { bankAccountId: bankId, date: '2026-03-10', apps: [{ billId, amount: '800' }] });
    await issueCheck(ctx, chk);
    expect((await one<any>(ctx.db, sql`SELECT amount_paid::text p FROM bills WHERE id = ${billId}`)).p).toBe('800.00');
    await voidCheck(ctx, chk, 'lost in mail');
    expect((await one<any>(ctx.db, sql`SELECT amount_paid::text p FROM bills WHERE id = ${billId}`)).p).toBe('0.00');
    const chk2 = await createCheck(ctx, { bankAccountId: bankId, date: '2026-03-12', apps: [{ billId, amount: '800' }] });
    const nums = await rows<any>(ctx.db, sql`SELECT number FROM checks WHERE id IN (${chk}, ${chk2}) ORDER BY number`);
    expect(nums[1].number).toBe(nums[0].number + 1);
  });
  it('general business expenses stay out of project costs; allocation is memo-only', async () => {
    const id = await createBill(ctx, { payee: 'Insurance Co', date: '2026-03-15', lines: [{ categoryId: cat['Insurance'], amount: '3000' }], payNow: { accountId: bankGl, method: 'ach' } });
    const [a] = await projectSummaries(ctx, { projectId: projA }); expect(a.actualCost).toBe('16821.09');
    await allocateOverhead(ctx, id, 'cost', [projA, projB]);
    const ps = await projectSummaries(ctx); const tot = Number(ps[0].overhead) + Number(ps[1].overhead);
    expect(tot).toBeCloseTo(3000, 2); expect(ps[0].actualCost).toBe('16821.09');
  });
});

describe('Receivables and company reports', () => {
  it('numbers invoices sequentially and tracks partial payment', async () => {
    const i1 = await createInvoice(ctx, { clientId: client, projectId: projA, date: '2026-04-01', lines: [{ description: 'Draw 1', quantity: '1', unitPrice: '100000' }] });
    const i2 = await createInvoice(ctx, { clientId: client, projectId: projA, date: '2026-04-02', taxRate: '7', lines: [{ description: 'Upgrade', quantity: '2', unitPrice: '500', taxable: true }] });
    const n = await rows<any>(ctx.db, sql`SELECT number, total::text FROM invoices WHERE id IN (${i1}, ${i2}) ORDER BY id`);
    expect(n).toEqual([{ number: 'INV-0001', total: '100000.00' }, { number: 'INV-0002', total: '1070.00' }]);
    await receivePayment(ctx, { date: '2026-04-10', method: 'wire', accountId: bankGl, apps: [{ invoiceId: i1, amount: '60000' }] });
    await expect(receivePayment(ctx, { date: '2026-04-11', method: 'wire', accountId: bankGl, apps: [{ invoiceId: i1, amount: '50000' }] })).rejects.toThrow(/exceeds/);
  });
  it('accrual and cash P&L differ by exactly the unpaid items', async () => {
    const acc = await runReport(ctx, 'profit-loss', { from: '2026-01-01', to: '2026-12-31', basis: 'accrual' });
    const cash = await runReport(ctx, 'profit-loss', { from: '2026-01-01', to: '2026-12-31', basis: 'cash' });
    expect(acc.sections[0].totals!.amount).toBe('101000.00'); expect(cash.sections[0].totals!.amount).toBe('60000.00');
    expect(acc.sections[1].totals!.amount).toBe('17621.09');  // 12500 + 4321.09 + 800 (unpaid)
    expect(cash.sections[1].totals!.amount).toBe('16821.09');
    expect(acc.sections[2].totals!.amount).toBe('3000.00');
    expect(amount(acc, 3, 'Net income')).toBe('80378.91');
  });
  it('the ledger balances and the balance sheet ties out', async () => {
    expect((await ledgerBalanced(ctx)).balanced).toBe(true);
    const bs = await runReport(ctx, 'balance-sheet', { to: '2026-12-31' });
    expect(amount(bs, 3, 'Difference from total assets (must be 0.00)')).toBe('0.00');
    const tb = await runReport(ctx, 'trial-balance', { to: '2026-12-31' });
    expect(tb.sections[0].totals!.debit).toBe(tb.sections[0].totals!.credit);
    // cached amount_paid always equals the sum of live payment applications
    const drift = await rows(ctx.db, sql`SELECT b.id FROM bills b WHERE b.amount_paid <> coalesce((SELECT sum(pa.amount) FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'posted' WHERE pa.bill_id = b.id), 0)`);
    expect(drift.length).toBe(0);
  });
  it('project profit = revenue − cost, straight from the ledger', async () => {
    const [p] = await projectSummaries(ctx, { projectId: projA });
    expect(p.revenue).toBe('101000.00'); expect(p.grossProfit).toBe('84178.91');
  });
  it('every report runs and exports to PDF, Excel and CSV', async () => {
    await ctx.db.insert(schema.mileageTrips).values({ companyId: ctx.companyId, date: '2026-05-01', purpose: 'Site visit', miles: '42.5', projectId: projA });
    for (const def of REPORTS) {
      const r = await def.run(ctx, { from: '2026-01-01', to: '2026-12-31', projectId: def.params.includes('projectRequired') ? projA : undefined });
      expect(Buffer.from(await reportPdf(r, 'Test Builders LLC')).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await reportXlsx(r, 'Test Builders LLC')).length).toBeGreaterThan(1000);
      expect(reportCsv(r, 'Test Builders LLC')).toContain(r.title);
    }
    const mil = await runReport(ctx, 'mileage', { from: '2026-01-01', to: '2026-12-31' });
    expect(mil.sections[2].rows[0].deduction).toBe('30.81'); // 42.5 mi × $0.725
  });
});

import { can } from '@/lib/perm';
describe('Role permissions', () => {
  const u = (role: any, canPrintChecks = false) => ({ role, canPrintChecks });
  it('restricts check printing and bank administration', () => {
    expect(can(u('owner'), 'checks.print')).toBe(true); expect(can(u('bookkeeper'), 'checks.print')).toBe(false); expect(can(u('bookkeeper', true), 'checks.print')).toBe(true);
    expect(can(u('pm', true), 'checks.print')).toBe(false); expect(can(u('bookkeeper'), 'bank.admin')).toBe(false); expect(can(u('viewer'), 'bills.write')).toBe(false);
    expect(can(u('pm'), 'checks.read')).toBe(false); expect(can(u('pm'), 'bills.write')).toBe(true); expect(can(u('viewer'), 'reports.read')).toBe(true);
  });
});
