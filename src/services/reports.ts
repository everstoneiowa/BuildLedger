import { sql, type SQL } from 'drizzle-orm';
import { type Ctx, rows, one } from '@/db';
import { D, m2, sum, today, fmtDate } from '@/lib/money';

export type Col = { key: string; label: string; type?: 'money' | 'date' | 'text' | 'number'; width?: number };
export type Section = { heading?: string; columns: Col[]; rows: Record<string, any>[]; totals?: Record<string, any>; note?: string };
export type Report = { key: string; title: string; period: string; basis?: string; sections: Section[]; notes?: string[] };
export type Filters = { from?: string; to?: string; projectId?: number; basis?: 'accrual' | 'cash'; granularity?: 'month' | 'quarter' | 'year'; accountId?: number };

export const BILL_STATUS = sql`CASE WHEN b.status = 'void' THEN 'void' WHEN b.amount_paid >= b.total THEN 'paid' WHEN b.amount_paid > 0 THEN 'partial' ELSE 'unpaid' END`;
export const INV_STATUS = sql`CASE WHEN i.status = 'void' THEN 'void' WHEN i.amount_paid >= i.total THEN 'paid' WHEN i.amount_paid > 0 THEN 'partial' ELSE 'unpaid' END`;
export const PAID_VIA = sql`(SELECT string_agg(DISTINCT CASE WHEN p.method = 'check' THEN 'Check #' || coalesce(p.reference,'') ELSE upper(p.method) END, ', ') FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'posted' WHERE pa.bill_id = b.id)`;
const NOT_CORRECTION = sql`je.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.reverses_id = je.id)`;

export function defaults(f: Filters): Required<Pick<Filters, 'from' | 'to' | 'basis'>> & Filters {
  const t = today();
  return { ...f, from: f.from || `${t.slice(0, 4)}-01-01`, to: f.to || t, basis: f.basis === 'cash' ? 'cash' : 'accrual' };
}
const periodLabel = (f: { from: string; to: string }) => `${fmtDate(f.from)} – ${fmtDate(f.to)}`;
const basisLabel = (b: string) => (b === 'cash' ? 'Cash basis' : 'Accrual basis');

/**
 * Income-statement activity as a sub-query: (date, account_id, category_id, project_id, vendor_id, type, amount).
 * Accrual reads the general ledger directly. Cash basis recognises bills/invoices only as they are paid
 * (each payment is pro-rated across the bill's lines), plus any entries posted directly to income/expense accounts.
 */
export function plBase(ctx: Ctx, basis: 'accrual' | 'cash'): SQL {
  const direct = sql`
    SELECT je.date, jl.account_id, jl.category_id, jl.project_id, jl.vendor_id, a.type,
      CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END AS amount
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ${ctx.companyId} AND a.type IN ('revenue','cogs','expense')`;
  if (basis === 'accrual') return direct;
  return sql`${direct} AND je.source_type NOT IN ('bill','invoice')
    UNION ALL
    SELECT p.date, c.account_id, bl.category_id, bl.project_id, b.vendor_id, a.type, round(bl.amount * pa.amount / b.total, 2)
    FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'posted' JOIN bills b ON b.id = pa.bill_id
      JOIN bill_lines bl ON bl.bill_id = b.id JOIN categories c ON c.id = bl.category_id JOIN accounts a ON a.id = c.account_id
    WHERE p.company_id = ${ctx.companyId}
    UNION ALL
    SELECT p.date, rev.id, NULL, i.project_id, NULL, 'revenue', round(pa.amount * i.subtotal / i.total, 2)
    FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'posted' JOIN invoices i ON i.id = pa.invoice_id
      JOIN accounts rev ON rev.company_id = i.company_id AND rev.code = '4000'
    WHERE p.company_id = ${ctx.companyId}`;
}
const projFilter = (f: Filters, col = sql`x.project_id`) => (f.projectId ? sql`AND ${col} = ${f.projectId}` : sql``);

