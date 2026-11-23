import { eq, and, sql, inArray } from 'drizzle-orm';
import { type Ctx, schema, inTx, audit, nextSeq, one, rows } from '@/db';
import { D, m2 } from '@/lib/money';
import { postEntry, reverseEntry, sysAccount } from './accounting';
import { payBills } from './payments';
import { linkDocument } from './documents';
const { bills, billLines, vendors, overheadAllocations } = schema;

export type BillLineInput = { projectId?: number | null; categoryId: number; description?: string | null; amount: string };
export type BillInput = {
  kind?: 'vendor' | 'internal'; vendorId?: number | null; newVendorName?: string | null; payee?: string | null; projectId?: number | null;
  billNo?: string | null; date: string; dueDate?: string | null; taxAmount?: string | null; description?: string | null; notes?: string | null;
  lines: BillLineInput[]; docIds?: number[];
  payNow?: { accountId: number; method: string; date?: string | null; reference?: string | null } | null;
};

function validate(input: BillInput) {
  if (!input.lines?.length) throw new Error('Add at least one line with a category and amount');
  for (const l of input.lines) { if (!l.categoryId) throw new Error('Every line needs a category'); if (D(l.amount).isZero()) throw new Error('Line amounts cannot be zero'); }
  const total = input.lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  if (total.lte(0)) throw new Error('The total must be greater than zero');
  if (D(input.taxAmount).gt(total)) throw new Error('Tax cannot exceed the total');
  return total;
}
async function post(ctx: Ctx, billId: number, input: BillInput, total: ReturnType<typeof D>, vendorId: number | null, label: string) {
  const cats = await rows<{ id: number; account_id: number }>(ctx.db, sql`SELECT id, account_id FROM categories WHERE company_id = ${ctx.companyId}`);
  const acct = new Map(cats.map(c => [c.id, c.account_id]));
  const ap = await sysAccount(ctx, 'ap');
  return postEntry(ctx, {
    date: input.date, memo: label, sourceType: 'bill', sourceId: billId,
    lines: [
      ...input.lines.map(l => {
        const a = acct.get(l.categoryId); if (!a) throw new Error('Unknown category');
        return { accountId: a, debit: l.amount, projectId: l.projectId ?? input.projectId ?? null, vendorId, categoryId: l.categoryId, memo: l.description ?? input.description ?? null };
      }),
      { accountId: ap, credit: total, vendorId, projectId: input.projectId ?? null, memo: label },
    ],
  });
}
async function resolveVendor(ctx: Ctx, input: BillInput): Promise<number | null> {
  if (input.newVendorName?.trim()) {
    const [v] = await ctx.db.insert(vendors).values({ companyId: ctx.companyId, name: input.newVendorName.trim() }).returning({ id: vendors.id });
    await audit(ctx, 'create', 'vendor', v.id, `Vendor "${input.newVendorName.trim()}" created while entering a bill`);
    return v.id;
  }
  return input.vendorId ?? null;
}

/** Possible duplicates: same vendor + same invoice number, or same vendor + same amount within 7 days. */
export function findDuplicateBills(ctx: Ctx, q: { vendorId?: number | null; billNo?: string | null; total: string; date: string; excludeId?: number }) {
  if (!q.vendorId) return Promise.resolve([] as any[]);
  return rows<{ id: number; bill_no: string | null; date: string; total: string; reason: string }>(ctx.db, sql`
    SELECT id, bill_no, date::text, total::text,
      CASE WHEN ${q.billNo ?? ''} <> '' AND lower(bill_no) = lower(${q.billNo ?? ''}) THEN 'Same vendor and invoice number' ELSE 'Same vendor and amount within 7 days' END AS reason
    FROM bills WHERE company_id = ${ctx.companyId} AND status = 'open' AND vendor_id = ${q.vendorId} AND id <> ${q.excludeId ?? 0}
      AND ((${q.billNo ?? ''} <> '' AND lower(bill_no) = lower(${q.billNo ?? ''})) OR (total = ${q.total}::numeric AND abs(date - ${q.date}::date) <= 7))`);
}

