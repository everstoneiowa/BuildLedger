import { eq, and } from 'drizzle-orm';
import { type Ctx, schema, inTx, audit, nextSeq } from '@/db';
import { D, m2 } from '@/lib/money';
import { postEntry, reverseEntry, sysAccount, accountByCode } from './accounting';
const { invoices, invoiceLines } = schema;

export type InvoiceInput = { clientId: number; projectId?: number | null; date: string; dueDate?: string | null; taxRate?: string | null; notes?: string | null; paymentInstructions?: string | null; lines: { description: string; quantity: string; unitPrice: string; taxable?: boolean }[] };

function compute(input: InvoiceInput) {
  if (!input.clientId) throw new Error('Choose a client');
  const lines = input.lines.filter(l => l.description?.trim()).map(l => ({ description: l.description.trim(), quantity: D(l.quantity || 1).toFixed(2), unitPrice: m2(l.unitPrice), taxable: !!l.taxable, amount: m2(D(l.quantity || 1).times(D(l.unitPrice))) }));
  if (!lines.length) throw new Error('Add at least one line item');
  const subtotal = lines.reduce((a, l) => a.plus(l.amount), D(0));
  const taxable = lines.filter(l => l.taxable).reduce((a, l) => a.plus(l.amount), D(0));
  const tax = taxable.times(D(input.taxRate)).div(100).toDecimalPlaces(2);
  if (subtotal.lte(0)) throw new Error('The invoice total must be greater than zero');
  return { lines, subtotal, tax, total: subtotal.plus(tax) };
}
async function post(ctx: Ctx, id: number, number: string, input: InvoiceInput, c: ReturnType<typeof compute>) {
  const dims = { clientId: input.clientId, projectId: input.projectId ?? null };
  return postEntry(ctx, {
    date: input.date, memo: `Invoice ${number}`, sourceType: 'invoice', sourceId: id,
    lines: [
      { accountId: await sysAccount(ctx, 'ar'), debit: c.total, ...dims, memo: `Invoice ${number}` },
      { accountId: await accountByCode(ctx, '4000'), credit: c.subtotal, ...dims, memo: `Invoice ${number}` },
      { accountId: await sysAccount(ctx, 'sales_tax'), credit: c.tax, ...dims, memo: `Sales tax — invoice ${number}` },
    ],
  });
}
/** Company-issued invoice to a client. Numbers come from a locked sequence, so they are sequential and never reused. */
export async function createInvoice(ctx0: Ctx, input: InvoiceInput): Promise<number> {
  const c = compute(input);
  return inTx(ctx0, async ctx => {
    const number = `INV-${String(await nextSeq(ctx, 'invoice')).padStart(4, '0')}`;
    const [inv] = await ctx.db.insert(invoices).values({ companyId: ctx.companyId, number, clientId: input.clientId, projectId: input.projectId ?? null, date: input.date, dueDate: input.dueDate || null, taxRate: D(input.taxRate).toFixed(4), subtotal: m2(c.subtotal), taxAmount: m2(c.tax), total: m2(c.total), notes: input.notes || null, paymentInstructions: input.paymentInstructions || null, createdBy: ctx.userId }).returning({ id: invoices.id });
    await ctx.db.insert(invoiceLines).values(c.lines.map(l => ({ invoiceId: inv.id, ...l })));
    const entryId = await post(ctx, inv.id, number, input, c);
    await ctx.db.update(invoices).set({ entryId }).where(eq(invoices.id, inv.id));
    await audit(ctx, 'create', 'invoice', inv.id, `Invoice ${number} issued for ${m2(c.total)}`, input);
    return inv.id;
  });
}
export async function updateInvoice(ctx0: Ctx, id: number, input: InvoiceInput) {
  const c = compute(input);
  return inTx(ctx0, async ctx => {
    const [inv] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.companyId)));
    if (!inv) throw new Error('Invoice not found'); if (inv.status === 'void') throw new Error('A voided invoice cannot be edited');
    if (c.total.lt(inv.amountPaid)) throw new Error(`The total cannot be less than the ${m2(inv.amountPaid)} already received`);
    const before = { ...inv, lines: await ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)) };
    if (inv.entryId) await reverseEntry(ctx, inv.entryId, { memo: `Correction: invoice ${inv.number} edited` });
    await ctx.db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    await ctx.db.insert(invoiceLines).values(c.lines.map(l => ({ invoiceId: id, ...l })));
    const entryId = await post(ctx, id, inv.number, input, c);
    await ctx.db.update(invoices).set({ clientId: input.clientId, projectId: input.projectId ?? null, date: input.date, dueDate: input.dueDate || null, taxRate: D(input.taxRate).toFixed(4), subtotal: m2(c.subtotal), taxAmount: m2(c.tax), total: m2(c.total), notes: input.notes || null, paymentInstructions: input.paymentInstructions || null, entryId }).where(eq(invoices.id, id));
    await audit(ctx, 'update', 'invoice', id, `Invoice ${inv.number} edited (reversed and re-posted)`, { before, after: input });
  });
}
export async function voidInvoice(ctx0: Ctx, id: number, reason: string) {
  return inTx(ctx0, async ctx => {
    const [inv] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.companyId)));
    if (!inv) throw new Error('Invoice not found'); if (inv.status === 'void') return;
    if (D(inv.amountPaid).gt(0)) throw new Error('This invoice has payments recorded. Void the payment first.');
    if (inv.entryId) await reverseEntry(ctx, inv.entryId, { memo: `Void invoice ${inv.number}: ${reason}` });
    await ctx.db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, id));
    await audit(ctx, 'void', 'invoice', id, `Invoice ${inv.number} voided: ${reason}`);
  });
}