/* ───────────── Project financial summary (used by workspaces, dashboard, reports) ───────────── */
export async function projectSummaries(ctx: Ctx, opts: { projectId?: number; basis?: 'accrual' | 'cash' } = {}) {
  const basis = opts.basis ?? 'accrual';
  const r = await rows<any>(ctx.db, sql`
    SELECT p.id, p.name, p.number, p.status, p.address, p.budget::text, p.contract_price::text, cl.name client,
      coalesce((SELECT sum(amount) FROM project_budgets pb WHERE pb.project_id = p.id), 0)::text line_budget,
      coalesce((SELECT sum(budget_change) FROM change_orders co WHERE co.project_id = p.id AND co.status = 'approved'), 0)::text co_budget,
      coalesce((SELECT sum(price_change) FROM change_orders co WHERE co.project_id = p.id AND co.status = 'approved'), 0)::text co_price,
      coalesce((SELECT sum(x.amount) FROM (${plBase(ctx, basis)}) x WHERE x.project_id = p.id AND x.type <> 'revenue'), 0)::text cost,
      coalesce((SELECT sum(x.amount) FROM (${plBase(ctx, basis)}) x WHERE x.project_id = p.id AND x.type = 'revenue'), 0)::text revenue,
      coalesce((SELECT sum(x.amount) FROM (${plBase(ctx, 'cash')}) x WHERE x.project_id = p.id AND x.type <> 'revenue'), 0)::text paid,
      coalesce((SELECT sum(bl.amount * (b.total - b.amount_paid) / b.total) FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id WHERE bl.project_id = p.id AND b.status = 'open'), 0)::text unpaid,
      coalesce((SELECT sum(amount) FROM overhead_allocations oa WHERE oa.project_id = p.id), 0)::text overhead
    FROM projects p LEFT JOIN clients cl ON cl.id = p.client_id
    WHERE p.company_id = ${ctx.companyId} ${opts.projectId ? sql`AND p.id = ${opts.projectId}` : sql``} ORDER BY p.number`);
  return r.map(p => {
    const original = D(p.line_budget).gt(0) ? D(p.line_budget) : D(p.budget);
    const revised = original.plus(p.co_budget), cost = D(p.cost), revenue = D(p.revenue), contract = D(p.contract_price).plus(p.co_price);
    const gross = revenue.minus(cost);
    return {
      id: p.id as number, name: p.name as string, number: p.number as string, status: p.status as string, address: p.address as string | null, client: p.client as string | null,
      originalBudget: m2(original), revisedBudget: m2(revised), actualCost: m2(cost), paid: m2(p.paid), unpaid: m2(D(p.unpaid).toDecimalPlaces(2)),
      remainingBudget: m2(revised.minus(cost)), variance: m2(revised.minus(cost)), contractPrice: m2(contract), revenue: m2(revenue),
      grossProfit: m2(gross), margin: revenue.isZero() ? null : gross.div(revenue).times(100).toFixed(1),
      overhead: m2(p.overhead), netProfit: m2(gross.minus(p.overhead)),
      // Forecast: expected revenue less the larger of the revised budget and what has actually been spent.
      estimatedProfit: m2(contract.minus(cost.gt(revised) ? cost : revised)),
    };
  });
}

export function categoryBreakdown(ctx: Ctx, f: Filters & { kind?: 'project' | 'overhead' }) {
  const d = defaults(f);
  return rows<{ category: string; amount: string }>(ctx.db, sql`
    SELECT coalesce(c.name, a.name) category, sum(x.amount)::text amount FROM (${plBase(ctx, d.basis)}) x
      JOIN accounts a ON a.id = x.account_id LEFT JOIN categories c ON c.id = x.category_id
    WHERE x.type <> 'revenue' AND x.date BETWEEN ${d.from}::date AND ${d.to}::date ${projFilter(f)}
      ${f.kind === 'project' ? sql`AND x.type = 'cogs'` : f.kind === 'overhead' ? sql`AND x.type = 'expense'` : sql``}
    GROUP BY 1 HAVING sum(x.amount) <> 0 ORDER BY sum(x.amount) DESC`);
}
export function activityByPeriod(ctx: Ctx, f: Filters) {
  const d = defaults(f); const g = f.granularity ?? 'month';
  return rows<{ period: string; revenue: string; cogs: string; overhead: string }>(ctx.db, sql`
    SELECT to_char(date_trunc(${g}, x.date), ${g === 'year' ? 'YYYY' : g === 'quarter' ? 'YYYY "Q"Q' : 'YYYY-MM'}) period,
      coalesce(sum(x.amount) FILTER (WHERE x.type = 'revenue'), 0)::text revenue,
      coalesce(sum(x.amount) FILTER (WHERE x.type = 'cogs'), 0)::text cogs,
      coalesce(sum(x.amount) FILTER (WHERE x.type = 'expense'), 0)::text overhead
    FROM (${plBase(ctx, d.basis)}) x WHERE x.date BETWEEN ${d.from}::date AND ${d.to}::date ${projFilter(f)} GROUP BY 1 ORDER BY 1`);
}

/** The project ledger is a filtered view of the general ledger, joined back to the documents that created each entry. */
export function projectLedger(ctx: Ctx, f: { projectId?: number | null; from?: string; to?: string; overheadOnly?: boolean }) {
  return rows<any>(ctx.db, sql`
    SELECT jl.id, je.date::text date, je.entry_no, coalesce(v.name, b.payee, cl.name, '') party, coalesce(jl.memo, je.memo, '') description,
      coalesce(cat.name, a.name) category, a.type, coalesce(b.bill_no, i.number, '') ref, b.id bill_id, i.id invoice_id, pr.name project, jl.project_id,
      (CASE WHEN a.type = 'revenue' THEN 0 ELSE jl.debit - jl.credit END)::text cost,
      (CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END)::text revenue,
      CASE WHEN b.id IS NOT NULL THEN ${BILL_STATUS} WHEN i.id IS NOT NULL THEN ${INV_STATUS} ELSE '' END status,
      CASE WHEN b.id IS NOT NULL THEN ${PAID_VIA} ELSE '' END paid_via, b.tax_amount::text tax,
      (SELECT count(*)::int FROM document_links dl WHERE dl.entity_type = 'bill' AND dl.entity_id = b.id) docs
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      LEFT JOIN bills b ON je.source_type = 'bill' AND b.id = je.source_id LEFT JOIN invoices i ON je.source_type = 'invoice' AND i.id = je.source_id
      LEFT JOIN vendors v ON v.id = jl.vendor_id LEFT JOIN clients cl ON cl.id = jl.client_id LEFT JOIN categories cat ON cat.id = jl.category_id
      LEFT JOIN projects pr ON pr.id = jl.project_id
    WHERE je.company_id = ${ctx.companyId} AND a.type IN ('revenue','cogs','expense') AND ${NOT_CORRECTION}
      ${f.projectId ? sql`AND jl.project_id = ${f.projectId}` : sql``} ${f.overheadOnly ? sql`AND jl.project_id IS NULL AND a.type = 'expense'` : sql``}
      ${f.from ? sql`AND je.date >= ${f.from}::date` : sql``} ${f.to ? sql`AND je.date <= ${f.to}::date` : sql``}
    ORDER BY je.date, jl.id`);
}

