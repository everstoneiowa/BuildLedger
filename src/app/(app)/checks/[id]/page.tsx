import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { fmtMoney, fmtDate, amountInWords } from '@/lib/money';
import { CHECK_LAYOUTS } from '@/lib/pdf';
import { PageHeader, Panel, Field, Badge, NoAccess } from '@/components/ui';
import { FormModal, ActionButton } from '@/components/FormModal';
import { OpenPdf } from '@/components/PrintButton';
import { issueCheckAction, voidCheckAction, updateCheckAction } from '../../../actions';

export default async function Check({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session(); if (!can(user, 'checks.read')) return <NoAccess />;
  const c = await one<any>(ctx.db, sql`SELECT c.*, c.date::text d, c.cleared_at::text cleared, to_char(c.printed_at, 'YYYY-MM-DD HH24:MI') printed, ba.name bank, ba.last4, ba.layout, ba.stock, ba.id bank_id, p.number pnum, p.name pname FROM checks c JOIN bank_accounts ba ON ba.id = c.bank_account_id LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ${id} AND c.company_id = ${ctx.companyId}`);
  if (!c) notFound();
  const [apps, hist] = await Promise.all([rows<any>(ctx.db, sql`SELECT b.id, coalesce(b.bill_no, b.internal_no, 'Bill #' || b.id) ref, b.date::text date, coalesce(b.description, '') description, ca.amount::text amount, coalesce(p.number, 'General') project FROM check_apps ca JOIN bills b ON b.id = ca.bill_id LEFT JOIN projects p ON p.id = b.project_id WHERE ca.check_id = ${id}`),
    rows<any>(ctx.db, sql`SELECT to_char(a.at, 'YYYY-MM-DD HH24:MI') at, a.action, a.summary, coalesce(u.name, '') who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = 'check' AND a.entity_id = ${id} ORDER BY a.id`)]);
  const canPrint = can(user, 'checks.print'), canWrite = can(user, 'checks.write'); const pre = ['draft', 'printed'].includes(c.status); const steps = ['draft', 'printed', 'issued', 'cleared'];
  return (<>
    <PageHeader back={{ href: '/checks', label: 'Check register' }} title={<>Check #{c.number} <span className="align-middle"><Badge>{c.status}</Badge></span></>} subtitle={`${c.payee} · ${fmtMoney(c.amount)}`}>
      {c.status !== 'voided' && c.status !== 'cleared' && canWrite && <ActionButton label="Void check" variant="btn-danger" reason={`Why is check #${c.number} being voided? (The number will not be reused.)`} action={voidCheckAction.bind(null, id)} />}
      {c.status === 'draft' && canWrite && <FormModal title="Edit draft check" trigger="Edit" action={updateCheckAction} hidden={{ id }} fields={[{ name: 'payee', label: 'Payee', required: true, full: true }, { name: 'payeeAddress', label: 'Payee mailing address', type: 'textarea' }, { name: 'date', label: 'Check date', type: 'date', required: true }, { name: 'memo', label: 'Memo' }]} initial={{ payee: c.payee, payeeAddress: c.payee_address, date: c.d, memo: c.memo }} />}
      {canPrint && c.status !== 'voided' && <a className="btn" href={`/api/checks/${id}/pdf?preview=1`} target="_blank">Preview</a>}
      {canPrint && c.status !== 'voided' && <OpenPdf href={`/api/checks/${id}/pdf`} label={c.print_count ? `Reprint (printed ${c.print_count}×)` : 'Print check'} variant={c.status === 'draft' ? 'btn-primary' : ''} confirm={c.print_count ? `This check has already been printed ${c.print_count} time(s). Reprinting is recorded in the audit trail. Continue?` : undefined} />}
      {pre && canWrite && <ActionButton label="Record as issued" variant={c.status === 'printed' ? 'btn-primary' : ''} confirm={`Record check #${c.number} as issued? This posts the payment to the books and marks the bill(s) paid.`} action={issueCheckAction.bind(null, id)} />}
    </PageHeader>
    {c.status !== 'voided' && <ol className="no-print mb-5 flex flex-wrap gap-2 text-xs">{steps.map((s, i) => { const at = steps.indexOf(c.status); return <li key={s} className={`rounded-full border px-3 py-1 capitalize ${i <= at ? 'border-brand bg-brand-soft font-medium text-brand-dark' : 'border-line bg-white text-muted'}`}>{i + 1}. {s}</li>; })}</ol>}
    {c.status === 'voided' && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Voided: {c.void_reason}. Any payment it recorded has been reversed and the bill reopened.</p>}
    {c.status === 'printed' && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">Printed but not on the books yet. Once it is signed and handed over or mailed, choose “Record as issued”.</p>}
    {c.status === 'issued' && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">Issued and outstanding. It becomes “cleared” when you tick it off in a <Link className="link" href="/checks/reconcile">bank reconciliation</Link>.</p>}
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Check" className="lg:col-span-2"><dl className="grid grid-cols-2 gap-4 md:grid-cols-3"><Field label="Pay to the order of">{c.payee}</Field><Field label="Amount">{fmtMoney(c.amount)}</Field><Field label="Date">{fmtDate(c.d)}</Field><div className="col-span-2 md:col-span-3"><Field label="Amount in words">{amountInWords(c.amount)}</Field></div>
        <Field label="Payee mailing address">{c.payee_address}</Field><Field label="Memo">{c.memo}</Field><Field label="Bank account">{c.bank}{c.last4 ? ` ••••${c.last4}` : ''}</Field><Field label="Project">{c.project_id ? <Link className="link" href={`/projects/${c.project_id}/checks`}>{c.pnum} — {c.pname}</Link> : ''}</Field><Field label="Vendor">{c.vendor_id ? <Link className="link" href={`/vendors/${c.vendor_id}`}>Open vendor profile</Link> : ''}</Field><Field label="Cleared">{fmtDate(c.cleared)}</Field></dl>
        <table className="mt-4 w-full border-t border-line"><thead><tr><th className="th">Pays bill</th><th className="th">Date</th><th className="th">Project</th><th className="th">Description</th><th className="th text-right">Amount</th></tr></thead><tbody>{apps.map(a => <tr key={a.id} className="border-t border-line"><td className="td"><Link className="link" href={`/bills/${a.id}`}>{a.ref}</Link></td><td className="td">{fmtDate(a.date)}</td><td className="td">{a.project}</td><td className="td">{a.description}</td><td className="td text-right">{fmtMoney(a.amount)}</td></tr>)}</tbody></table></Panel>
      <Panel title="Printing"><dl className="space-y-3"><Field label="Sheet layout">{CHECK_LAYOUTS[c.layout]?.label}</Field><Field label="Check stock">{c.stock === 'blank' ? 'Blank stock — bank details printed by this software' : 'Pre-printed stock — bank details and MICR line already on the paper'}</Field></dl>
        <p className="mt-3 text-xs text-muted">Print at 100% (“Actual size”), never “Fit to page”. Run the alignment test on plain paper first and hold it against your check stock.</p>
        {canPrint && <a className="btn btn-sm mt-3" target="_blank" href={`/api/checks/test?bank=${c.bank_id}`}>Print alignment test</a>} {can(user, 'bank.admin') && <Link className="btn btn-sm mt-3" href="/settings?tab=bank">Adjust alignment</Link>}</Panel>
      <Panel title="Audit history" className="lg:col-span-3" pad={false}><table className="w-full"><tbody>{hist.map((h, i) => <tr key={i} className="border-b border-line last:border-0"><td className="td whitespace-nowrap text-muted">{h.at}</td><td className="td"><Badge tone="gray">{h.action}</Badge></td><td className="td">{h.summary}</td><td className="td text-right text-muted">{h.who}</td></tr>)}</tbody></table></Panel>
    </div>
  </>);
}