export async function createBill(ctx0: Ctx, input: BillInput): Promise<number> {
  const total = validate(input);
  return inTx(ctx0, async ctx => {
    const vendorId = await resolveVendor(ctx, input);
    if (!vendorId && !input.payee?.trim()) throw new Error('Choose a vendor or enter a payee');
    const kind = input.kind ?? 'vendor';
    if (kind === 'internal' && !vendorId) throw new Error('An internally prepared payment request needs a vendor');
    const internalNo = kind === 'internal' ? `PR-${String(await nextSeq(ctx, 'internal')).padStart(4, '0')}` : null;
    const [b] = await ctx.db.insert(bills).values({
      companyId: ctx.companyId, kind, internalNo, vendorId, payee: input.payee?.trim() || null, projectId: input.projectId ?? null,
      billNo: input.billNo?.trim() || null, date: input.date, dueDate: input.dueDate || null, total: m2(total), taxAmount: m2(input.taxAmount),
      description: input.description || null, notes: input.notes || null, createdBy: ctx.userId,
    }).returning({ id: bills.id });
    await ctx.db.insert(billLines).values(input.lines.map(l => ({ billId: b.id, projectId: l.projectId ?? input.projectId ?? null, categoryId: l.categoryId, description: l.description || null, amount: m2(l.amount) })));
    const label = `${kind === 'internal' ? 'Payment request ' + internalNo : 'Bill' + (input.billNo ? ' ' + input.billNo : '')}${input.description ? ' — ' + input.description : ''}`;
    const entryId = await post(ctx, b.id, input, total, vendorId, label);
    await ctx.db.update(bills).set({ entryId }).where(eq(bills.id, b.id));
    for (const d of input.docIds ?? []) {
      await linkDocument(ctx, d, 'bill', b.id);
      if (vendorId) await linkDocument(ctx, d, 'vendor', vendorId);
      const pids = new Set([input.projectId, ...input.lines.map(l => l.projectId)].filter(Boolean) as number[]);
      for (const p of pids) await linkDocument(ctx, d, 'project', p);
    }
    await audit(ctx, 'create', 'bill', b.id, `${label} for ${m2(total)}`, input);
    if (input.payNow) {
      await payBills(ctx, { date: input.payNow.date || input.date, method: input.payNow.method, accountId: input.payNow.accountId, reference: input.payNow.reference, apps: [{ billId: b.id, amount: m2(total) }] });
    }
    return b.id;
  });
}

export async function pendingCheckAmount(ctx: Ctx, billId: number, excludeCheckId = 0) {
  const r = await one<{ amt: string }>(ctx.db, sql`SELECT coalesce(sum(ca.amount),0)::text amt FROM check_apps ca JOIN checks c ON c.id = ca.check_id WHERE ca.bill_id = ${billId} AND c.status IN ('draft','printed') AND c.id <> ${excludeCheckId}`);
  return D(r!.amt);
}

/** Editing a posted bill never rewrites history: the old entry is reversed and a corrected one is posted. */
export async function updateBill(ctx0: Ctx, id: number, input: BillInput) {
  const total = validate(input);
  return inTx(ctx0, async ctx => {
    const [b] = await ctx.db.select().from(bills).where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
    if (!b) throw new Error('Bill not found'); if (b.status === 'void') throw new Error('A voided bill cannot be edited');
    const committed = D(b.amountPaid).plus(await pendingCheckAmount(ctx, id));
    if (total.lt(committed)) throw new Error(`The total cannot be less than what has already been paid or is on a pending check (${m2(committed)})`);
    const vendorId = (await resolveVendor(ctx, input)) ?? null;
    if (D(b.amountPaid).gt(0) && vendorId !== b.vendorId) throw new Error('The vendor cannot be changed after a payment has been recorded');
    const before = { ...b, lines: await ctx.db.select().from(billLines).where(eq(billLines.billId, id)) };
    if (b.entryId) await reverseEntry(ctx, b.entryId, { memo: `Correction: bill #${id} edited` });
    await ctx.db.delete(billLines).where(eq(billLines.billId, id));
    await ctx.db.insert(billLines).values(input.lines.map(l => ({ billId: id, projectId: l.projectId ?? input.projectId ?? null, categoryId: l.categoryId, description: l.description || null, amount: m2(l.amount) })));
    const label = `${b.kind === 'internal' ? 'Payment request ' + b.internalNo : 'Bill' + (input.billNo ? ' ' + input.billNo : '')}${input.description ? ' — ' + input.description : ''}`;
    const entryId = await post(ctx, id, input, total, vendorId, label);
    await ctx.db.update(bills).set({
      vendorId, payee: input.payee?.trim() || null, projectId: input.projectId ?? null, billNo: input.billNo?.trim() || null, date: input.date,
      dueDate: input.dueDate || null, total: m2(total), taxAmount: m2(input.taxAmount), description: input.description || null, notes: input.notes || null, entryId,
    }).where(eq(bills.id, id));
    for (const d of input.docIds ?? []) await linkDocument(ctx, d, 'bill', id);
    await audit(ctx, 'update', 'bill', id, `Bill #${id} edited (reversed and re-posted)`, { before, after: input });
  });
}