/* ───────────── Report definitions ───────────── */
const sumCol = (rs: Record<string, any>[], k: string) => m2(sum(rs.map(r => r[k])));

async function profitLoss(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0);
  const r = await rows<any>(ctx.db, sql`
    SELECT x.type, a.code, CASE WHEN x.type = 'cogs' THEN coalesce(c.name, a.name) ELSE a.name END AS name, sum(x.amount)::text amount
    FROM (${plBase(ctx, f.basis)}) x JOIN accounts a ON a.id = x.account_id LEFT JOIN categories c ON c.id = x.category_id
    WHERE x.date BETWEEN ${f.from}::date AND ${f.to}::date ${projFilter(f)} GROUP BY 1, 2, 3 HAVING sum(x.amount) <> 0 ORDER BY a.code, 3`);
  const cols: Col[] = [{ key: 'code', label: 'Account', width: 12 }, { key: 'name', label: 'Description' }, { key: 'amount', label: 'Amount', type: 'money' }];
  const sec = (type: string, heading: string, label: string): Section => { const rs = r.filter(x => x.type === type); return { heading, columns: cols, rows: rs, totals: { name: label, amount: sumCol(rs, 'amount') } }; };
  const rev = sec('revenue', 'Revenue', 'Total revenue'), cogs = sec('cogs', 'Direct construction costs', 'Total direct costs'), exp = sec('expense', 'Overhead / general business expenses', 'Total overhead');
  const gross = D(String(rev.totals!.amount)).minus(String(cogs.totals!.amount)), net = gross.minus(String(exp.totals!.amount));
  return {
    key: 'profit-loss', title: 'Profit & Loss', period: periodLabel(f), basis: basisLabel(f.basis), sections: [rev, cogs, exp,
      { heading: 'Summary', columns: [{ key: 'name', label: '' }, { key: 'amount', label: 'Amount', type: 'money' }], rows: [{ name: 'Gross profit', amount: m2(gross) }, { name: 'Net income', amount: m2(net) }] }],
    notes: [f.basis === 'cash' ? 'Cash basis: bills and invoices are recognised when paid; each payment is pro-rated across the lines of its bill.' : 'Accrual basis: costs are recognised when billed and revenue when invoiced. Project costs are expensed as incurred (no work-in-progress capitalisation).', 'Prepared from company records to assist your accountant. This report does not determine tax deductibility.'],
  };
}

