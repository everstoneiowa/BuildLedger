import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions, openBills } from '@/lib/options';
import { resolvePeriod } from '@/lib/filters';
import { projectFields, tripFields } from '@/lib/fields';
import { D, fmtMoney, fmtDate, today, m2 } from '@/lib/money';
import { projectSummaries, activityByPeriod, categoryBreakdown, plBase } from '@/services/reports';
import { PageHeader, Panel, Stat, Badge, Empty } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { FormModal } from '@/components/FormModal';
import { BillForm } from '@/components/BillForm';
import { InvoiceForm, CheckForm } from '@/components/MoneyForms';
import { SpendingChart, CategoryChart, ProfitChart } from '@/components/Charts';
import { saveProject, saveTrip } from '../actions';

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams; const { user, ctx } = await session(); const o = await loadOptions(ctx);
  const range = resolvePeriod(sp.period, sp.from, sp.to); const projectId = Number(sp.project) || undefined; const f = { ...range, projectId }; const c = ctx.companyId;
  const pf = projectId ? sql`AND x.project_id = ${projectId}` : sql``;
  const [summaries, byPeriod, byCat, tot, ar, ap, miles, recent, docs, upcoming, vehicles, bills] = await Promise.all([
    projectSummaries(ctx), activityByPeriod(ctx, { ...f, granularity: 'month' }), categoryBreakdown(ctx, f),
    one<any>(ctx.db, sql`SELECT coalesce(sum(x.amount) FILTER (WHERE x.type <> 'revenue'), 0)::text all_exp, coalesce(sum(x.amount) FILTER (WHERE x.type <> 'revenue' AND x.date >= date_trunc('year', CURRENT_DATE)), 0)::text year_exp,
      coalesce(sum(x.amount) FILTER (WHERE x.type <> 'revenue' AND x.date BETWEEN ${range.from}::date AND ${range.to}::date), 0)::text exp, coalesce(sum(x.amount) FILTER (WHERE x.type = 'revenue' AND x.date BETWEEN ${range.from}::date AND ${range.to}::date), 0)::text rev FROM (${plBase(ctx, 'accrual')}) x WHERE true ${pf}`),
    one<any>(ctx.db, sql`SELECT coalesce(sum(total - amount_paid), 0)::text amt, count(*)::int n FROM invoices WHERE company_id = ${c} AND status = 'open' AND amount_paid < total ${projectId ? sql`AND project_id = ${projectId}` : sql``}`),
    one<any>(ctx.db, sql`SELECT coalesce(sum(total - amount_paid), 0)::text amt, count(*)::int n FROM bills WHERE company_id = ${c} AND status = 'open' AND amount_paid < total ${projectId ? sql`AND project_id = ${projectId}` : sql``}`),
    one<any>(ctx.db, sql`SELECT coalesce(sum(miles), 0)::text mi FROM mileage_trips WHERE company_id = ${c} AND date BETWEEN ${range.from}::date AND ${range.to}::date ${projectId ? sql`AND project_id = ${projectId}` : sql``}`),
    rows<any>(ctx.db, sql`SELECT je.date::text date, coalesce(je.memo, '') memo, je.source_type, je.source_id, (SELECT sum(debit)::text FROM journal_lines WHERE entry_id = je.id) amount, (SELECT string_agg(DISTINCT coalesce(v.name, cl.name), ', ') FROM journal_lines jl LEFT JOIN vendors v ON v.id = jl.vendor_id LEFT JOIN clients cl ON cl.id = jl.client_id WHERE jl.entry_id = je.id) party, (SELECT string_agg(DISTINCT p.number, ', ') FROM journal_lines jl JOIN projects p ON p.id = jl.project_id WHERE jl.entry_id = je.id) project
      FROM journal_entries je WHERE je.company_id = ${c} ${projectId ? sql`AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id = je.id AND jl.project_id = ${projectId})` : sql``} ORDER BY je.id DESC LIMIT 8`),
    rows<any>(ctx.db, sql`SELECT d.id, d.name, d.folder, to_char(d.uploaded_at, 'YYYY-MM-DD') uploaded FROM documents d WHERE d.company_id = ${c} AND d.deleted_at IS NULL AND d.is_current ${projectId ? sql`AND d.id IN (SELECT document_id FROM document_links WHERE entity_type = 'project' AND entity_id = ${projectId})` : sql``} ORDER BY d.uploaded_at DESC LIMIT 6`),
    rows<any>(ctx.db, sql`SELECT b.id, coalesce(v.name, b.payee) vendor, coalesce(b.due_date, b.date)::text due, (b.total - b.amount_paid)::text balance, coalesce(p.number, 'General') project, (coalesce(b.due_date, b.date) < CURRENT_DATE) late
      FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id WHERE b.company_id = ${c} AND b.status = 'open' AND b.amount_paid < b.total ${projectId ? sql`AND b.project_id = ${projectId}` : sql``} ORDER BY coalesce(b.due_date, b.date) LIMIT 8`),
    rows<any>(ctx.db, sql`SELECT id, name FROM vehicles WHERE company_id = ${c} AND active ORDER BY id`), openBills(ctx),
  ]);
  const scope = projectId ? summaries.filter(p => p.id === projectId) : summaries;
  const active = summaries.filter(p => ['active', 'planning', 'closeout'].includes(p.status)).length, done = summaries.filter(p => ['completed', 'archived'].includes(p.status)).length;
  const estProfit = scope.filter(p => Number(p.contractPrice) > 0).reduce((a, p) => a.plus(p.estimatedProfit), D(0)); const profit = D(tot.rev).minus(tot.exp);
  const src = (r: any) => (r.source_type === 'bill' ? `/bills/${r.source_id}` : r.source_type === 'invoice' ? `/invoices/${r.source_id}` : null);
  return (<>
    <PageHeader title="Dashboard" subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}${projectId ? ' · one project' : ' · all projects'}`}>
      {can(user, 'projects.write') && <FormModal title="New project" trigger="New project" action={saveProject} go="/projects" fields={projectFields(o.clients, o.jurisdictions, false)} initial={{ status: 'active', jurisdictionId: o.jurisdictions[0]?.id }} />}
      {can(user, 'bills.write') && <BillForm label="Add expense" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} aiEnabled={o.aiEnabled} canPay={can(user, 'payments.write')} />}
      {can(user, 'documents.write') && <Link href="/documents" className="btn">Upload documents</Link>}
      {can(user, 'invoices.write') && <InvoiceForm label="Create invoice" clients={o.clients} projects={o.projects} />}
      {can(user, 'checks.write') && <CheckForm label="Write check" variant="btn-primary" banks={o.banks} bills={bills} />}
      {can(user, 'mileage.write') && <FormModal title="Log a trip" trigger="Log mileage" action={saveTrip} fields={tripFields(o.projects, vehicles)} initial={{ date: today(), vehicleId: vehicles[0]?.id }} />}
    </PageHeader>
    <FilterBar projects={o.projects} values={{ ...range, project: projectId }} />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Active projects" value={active} hint={`${done} completed`} href="/projects" />
      <Stat label="Revenue in period" value={fmtMoney(tot.rev, { cents: false })} />
      <Stat label="Expenses in period" value={fmtMoney(tot.exp, { cents: false })} hint={`${fmtMoney(tot.year_exp, { cents: false })} this year · ${fmtMoney(tot.all_exp, { cents: false })} all time`} />
      <Stat label="Profit in period (actual)" value={fmtMoney(profit, { cents: false })} tone={profit.lt(0) ? 'bad' : 'good'} hint={`${fmtMoney(estProfit, { cents: false })} estimated at completion`} />
      <Stat label="Outstanding invoices" value={fmtMoney(ar.amt, { cents: false })} hint={`${ar.n} unpaid by clients`} href="/invoices?tab=invoices" />
      <Stat label="Unpaid vendor bills" value={fmtMoney(ap.amt, { cents: false })} hint={`${ap.n} open`} tone={Number(ap.amt) > 0 ? 'warn' : undefined} href="/invoices" />
      <Stat label="Business miles logged" value={Number(miles.mi).toLocaleString()} hint="in this period" href="/mileage" />
      <Stat label="Completed projects" value={done} href="/projects" />
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Panel title="Spending over time"><SpendingChart data={byPeriod.map(r => ({ period: r.period, direct: Number(r.cogs), overhead: Number(r.overhead) }))} /></Panel>
      <Panel title="Profit by project (to date)"><ProfitChart data={scope.filter(p => Number(p.revenue) || Number(p.actualCost)).map(p => ({ project: p.number, profit: Number(p.grossProfit) }))} /></Panel>
      <Panel title="Expenses by category"><CategoryChart data={byCat.map(r => ({ category: r.category, amount: Number(r.amount) }))} /></Panel>
      <Panel title="Upcoming payments" pad={false} action={<Link href="/reports/unpaid-bills" className="link text-xs">All unpaid bills</Link>}>
        {upcoming.length ? <table className="w-full"><tbody>{upcoming.map(u => <tr key={u.id} className="border-b border-line last:border-0"><td className="td"><Link className="link font-medium" href={`/bills/${u.id}`}>{u.vendor}</Link><div className="text-xs text-muted">{u.project}</div></td><td className="td">{u.late ? <Badge tone="red">Due {fmtDate(u.due)}</Badge> : `Due ${fmtDate(u.due)}`}</td><td className="td text-right font-medium">{fmtMoney(u.balance)}</td></tr>)}</tbody></table> : <Empty>Nothing is waiting to be paid.</Empty>}
      </Panel>
      <Panel title="Recent transactions" pad={false} action={can(user, 'ledger.read') ? <Link href="/ledger" className="link text-xs">Open ledger</Link> : null}>
        {recent.length ? <table className="w-full"><tbody>{recent.map((r, i) => <tr key={i} className="border-b border-line last:border-0"><td className="td whitespace-nowrap text-muted">{fmtDate(r.date)}</td><td className="td">{src(r) ? <Link className="link" href={src(r)!}>{r.memo || r.source_type}</Link> : r.memo || r.source_type}<span className="ml-2 text-xs text-muted">{[r.party, r.project].filter(Boolean).join(' · ')}</span></td><td className="td text-right">{fmtMoney(m2(r.amount))}</td></tr>)}</tbody></table> : <Empty>No transactions yet. Start by creating a project and adding its first bill.</Empty>}
      </Panel>
      <Panel title="Recently uploaded documents" pad={false} action={<Link href="/documents" className="link text-xs">All documents</Link>}>
        {docs.length ? <table className="w-full"><tbody>{docs.map(d => <tr key={d.id} className="border-b border-line last:border-0"><td className="td"><Link className="link" href={`/documents/${d.id}`}>{d.name}</Link></td><td className="td text-muted">{d.folder}</td><td className="td whitespace-nowrap text-right text-muted">{fmtDate(d.uploaded)}</td></tr>)}</tbody></table> : <Empty>No documents uploaded yet.</Empty>}
      </Panel>
    </div>
  </>);
}
