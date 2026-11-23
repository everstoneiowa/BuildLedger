import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { resolvePeriod } from '@/lib/filters';
import { fmtMoney } from '@/lib/money';
import { categoryBreakdown } from '@/services/reports';
import { listBills } from '@/services/lists';
import { PageHeader, Panel } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { BillForm } from '@/components/BillForm';
import { CategoryChart } from '@/components/Charts';
import { BillsTable } from '@/components/tables';

export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams; const { user, ctx } = await session(); const o = await loadOptions(ctx); const range = resolvePeriod(sp.period, sp.from, sp.to);
  const [bills, cats] = await Promise.all([listBills(ctx, { businessOnly: true }), categoryBreakdown(ctx, { ...range, kind: 'overhead' })]);
  const inRange = bills.filter(b => b.date >= range.from && b.date <= range.to); const total = cats.reduce((a, c) => a + Number(c.amount), 0);
  return (<>
    <PageHeader title="Business Expenses" subtitle="Company overhead that does not belong to a single house. Kept out of project costs, included in company reports.">
      <a className="btn" href={`/reports/business-expenses?period=${range.period}&from=${range.from}&to=${range.to}`}>Expense report</a>
      {can(user, 'bills.write') && <BillForm label="Add business expense" variant="btn-primary" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} businessOnly aiEnabled={o.aiEnabled} canPay={can(user, 'payments.write')} />}
    </PageHeader>
    <FilterBar values={range} show={['period']} />
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title={`Overhead by category — ${fmtMoney(total.toFixed(2))}`}><CategoryChart data={cats.map(c => ({ category: c.category, amount: Number(c.amount) }))} /></Panel>
      <Panel pad={false} className="lg:col-span-2" title="Expenses in this period"><BillsTable rows={inRange} hideProject name="business-expenses" /></Panel>
    </div>
    <p className="mt-2 text-xs text-muted">Open an expense to allocate it across projects. Allocation affects project profitability reports only, and records the method used.</p>
  </>);
}
