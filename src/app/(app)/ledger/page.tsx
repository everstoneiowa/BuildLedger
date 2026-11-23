import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { resolvePeriod } from '@/lib/filters';
import { projectLedger } from '@/services/reports';
import { ledgerBalanced } from '@/services/accounting';
import { PageHeader, Panel, Tabs, NoAccess, Badge } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { ActionButton } from '@/components/FormModal';
import { JournalForm } from '@/components/MoneyForms';
import { BillForm } from '@/components/BillForm';
import { LedgerTable } from '@/components/tables';
import { reverseManualEntry } from '../../actions';

export default async function Ledger({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams; const { user, ctx } = await session(); if (!can(user, 'ledger.read')) return <NoAccess />;
  const o = await loadOptions(ctx); const range = resolvePeriod(sp.period, sp.from, sp.to); const projectId = Number(sp.project) || undefined; const view = sp.view === 'journal' ? 'journal' : 'transactions';
  const qs = new URLSearchParams({ ...(sp.project ? { project: sp.project } : {}), period: range.period, ...(range.period === 'custom' ? { from: range.from, to: range.to } : {}) }).toString();
  const accts = await rows<any>(ctx.db, sql`SELECT id, code || ' ' || name AS name FROM accounts WHERE company_id = ${ctx.companyId} AND active ORDER BY code`);
  const bal = await ledgerBalanced(ctx);
  let body: React.ReactNode;
  if (view === 'transactions') body = <LedgerTable showProject rows={await projectLedger(ctx, { projectId, from: range.from, to: range.to })} name="transactions" />;
  else {
    const js = await rows<any>(ctx.db, sql`
      SELECT jl.id, je.id entry_id, je.entry_no, je.date::text date, a.code || ' ' || a.name account, coalesce(jl.memo, je.memo, '') memo, coalesce(p.number, '') project, CASE WHEN jl.debit > 0 THEN jl.debit::text ELSE '' END debit, CASE WHEN jl.credit > 0 THEN jl.credit::text ELSE '' END credit,
        CASE WHEN je.reverses_id IS NOT NULL THEN 'reversal' ELSE je.source_type END source, (je.source_type IN ('manual','opening') AND je.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.reverses_id = je.id)) can_reverse, coalesce(u.name, '') by
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id LEFT JOIN projects p ON p.id = jl.project_id LEFT JOIN users u ON u.id = je.posted_by
      WHERE je.company_id = ${ctx.companyId} AND je.date BETWEEN ${range.from}::date AND ${range.to}::date ${projectId ? sql`AND jl.project_id = ${projectId}` : sql``} ORDER BY je.date DESC, je.entry_no DESC, jl.id`);
    const seen = new Set<number>();
    body = <DataTable exportName="general-journal" pageSize={50} empty="No journal entries in this period." columns={[{ key: 'entry_no', label: 'Entry', type: 'number' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'account', label: 'Account', filter: true }, { key: 'memo', label: 'Memo' }, { key: 'project', label: 'Project' }, { key: 'source', label: 'Source', type: 'badge', filter: true }, { key: 'by', label: 'Posted by' }, { key: 'debit', label: 'Debit', type: 'money', total: true }, { key: 'credit', label: 'Credit', type: 'money', total: true }, { key: 'actions', label: '' }]}
      rows={js.map(j => { const first = !seen.has(j.entry_id); seen.add(j.entry_id); return { ...j, actions: first && j.can_reverse && can(user, 'journal.write') ? <ActionButton variant="btn-sm" label="Reverse" reason="Why is this entry being reversed?" action={reverseManualEntry.bind(null, j.entry_id)} /> : '' }; })} />;
  }
  return (<>
    <PageHeader title="Transactions / Ledger" subtitle="Company-wide view. Every project ledger is a filtered slice of this one set of books.">
      <span className="text-xs text-muted">Books {bal.balanced ? <Badge tone="green">in balance</Badge> : <Badge tone="red">OUT OF BALANCE</Badge>}</span>
      {can(user, 'journal.write') && <JournalForm accounts={accts} projects={o.projects} />}
      {can(user, 'bills.write') && <BillForm label="Add bill or expense" variant="btn-primary" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} aiEnabled={o.aiEnabled} canPay={can(user, 'payments.write')} />}
    </PageHeader>
    <FilterBar projects={o.projects} values={{ ...range, project: projectId }} extra={<input type="hidden" name="view" value={view} />} />
    <Tabs current={view} items={[{ key: 'transactions', label: 'Income & expense transactions', href: `/ledger?${qs}` }, { key: 'journal', label: 'General journal (all debits & credits)', href: `/ledger?${qs}&view=journal` }]} />
    <Panel pad={false} action={<><Link className="btn btn-sm" href={`/reports/general-ledger?${qs}`}>General ledger report</Link><Link className="btn btn-sm" href={`/reports/trial-balance`}>Trial balance</Link></>} title={view === 'journal' ? 'Posted entries are permanent. Corrections appear as reversals.' : 'Corrections are netted out here; the journal view shows every entry.'}>{body}</Panel>
  </>);
}