async function accountBalances(ctx: Ctx, to: string, from?: string) {
  return rows<{ id: number; code: string; name: string; type: string; dr: string; cr: string }>(ctx.db, sql`
    SELECT a.id, a.code, a.name, a.type, coalesce(sum(jl.debit),0)::text dr, coalesce(sum(jl.credit),0)::text cr
    FROM accounts a LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id AND je.date <= ${to}::date ${from ? sql`AND je.date >= ${from}::date` : sql``}) ON jl.account_id = a.id
    WHERE a.company_id = ${ctx.companyId} GROUP BY a.id ORDER BY a.code`);
}
async function trialBalance(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0); const b = await accountBalances(ctx, f.to);
  const rs = b.map(a => { const net = D(a.dr).minus(a.cr); return { code: a.code, name: a.name, type: a.type, debit: net.gt(0) ? m2(net) : '', credit: net.lt(0) ? m2(net.abs()) : '', _z: net.isZero() }; }).filter(r => !r._z);
  return { key: 'trial-balance', title: 'Trial Balance', period: `As of ${fmtDate(f.to)}`, basis: 'Accrual basis', sections: [{ columns: [{ key: 'code', label: 'Account', width: 12 }, { key: 'name', label: 'Name' }, { key: 'type', label: 'Type', width: 14 }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }], rows: rs, totals: { name: 'Totals', debit: sumCol(rs, 'debit'), credit: sumCol(rs, 'credit') } }] };
}
async function balanceSheet(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0); const b = await accountBalances(ctx, f.to);
  const cols: Col[] = [{ key: 'code', label: 'Account', width: 12 }, { key: 'name', label: 'Name' }, { key: 'amount', label: 'Balance', type: 'money' }];
  const pick = (type: string, sign: 1 | -1) => b.filter(a => a.type === type).map(a => ({ code: a.code, name: a.name, amount: m2(D(a.dr).minus(a.cr).times(sign)) })).filter(a => !D(a.amount).isZero());
  const assets = pick('asset', 1), liabs = pick('liability', -1), equity = pick('equity', -1);
  const earnings = b.filter(a => ['revenue', 'cogs', 'expense'].includes(a.type)).reduce((s, a) => s.plus(D(a.cr).minus(a.dr)), D(0));
  equity.push({ code: '', name: 'Net income to date (not yet closed to equity)', amount: m2(earnings) });
  const tA = sumCol(assets, 'amount'), tL = sumCol(liabs, 'amount'), tE = sumCol(equity, 'amount');
  return {
    key: 'balance-sheet', title: 'Balance Sheet', period: `As of ${fmtDate(f.to)}`, basis: 'Accrual basis', sections: [
      { heading: 'Assets', columns: cols, rows: assets, totals: { name: 'Total assets', amount: tA } },
      { heading: 'Liabilities', columns: cols, rows: liabs, totals: { name: 'Total liabilities', amount: tL } },
      { heading: 'Equity', columns: cols, rows: equity, totals: { name: 'Total equity', amount: tE } },
      { heading: 'Check', columns: [{ key: 'name', label: '' }, { key: 'amount', label: 'Amount', type: 'money' }], rows: [{ name: 'Total liabilities + equity', amount: m2(D(tL).plus(tE)) }, { name: 'Difference from total assets (must be 0.00)', amount: m2(D(tA).minus(tL).minus(tE)) }] }],
  };
}
async function generalLedger(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0);
  const rs = await rows<any>(ctx.db, sql`
    SELECT je.date::text date, je.entry_no entry, a.code || ' ' || a.name account, coalesce(jl.memo, je.memo, '') memo, coalesce(p.number, '') project, coalesce(v.name, c.name, '') party,
      CASE WHEN jl.debit > 0 THEN jl.debit::text ELSE '' END debit, CASE WHEN jl.credit > 0 THEN jl.credit::text ELSE '' END credit,
      CASE WHEN je.reverses_id IS NOT NULL THEN 'Reversal' ELSE je.source_type END source
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      LEFT JOIN projects p ON p.id = jl.project_id LEFT JOIN vendors v ON v.id = jl.vendor_id LEFT JOIN clients c ON c.id = jl.client_id
    WHERE je.company_id = ${ctx.companyId} AND je.date BETWEEN ${f.from}::date AND ${f.to}::date ${f.projectId ? sql`AND jl.project_id = ${f.projectId}` : sql``} ${f.accountId ? sql`AND jl.account_id = ${f.accountId}` : sql``}
    ORDER BY je.date, je.entry_no, jl.id`);
  return { key: 'general-ledger', title: 'General Ledger', period: periodLabel(f), basis: 'Accrual basis', sections: [{ columns: [{ key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'entry', label: 'Entry', width: 7 }, { key: 'account', label: 'Account' }, { key: 'memo', label: 'Memo' }, { key: 'project', label: 'Project', width: 10 }, { key: 'party', label: 'Vendor / client' }, { key: 'source', label: 'Source', width: 10 }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }], rows: rs, totals: { memo: 'Totals', debit: sumCol(rs, 'debit'), credit: sumCol(rs, 'credit') } }], notes: ['Includes every posted entry, including reversals created by corrections and voids.'] };
}
const LEDGER_COLS: Col[] = [{ key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'party', label: 'Vendor / payee' }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'ref', label: 'Invoice #', width: 12 }, { key: 'paid_via', label: 'Paid via', width: 14 }, { key: 'status', label: 'Status', width: 9 }, { key: 'cost', label: 'Amount', type: 'money' }];
async function projectLedgerReport(ctx: Ctx, f: Filters): Promise<Report> {
  if (!f.projectId) throw new Error('Choose a project');
  const [p] = await projectSummaries(ctx, { projectId: f.projectId }); if (!p) throw new Error('Project not found');
  const rs = (await projectLedger(ctx, { projectId: f.projectId, from: f.from, to: f.to })).filter(r => r.type !== 'revenue');
  return { key: 'project-ledger', title: `Project Expense Ledger — ${p.number} ${p.name}`, period: f.from || f.to ? periodLabel(defaults(f)) : 'Project to date', basis: 'Accrual basis', sections: [{ columns: LEDGER_COLS, rows: rs, totals: { description: 'Total project cost', cost: sumCol(rs, 'cost') } }] };
}
async function finalProject(ctx: Ctx, f: Filters): Promise<Report> {
  if (!f.projectId) throw new Error('Choose a project');
  const [p] = await projectSummaries(ctx, { projectId: f.projectId }); if (!p) throw new Error('Project not found');
  const info = await one<any>(ctx.db, sql`SELECT start_date::text, est_completion::text, actual_completion::text, description FROM projects WHERE id = ${f.projectId}`);
  const led = await projectLedger(ctx, { projectId: f.projectId });
  const costs = led.filter(r => r.type !== 'revenue'), revs = led.filter(r => r.type === 'revenue');
  const byCat = new Map<string, ReturnType<typeof D>>(); costs.forEach(r => byCat.set(r.category, (byCat.get(r.category) ?? D(0)).plus(r.cost)));
  const vend = await rows<any>(ctx.db, sql`
    SELECT v.name vendor, coalesce(v.trade,'') trade, sum(bl.amount)::text billed, sum(bl.amount * b.amount_paid / b.total)::numeric(14,2)::text paid, sum(bl.amount * (b.total - b.amount_paid) / b.total)::numeric(14,2)::text owed
    FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id AND b.status = 'open' JOIN vendors v ON v.id = b.vendor_id WHERE bl.project_id = ${f.projectId} GROUP BY v.id ORDER BY sum(bl.amount) DESC`);
  const docs = await rows<any>(ctx.db, sql`
    SELECT d.name, d.folder, to_char(d.uploaded_at, 'YYYY-MM-DD') uploaded, 'DOC-' || d.id ref FROM documents d
    WHERE d.deleted_at IS NULL AND d.is_current AND d.id IN (SELECT document_id FROM document_links WHERE entity_type = 'project' AND entity_id = ${f.projectId}) ORDER BY d.folder, d.name`);
  const kv: Col[] = [{ key: 'name', label: '' }, { key: 'value', label: '' }]; const kvm: Col[] = [{ key: 'name', label: '' }, { key: 'amount', label: 'Amount', type: 'money' }];
  return {
    key: 'final-project', title: `Final Project Ledger — ${p.number} ${p.name}`, period: 'Project to date', basis: 'Accrual basis', sections: [
      { heading: 'Project information', columns: kv, rows: [{ name: 'Property address', value: p.address ?? '' }, { name: 'Client / owner', value: p.client ?? '' }, { name: 'Status', value: p.status }, { name: 'Start date', value: fmtDate(info?.start_date) }, { name: 'Completion date', value: fmtDate(info?.actual_completion ?? info?.est_completion) }, { name: 'Description', value: info?.description ?? '' }] },
      { heading: 'Financial summary', columns: kvm, rows: [{ name: 'Original budget', amount: p.originalBudget }, { name: 'Revised budget (with approved change orders)', amount: p.revisedBudget }, { name: 'Overall construction cost', amount: p.actualCost }, { name: 'Budget variance (under / -over)', amount: p.variance }, { name: 'Total revenue', amount: p.revenue }, { name: 'Gross profit', amount: p.grossProfit }, { name: 'Allocated overhead', amount: p.overhead }, { name: 'Estimated net project profit', amount: p.netProfit }, { name: 'Still unpaid to vendors', amount: p.unpaid }], note: p.margin ? `Gross margin ${p.margin}%` : undefined },
      { heading: 'Cost by category', columns: [{ key: 'name', label: 'Category' }, { key: 'amount', label: 'Amount', type: 'money' }], rows: [...byCat].map(([name, v]) => ({ name, amount: m2(v) })).sort((a, b) => Number(b.amount) - Number(a.amount)), totals: { name: 'Total', amount: p.actualCost } },
      { heading: 'Vendor payment details', columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'trade', label: 'Trade' }, { key: 'billed', label: 'Billed', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'owed', label: 'Unpaid', type: 'money' }], rows: vend, totals: { vendor: 'Total', billed: sumCol(vend, 'billed'), paid: sumCol(vend, 'paid'), owed: sumCol(vend, 'owed') } },
      { heading: 'All expenses', columns: LEDGER_COLS, rows: costs, totals: { description: 'Total', cost: sumCol(costs, 'cost') } },
      { heading: 'All revenue', columns: [{ key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'party', label: 'Client' }, { key: 'description', label: 'Description' }, { key: 'ref', label: 'Invoice #' }, { key: 'status', label: 'Status' }, { key: 'revenue', label: 'Amount', type: 'money' }], rows: revs, totals: { description: 'Total', revenue: sumCol(revs, 'revenue') } },
      { heading: 'Supporting documents on file', columns: [{ key: 'ref', label: 'Ref', width: 10 }, { key: 'name', label: 'Document' }, { key: 'folder', label: 'Folder' }, { key: 'uploaded', label: 'Uploaded', type: 'date', width: 11 }], rows: docs }],
  };
}
async function profitability(ctx: Ctx, f: Filters): Promise<Report> {
  const basis = f.basis === 'cash' ? 'cash' : 'accrual'; const ps = await projectSummaries(ctx, { basis });
  const rs = ps.map(p => ({ project: `${p.number} ${p.name}`, status: p.status, budget: p.revisedBudget, cost: p.actualCost, variance: p.variance, revenue: p.revenue, gross: p.grossProfit, margin: p.margin ? p.margin + '%' : '', overhead: p.overhead, net: p.netProfit }));
  return { key: 'project-profitability', title: 'Project Profitability', period: 'Project to date', basis: basisLabel(basis), sections: [{ columns: [{ key: 'project', label: 'Project' }, { key: 'status', label: 'Status', width: 10 }, { key: 'budget', label: 'Revised budget', type: 'money' }, { key: 'cost', label: 'Actual cost', type: 'money' }, { key: 'variance', label: 'Variance', type: 'money' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'gross', label: 'Gross profit', type: 'money' }, { key: 'margin', label: 'Margin', width: 8 }, { key: 'overhead', label: 'Alloc. overhead', type: 'money' }, { key: 'net', label: 'Est. net profit', type: 'money' }], rows: rs, totals: { project: 'Totals', ...Object.fromEntries(['budget', 'cost', 'variance', 'revenue', 'gross', 'overhead', 'net'].map(k => [k, sumCol(rs, k)])) } }] };
}
async function vendorPayments(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0);
  const rs = await rows<any>(ctx.db, sql`
    SELECT v.name vendor, coalesce(v.trade,'') trade, CASE WHEN v.is_1099 THEN 'Yes' ELSE '' END is1099, count(DISTINCT p.id)::int payments, sum(pa.amount)::text paid,
      (SELECT coalesce(sum(b2.total - b2.amount_paid),0)::text FROM bills b2 WHERE b2.vendor_id = v.id AND b2.status = 'open') owed
    FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id AND p.status = 'posted' AND p.direction = 'out' JOIN bills b ON b.id = pa.bill_id JOIN vendors v ON v.id = b.vendor_id
    WHERE p.company_id = ${ctx.companyId} AND p.date BETWEEN ${f.from}::date AND ${f.to}::date ${f.projectId ? sql`AND b.project_id = ${f.projectId}` : sql``}
    GROUP BY v.id ORDER BY sum(pa.amount) DESC`);
  return { key: 'vendor-payments', title: 'Vendor Payment Summary', period: periodLabel(f), basis: 'Payments made (cash)', sections: [{ columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'trade', label: 'Trade' }, { key: 'is1099', label: '1099', width: 7 }, { key: 'payments', label: 'Payments', type: 'number', width: 10 }, { key: 'paid', label: 'Paid in period', type: 'money' }, { key: 'owed', label: 'Currently owed', type: 'money' }], rows: rs, totals: { vendor: 'Totals', paid: sumCol(rs, 'paid'), owed: sumCol(rs, 'owed') } }] };
}
async function checkRegister(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0);
  const rs = await rows<any>(ctx.db, sql`
    SELECT c.number, c.date::text date, c.payee, coalesce(c.memo,'') memo, coalesce(p.number,'') project, ba.name bank, c.status, coalesce(c.cleared_at::text,'') cleared, c.amount::text amount
    FROM checks c JOIN bank_accounts ba ON ba.id = c.bank_account_id LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.company_id = ${ctx.companyId} AND c.date BETWEEN ${f.from}::date AND ${f.to}::date ${f.projectId ? sql`AND c.project_id = ${f.projectId}` : sql``} ORDER BY ba.name, c.number`);
  const live = rs.filter(r => r.status !== 'voided');
  return { key: 'check-register', title: 'Check Register', period: periodLabel(f), sections: [{ columns: [{ key: 'number', label: 'Check #', width: 9 }, { key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'payee', label: 'Payee' }, { key: 'memo', label: 'Memo' }, { key: 'project', label: 'Project', width: 10 }, { key: 'bank', label: 'Account' }, { key: 'status', label: 'Status', width: 9 }, { key: 'cleared', label: 'Cleared', type: 'date', width: 11 }, { key: 'amount', label: 'Amount', type: 'money' }], rows: rs, totals: { payee: 'Total (excluding voided)', amount: sumCol(live, 'amount') } }] };
}
const bucket = (days: number) => (days <= 0 ? 'Current' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'Over 90 days');
async function unpaidBills(ctx: Ctx, f: Filters): Promise<Report> {
  const rs = (await rows<any>(ctx.db, sql`
    SELECT coalesce(v.name, b.payee) vendor, coalesce(b.bill_no, b.internal_no, '') ref, b.date::text date, coalesce(b.due_date::text,'') due, coalesce(p.number,'General') project,
      (CURRENT_DATE - coalesce(b.due_date, b.date))::int days, b.total::text total, b.amount_paid::text paid, (b.total - b.amount_paid)::text balance
    FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id
    WHERE b.company_id = ${ctx.companyId} AND b.status = 'open' AND b.amount_paid < b.total ${f.projectId ? sql`AND b.project_id = ${f.projectId}` : sql``} ORDER BY coalesce(b.due_date, b.date)`)).map(r => ({ ...r, aging: bucket(r.days) }));
  return { key: 'unpaid-bills', title: 'Unpaid Bills (Accounts Payable Aging)', period: `As of ${fmtDate(today())}`, sections: [{ columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'ref', label: 'Invoice #' }, { key: 'project', label: 'Project', width: 10 }, { key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'due', label: 'Due', type: 'date', width: 11 }, { key: 'aging', label: 'Aging', width: 12 }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }], rows: rs, totals: { vendor: 'Total outstanding', balance: sumCol(rs, 'balance') } }] };
}
async function arAging(ctx: Ctx, f: Filters): Promise<Report> {
  const rs = (await rows<any>(ctx.db, sql`
    SELECT c.name client, i.number, i.date::text date, coalesce(i.due_date::text,'') due, coalesce(p.number,'') project, (CURRENT_DATE - coalesce(i.due_date, i.date))::int days,
      i.total::text total, i.amount_paid::text paid, (i.total - i.amount_paid)::text balance
    FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.company_id = ${ctx.companyId} AND i.status = 'open' AND i.amount_paid < i.total ${f.projectId ? sql`AND i.project_id = ${f.projectId}` : sql``} ORDER BY coalesce(i.due_date, i.date)`)).map(r => ({ ...r, aging: bucket(r.days) }));
  return { key: 'ar-aging', title: 'Outstanding Invoices (Accounts Receivable Aging)', period: `As of ${fmtDate(today())}`, sections: [{ columns: [{ key: 'client', label: 'Client' }, { key: 'number', label: 'Invoice #' }, { key: 'project', label: 'Project', width: 10 }, { key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'due', label: 'Due', type: 'date', width: 11 }, { key: 'aging', label: 'Aging', width: 12 }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Received', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }], rows: rs, totals: { client: 'Total outstanding', balance: sumCol(rs, 'balance') } }] };
}
export function mileageTrips(ctx: Ctx, f: { from?: string; to?: string; projectId?: number }) {
  // The rate applied to each trip is the one in effect on the trip date.
  return rows<any>(ctx.db, sql`
    SELECT t.id, t.date::text date, coalesce(t.origin,'') origin, coalesce(t.destination,'') destination, t.purpose, coalesce(p.number || ' ' || p.name,'') project, t.project_id, t.vehicle_id,
      coalesce(v.name,'') vehicle, coalesce(t.odo_start::text,'') odo_start, coalesce(t.odo_end::text,'') odo_end, t.miles::text miles, coalesce(t.notes,'') notes, coalesce(r.rate::text,'') rate,
      round(t.miles * coalesce(r.rate, 0), 2)::text deduction
    FROM mileage_trips t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN LATERAL (SELECT rate FROM mileage_rates mr WHERE mr.company_id = t.company_id AND mr.effective_from <= t.date ORDER BY mr.effective_from DESC LIMIT 1) r ON true
    WHERE t.company_id = ${ctx.companyId} ${f.from ? sql`AND t.date >= ${f.from}::date` : sql``} ${f.to ? sql`AND t.date <= ${f.to}::date` : sql``} ${f.projectId ? sql`AND t.project_id = ${f.projectId}` : sql``}
    ORDER BY t.date DESC, t.id DESC`);
}
async function mileageReport(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0); const trips = (await mileageTrips(ctx, f)).reverse();
  const group = (keyOf: (t: any) => string, label: string): Section => {
    const m = new Map<string, { miles: ReturnType<typeof D>; ded: ReturnType<typeof D>; n: number }>();
    trips.forEach(t => { const k = keyOf(t); const g = m.get(k) ?? { miles: D(0), ded: D(0), n: 0 }; m.set(k, { miles: g.miles.plus(t.miles), ded: g.ded.plus(t.deduction), n: g.n + 1 }); });
    const rs = [...m].sort().map(([k, g]) => ({ k, trips: g.n, miles: g.miles.toFixed(1), deduction: m2(g.ded) }));
    return { heading: `Mileage by ${label}`, columns: [{ key: 'k', label: label[0].toUpperCase() + label.slice(1) }, { key: 'trips', label: 'Trips', type: 'number' }, { key: 'miles', label: 'Miles', type: 'number' }, { key: 'deduction', label: 'Est. deduction', type: 'money' }], rows: rs, totals: { k: 'Total', miles: rs.reduce((a, r) => a.plus(r.miles), D(0)).toFixed(1), deduction: sumCol(rs, 'deduction') } };
  };
  const q = (d: string) => `${d.slice(0, 4)} Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
  return { key: 'mileage', title: 'Business Mileage & Estimated Deduction', period: periodLabel(f), sections: [group(t => t.date.slice(0, 7), 'month'), group(t => q(t.date), 'quarter'), group(t => t.date.slice(0, 4), 'year'), group(t => t.project || 'General business', 'project'),
    { heading: 'Mileage log', columns: [{ key: 'date', label: 'Date', type: 'date', width: 11 }, { key: 'origin', label: 'From' }, { key: 'destination', label: 'To' }, { key: 'purpose', label: 'Business purpose' }, { key: 'project', label: 'Project' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'odo_start', label: 'Odo start', type: 'number' }, { key: 'odo_end', label: 'Odo end', type: 'number' }, { key: 'miles', label: 'Miles', type: 'number' }, { key: 'rate', label: 'Rate', type: 'number' }, { key: 'deduction', label: 'Deduction', type: 'money' }], rows: trips }],
    notes: ['Estimated deduction = miles × the standard mileage rate in effect on each trip date (configured in Settings). Confirm rates and eligibility with your tax preparer.'] };
}
async function businessExpenses(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0); const rs = await projectLedger(ctx, { overheadOnly: true, from: f.from, to: f.to });
  const byCat = new Map<string, ReturnType<typeof D>>(); rs.forEach(r => byCat.set(r.category, (byCat.get(r.category) ?? D(0)).plus(r.cost)));
  return { key: 'business-expenses', title: 'General Business Expenses', period: periodLabel(f), basis: 'Accrual basis', sections: [
    { heading: 'By category', columns: [{ key: 'name', label: 'Category' }, { key: 'amount', label: 'Amount', type: 'money' }], rows: [...byCat].map(([name, v]) => ({ name, amount: m2(v) })), totals: { name: 'Total', amount: sumCol(rs, 'cost') } },
    { heading: 'Detail', columns: LEDGER_COLS, rows: rs, totals: { description: 'Total', cost: sumCol(rs, 'cost') } }] };
}
async function cashFlow(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0);
  const open = await one<{ bal: string }>(ctx.db, sql`SELECT coalesce(sum(jl.debit - jl.credit),0)::text bal FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = ${ctx.companyId} AND a.subtype = 'bank' AND je.date < ${f.from}::date`);
  const rs = await rows<any>(ctx.db, sql`
    SELECT to_char(je.date, 'YYYY-MM') period, sum(jl.debit)::text cash_in, sum(jl.credit)::text cash_out, sum(jl.debit - jl.credit)::text net
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ${ctx.companyId} AND a.subtype = 'bank' AND je.date BETWEEN ${f.from}::date AND ${f.to}::date AND ${NOT_CORRECTION} GROUP BY 1 ORDER BY 1`);
  let bal = D(open!.bal); const out = rs.map(r => { bal = bal.plus(r.net); return { ...r, balance: m2(bal) }; });
  return { key: 'cash-flow', title: 'Cash Flow (bank accounts, by month)', period: periodLabel(f), basis: 'Cash movements', sections: [{ note: `Opening cash balance: ${m2(open!.bal)}`, columns: [{ key: 'period', label: 'Month' }, { key: 'cash_in', label: 'Money in', type: 'money' }, { key: 'cash_out', label: 'Money out', type: 'money' }, { key: 'net', label: 'Net change', type: 'money' }, { key: 'balance', label: 'Ending cash', type: 'money' }], rows: out, totals: { period: 'Totals', cash_in: sumCol(rs, 'cash_in'), cash_out: sumCol(rs, 'cash_out'), net: sumCol(rs, 'net') } }], notes: ['Direct-method summary of book activity in bank accounts. Issued checks count when issued, not when they clear.'] };
}
async function performance(ctx: Ctx, f0: Filters): Promise<Report> {
  const f = defaults(f0); const g = f.granularity ?? 'quarter';
  const rs = (await activityByPeriod(ctx, { ...f, granularity: g })).map(r => { const gross = D(r.revenue).minus(r.cogs); return { ...r, gross: m2(gross), net: m2(gross.minus(r.overhead)) }; });
  const name = g === 'month' ? 'Monthly' : g === 'year' ? 'Annual' : 'Quarterly';
  return { key: 'performance', title: `${name} Financial Summary`, period: periodLabel(f), basis: basisLabel(f.basis), sections: [{ columns: [{ key: 'period', label: 'Period' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'cogs', label: 'Direct costs', type: 'money' }, { key: 'gross', label: 'Gross profit', type: 'money' }, { key: 'overhead', label: 'Overhead', type: 'money' }, { key: 'net', label: 'Net income', type: 'money' }], rows: rs, totals: { period: 'Totals', ...Object.fromEntries(['revenue', 'cogs', 'gross', 'overhead', 'net'].map(k => [k, sumCol(rs, k)])) } }] };
}

export type Param = 'range' | 'asof' | 'project' | 'projectRequired' | 'basis' | 'granularity';
export const REPORTS: { key: string; title: string; desc: string; group: string; params: Param[]; run: (ctx: Ctx, f: Filters) => Promise<Report> }[] = [
  { key: 'profit-loss', title: 'Profit & Loss', desc: 'Revenue, direct costs, overhead and net income', group: 'Company financials', params: ['range', 'basis', 'project'], run: profitLoss },
  { key: 'balance-sheet', title: 'Balance Sheet', desc: 'Assets, liabilities and equity as of a date', group: 'Company financials', params: ['asof'], run: balanceSheet },
  { key: 'trial-balance', title: 'Trial Balance', desc: 'Debit and credit balance of every account', group: 'Company financials', params: ['asof'], run: trialBalance },
  { key: 'general-ledger', title: 'General Ledger', desc: 'Every posted journal line', group: 'Company financials', params: ['range', 'project'], run: generalLedger },
  { key: 'cash-flow', title: 'Cash Flow', desc: 'Money in and out of bank accounts by month', group: 'Company financials', params: ['range'], run: cashFlow },
  { key: 'performance', title: 'Monthly / Quarterly / Annual Summary', desc: 'Performance by period', group: 'Company financials', params: ['range', 'basis', 'granularity'], run: performance },
  { key: 'project-profitability', title: 'Project Profitability', desc: 'Budget, cost, revenue and profit for every project', group: 'Projects', params: ['basis'], run: profitability },
  { key: 'project-ledger', title: 'Project Expense Ledger', desc: 'Every cost on one project', group: 'Projects', params: ['projectRequired', 'range'], run: projectLedgerReport },
  { key: 'final-project', title: 'Final Project Ledger & Cost Report', desc: 'Closeout package: summary, categories, vendors, all transactions, documents', group: 'Projects', params: ['projectRequired'], run: finalProject },
  { key: 'unpaid-bills', title: 'Unpaid Bills', desc: 'What the company owes, with aging', group: 'Payables & receivables', params: ['project'], run: unpaidBills },
  { key: 'ar-aging', title: 'Outstanding Invoices', desc: 'What clients owe, with aging', group: 'Payables & receivables', params: ['project'], run: arAging },
  { key: 'vendor-payments', title: 'Vendor Payment Summary', desc: 'Total paid to each vendor (useful for 1099 prep)', group: 'Payables & receivables', params: ['range', 'project'], run: vendorPayments },
  { key: 'check-register', title: 'Check Register', desc: 'Every check with status', group: 'Payables & receivables', params: ['range', 'project'], run: checkRegister },
  { key: 'business-expenses', title: 'Business Expense Report', desc: 'Overhead not tied to a project', group: 'Overhead & mileage', params: ['range'], run: businessExpenses },
  { key: 'mileage', title: 'Mileage Deduction Report', desc: 'Monthly, quarterly, annual and by-project mileage with log', group: 'Overhead & mileage', params: ['range'], run: mileageReport },
];
export async function runReport(ctx: Ctx, key: string, f: Filters): Promise<Report> {
  const def = REPORTS.find(r => r.key === key); if (!def) throw new Error('Unknown report');
  return def.run(ctx, f);
}
