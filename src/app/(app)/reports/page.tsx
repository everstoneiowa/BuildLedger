import Link from 'next/link';
import { session, can } from '@/lib/auth';
import { REPORTS } from '@/services/reports';
import { PageHeader, Panel, NoAccess } from '@/components/ui';
export default async function ReportCenter() {
  const { user } = await session(); if (!can(user, 'reports.read')) return <NoAccess />;
  const groups = [...new Set(REPORTS.map(r => r.group))];
  return (<><PageHeader title="Reports & Analytics" subtitle="Every report can be viewed, printed, and exported to PDF, Excel or CSV for your accountant." />
    <div className="grid gap-5 md:grid-cols-2">{groups.map(g => <Panel key={g} title={g} pad={false}><ul>{REPORTS.filter(r => r.group === g && (r.key !== 'check-register' || can(user, 'checks.read'))).map(r => <li key={r.key} className="border-b border-line px-4 py-2.5 last:border-0"><Link className="link font-medium" href={`/reports/${r.key}`}>{r.title}</Link><div className="text-xs text-muted">{r.desc}</div></li>)}</ul></Panel>)}</div>
    <p className="mt-4 max-w-3xl text-xs text-muted">Year-end: set the period to last year, then export Profit & Loss, Balance Sheet, General Ledger, Vendor Payment Summary, Unpaid Bills, Outstanding Invoices, Business Expenses and Mileage. These reports organise your records for tax preparation; they do not decide what is deductible.</p></>);
}
