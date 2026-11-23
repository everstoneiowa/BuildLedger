import { eq, and, sql } from 'drizzle-orm';
import { type Ctx, schema, nextSeq, one, rows } from '@/db';
import { D, m2, Decimal } from '@/lib/money';
const { accounts, journalEntries, journalLines } = schema;

export type Line = { accountId: number; debit?: Decimal.Value; credit?: Decimal.Value; projectId?: number | null; vendorId?: number | null; clientId?: number | null; categoryId?: number | null; memo?: string | null };
export type EntryInput = { date: string; memo?: string | null; sourceType: string; sourceId?: number | null; reversesId?: number | null; lines: Line[] };

/** The single door into the general ledger. Every financial event posts a balanced, immutable entry through here. */
export async function postEntry(ctx: Ctx, e: EntryInput): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('A valid date is required');
  // A negative amount on one side is normalised to a positive amount on the other.
  const lines = e.lines.map(l => {
    let dr = D(l.debit), cr = D(l.credit);
    if (dr.isNegative()) { cr = cr.plus(dr.abs()); dr = D(0); }
    if (cr.isNegative()) { dr = dr.plus(cr.abs()); cr = D(0); }
    const net = dr.minus(cr);
    return { ...l, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.abs() : D(0) };
  }).filter(l => !l.debit.isZero() || !l.credit.isZero());
  const dr = lines.reduce((a, l) => a.plus(l.debit), D(0)), cr = lines.reduce((a, l) => a.plus(l.credit), D(0));
  if (lines.length < 2 || dr.isZero()) throw new Error('A journal entry needs at least two lines and a non-zero amount');
  if (!dr.equals(cr)) throw new Error(`Journal entry does not balance (debits ${m2(dr)} vs credits ${m2(cr)})`);
  const entryNo = await nextSeq(ctx, 'journal');
  const [je] = await ctx.db.insert(journalEntries).values({
    companyId: ctx.companyId, entryNo, date: e.date, memo: e.memo ?? null, sourceType: e.sourceType, sourceId: e.sourceId ?? null,
    reversesId: e.reversesId ?? null, postedBy: ctx.userId,
  }).returning({ id: journalEntries.id });
  await ctx.db.insert(journalLines).values(lines.map(l => ({
    entryId: je.id, accountId: l.accountId, debit: m2(l.debit), credit: m2(l.credit), projectId: l.projectId ?? null,
    vendorId: l.vendorId ?? null, clientId: l.clientId ?? null, categoryId: l.categoryId ?? null, memo: l.memo ?? null,
  })));
  return je.id;
}

/** Post the mirror image of an entry. The original is never touched. */
export async function reverseEntry(ctx: Ctx, entryId: number, opts: { date?: string; memo?: string } = {}): Promise<number> {
  const [orig] = await ctx.db.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, ctx.companyId)));
  if (!orig) throw new Error('Journal entry not found');
  const already = await one(ctx.db, sql`SELECT id FROM journal_entries WHERE reverses_id = ${entryId}`);
  if (already) throw new Error('This entry has already been reversed');
  if (orig.reversesId) throw new Error('A reversal cannot itself be reversed; post a new entry instead');
  const ls = await ctx.db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  return postEntry(ctx, {
    date: opts.date ?? orig.date, memo: opts.memo ?? `Reversal of entry #${orig.entryNo}${orig.memo ? ' — ' + orig.memo : ''}`,
    sourceType: orig.sourceType, sourceId: orig.sourceId, reversesId: entryId,
    lines: ls.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, projectId: l.projectId, vendorId: l.vendorId, clientId: l.clientId, categoryId: l.categoryId, memo: l.memo })),
  });
}

export async function sysAccount(ctx: Ctx, subtype: 'ar' | 'ap' | 'sales_tax' | 'owner' | 'retained'): Promise<number> {
  const r = await one<{ id: number }>(ctx.db, sql`SELECT id FROM accounts WHERE company_id = ${ctx.companyId} AND subtype = ${subtype} AND system ORDER BY code LIMIT 1`);
  if (!r) throw new Error(`System account "${subtype}" is missing from the chart of accounts`);
  return r.id;
}
export async function accountByCode(ctx: Ctx, code: string): Promise<number> {
  const r = await one<{ id: number }>(ctx.db, sql`SELECT id FROM accounts WHERE company_id = ${ctx.companyId} AND code = ${code}`);
  if (!r) throw new Error(`Account ${code} not found`);
  return r.id;
}
/** Accounts money can be paid from / deposited to: bank, credit card, owner-paid. */
export function paymentAccounts(ctx: Ctx) {
  return rows<{ id: number; code: string; name: string; subtype: string }>(ctx.db, sql`
    SELECT id, code, name, subtype FROM accounts WHERE company_id = ${ctx.companyId} AND active AND subtype IN ('bank','credit_card','owner') ORDER BY code`);
}
/** Integrity check used by tests and the Settings page: the ledger must always balance. */
export async function ledgerBalanced(ctx: Ctx) {
  const r = await one<{ dr: string; cr: string }>(ctx.db, sql`
    SELECT coalesce(sum(jl.debit),0)::text dr, coalesce(sum(jl.credit),0)::text cr FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = ${ctx.companyId}`);
  return { debits: r!.dr, credits: r!.cr, balanced: r!.dr === r!.cr };
}
