import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { rows } from '@/db';
import { session, can } from '@/lib/auth';
import { fmtMoney, fmtDate, today } from '@/lib/money';
import { PageHeader, Panel, Badge, NoAccess, Empty } from '@/components/ui';
import { FormModal } from '@/components/FormModal';
import { startReconAction } from '../../../actions';

export default async function Reconcile() {
  const { user, ctx } = await session(); if (!can(user, 'checks.read')) return <NoAccess />;
  const banks = await rows<any>(ctx.db, sql`SELECT b.id, b.name, coalesce((SELECT sum(jl.debit - jl.credit) FROM journal_lines jl WHERE jl.account_id = b.account_id), 0)::text book FROM bank_accounts b WHERE b.company_id = ${ctx.companyId} AND b.active ORDER BY b.id`);
  const recs = await rows<any>(ctx.db, sql`SELECT r.id, r.statement_date::text sd, r.beginning_balance::text bb, r.ending_balance::text eb, r.status, b.name bank FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id WHERE r.company_id = ${ctx.companyId} ORDER BY r.id DESC`);
  return (<>
    <PageHeader back={{ href: '/checks', label: 'Checks' }} title="Bank reconciliation" subtitle="Match the books to each bank statement. This is the only place a check becomes “cleared”.">
      {can(user, 'payments.write') && <FormModal title="Start a reconciliation" trigger="Reconcile a statement" variant="btn-primary" action={startReconAction} go="/checks/reconcile" fields={[{ name: 'bankAccountId', label: 'Bank account', type: 'select', required: true, options: banks.map(b => ({ value: b.id, label: b.name })) }, { name: 'statementDate', label: 'Statement ending date', type: 'date', required: true }, { name: 'endingBalance', label: 'Statement ending balance', type: 'money', required: true }]} initial={{ bankAccountId: banks[0]?.id, statementDate: today() }} />}
    </PageHeader>
    <div className="mb-5 grid gap-3 md:grid-cols-3">{banks.map(b => <div key={b.id} className="panel px-4 py-3"><div className="text-xs text-muted">{b.name} — balance per books</div><div className="mt-1 text-xl font-semibold">{fmtMoney(b.book)}</div></div>)}</div>
    <Panel pad={false} title="Reconciliations">{recs.length ? <table className="w-full"><thead><tr className="border-b border-line bg-slate-50"><th className="th">Statement date</th><th className="th">Account</th><th className="th text-right">Beginning</th><th className="th text-right">Ending</th><th className="th">Status</th></tr></thead>
      <tbody>{recs.map(r => <tr key={r.id} className="border-b border-line last:border-0"><td className="td"><Link className="link font-medium" href={`/checks/reconcile/${r.id}`}>{fmtDate(r.sd)}</Link></td><td className="td">{r.bank}</td><td className="td text-right">{fmtMoney(r.bb)}</td><td className="td text-right">{fmtMoney(r.eb)}</td><td className="td"><Badge>{r.status}</Badge></td></tr>)}</tbody></table> : <Empty>No reconciliations yet. Enter the bank account’s opening balance in Settings, then reconcile your first statement.</Empty>}</Panel>
  </>);
}
