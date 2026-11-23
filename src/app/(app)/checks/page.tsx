import Link from 'next/link';
import { session, can } from '@/lib/auth';
import { loadOptions, openBills } from '@/lib/options';
import { fmtMoney } from '@/lib/money';
import { listChecks } from '@/services/lists';
import { PageHeader, Panel, Stat, NoAccess } from '@/components/ui';
import { CheckForm } from '@/components/MoneyForms';
import { ChecksTable } from '@/components/tables';

export default async function Checks() {
  const { user, ctx } = await session(); if (!can(user, 'checks.read')) return <NoAccess />;
  const [o, checks, bills] = await Promise.all([loadOptions(ctx), listChecks(ctx), openBills(ctx)]);
  const sum = (st: string[]) => checks.filter(c => st.includes(c.status)).reduce((a, c) => a + Number(c.amount), 0).toFixed(2); const n = (st: string[]) => checks.filter(c => st.includes(c.status)).length;
  return (<>
    <PageHeader title="Checks" subtitle="Company-wide check register. Printing a check never marks it issued, and issuing never marks it cleared.">
      {can(user, 'payments.write') && <Link className="btn" href="/checks/reconcile">Bank reconciliation</Link>}
      <Link className="btn" href="/reports/check-register?period=all">Register report</Link>
      {can(user, 'checks.write') && <CheckForm label="Write check" variant="btn-primary" banks={o.banks} bills={bills} />}
    </PageHeader>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Drafts and printed, not yet issued" value={n(['draft', 'printed'])} hint={fmtMoney(sum(['draft', 'printed']))} tone={n(['draft', 'printed']) ? 'warn' : undefined} />
      <Stat label="Issued, not yet cleared" value={n(['issued'])} hint={`${fmtMoney(sum(['issued']))} outstanding at the bank`} /><Stat label="Cleared" value={n(['cleared'])} hint={fmtMoney(sum(['cleared']))} /><Stat label="Bills ready to pay" value={bills.length} hint={fmtMoney(bills.reduce((a, b) => a + Number(b.open), 0).toFixed(2))} />
    </div>
    <Panel pad={false}><ChecksTable rows={checks} /></Panel>
  </>);
}