export async function voidBill(ctx0: Ctx, id: number, reason: string) {
  return inTx(ctx0, async ctx => {
    const [b] = await ctx.db.select().from(bills).where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
    if (!b) throw new Error('Bill not found'); if (b.status === 'void') return;
    if (D(b.amountPaid).gt(0)) throw new Error('This bill has payments. Void the payment or check first.');
    if ((await pendingCheckAmount(ctx, id)).gt(0)) throw new Error('This bill is on a draft or printed check. Void that check first.');
    if (b.entryId) await reverseEntry(ctx, b.entryId, { memo: `Void bill #${id}: ${reason}` });
    await ctx.db.update(bills).set({ status: 'void' }).where(eq(bills.id, id));
    await ctx.db.delete(overheadAllocations).where(eq(overheadAllocations.billId, id));
    await audit(ctx, 'void', 'bill', id, `Bill #${id} voided: ${reason}`);
  });
}

/** Spread a general business expense across projects for profitability analysis. Memo-only: the ledger is not changed. */
export async function allocateOverhead(ctx0: Ctx, billId: number, method: 'equal' | 'cost' | 'manual', projectIds: number[], manual?: Record<number, string>) {
  return inTx(ctx0, async ctx => {
    const [b] = await ctx.db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.companyId, ctx.companyId)));
    if (!b || b.status === 'void') throw new Error('Expense not found'); if (b.projectId) throw new Error('Only general business expenses can be allocated');
    if (!projectIds.length) throw new Error('Choose at least one project');
    const total = D(b.total); let shares: { projectId: number; amount: string; basis: string }[] = [];
    if (method === 'manual') {
      shares = projectIds.map(p => ({ projectId: p, amount: m2(manual?.[p]), basis: 'Entered manually' })).filter(s => D(s.amount).gt(0));
      if (shares.reduce((a, s) => a.plus(D(s.amount)), D(0)).gt(total)) throw new Error('Allocations exceed the expense total');
    } else {
      let weights = new Map<number, ReturnType<typeof D>>(projectIds.map(p => [p, D(1)]));
      if (method === 'cost') {
        const costs = await rows<{ project_id: number; cost: string }>(ctx.db, sql`
          SELECT jl.project_id, sum(jl.debit - jl.credit)::text cost FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
          WHERE a.type = 'cogs' AND jl.project_id IN (${sql.join(projectIds.map(p => sql`${p}`), sql`, `)}) GROUP BY jl.project_id`);
        weights = new Map(projectIds.map(p => [p, D(costs.find(c => c.project_id === p)?.cost)]));
        if ([...weights.values()].every(w => w.lte(0))) throw new Error('None of the selected projects have recorded costs yet; use equal split instead');
      }
      const wsum = [...weights.values()].reduce((a, w) => a.plus(w), D(0)); let used = D(0);
      shares = projectIds.map((p, i) => {
        const amt = i === projectIds.length - 1 ? total.minus(used) : total.times(weights.get(p)!).div(wsum).toDecimalPlaces(2);
        used = used.plus(amt);
        return { projectId: p, amount: m2(amt), basis: method === 'equal' ? `Equal split across ${projectIds.length} projects` : `Share of direct cost to date (${m2(weights.get(p)!)} of ${m2(wsum)})` };
      });
    }
    await ctx.db.delete(overheadAllocations).where(eq(overheadAllocations.billId, billId));
    if (shares.length) await ctx.db.insert(overheadAllocations).values(shares.map(s => ({ companyId: ctx.companyId, billId, projectId: s.projectId, amount: s.amount, method, basis: s.basis, createdBy: ctx.userId })));
    await audit(ctx, 'allocate', 'bill', billId, `Overhead allocated (${method}) to ${shares.length} project(s)`, shares);
  });
}
export { inArray };
