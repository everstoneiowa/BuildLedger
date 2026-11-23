import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions, openBills } from '@/lib/options';
import { payFields } from '@/lib/fields';
import { D, fmtMoney, fmtDate, today } from '@/lib/money';
import { BILL_STATUS } from '@/services/reports';
import { listDocuments } from '@/services/lists';
import { PageHeader, Panel, Field, Badge, Empty } from '@/components/ui';
import { FormModal, ActionButton } from '@/components/FormModal';
import { BillForm } from '@/components/BillForm';
import { CheckForm } from '@/components/MoneyForms';
import { UploadZone } from '@/components/UploadZone';
import { voidBillAction, payBillAction, voidPaymentAction, allocateAction } from '../../../actions';

export default async function Bill({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session();
  const b = await one<any>(ctx.db, sql`SELECT b.*, b.date::text d, b.due_date::text due, ${BILL_STATUS} st, coalesce(v.name, b.payee) vendor, p.number pnum, p.name pname, u.name creator FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ${id} AND b.company_id = ${ctx.companyId}`);
  if (!b) notFound();
  const [o, lines, pays, pend, docs, allocs, hist] = await Promise.all([loadOptions(ctx),
    rows<any>(ctx.db, sql`SELECT bl.category_id, c.name category, coalesce(bl.description, '') description, bl.amount::text amount FROM bill_lines bl JOIN categories c ON c.id = bl.category_id WHERE bl.bill_id = ${id} ORDER BY bl.id`),
    rows<any>(ctx.db, sql`SELECT p.id, p.date::text date, p.method, p.reference, p.status, pa.amount::text amount, a.name account, (SELECT id FROM checks WHERE payment_id = p.id LIMIT 1) check_id FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id JOIN accounts a ON a.id = p.account_id WHERE pa.bill_id = ${id} ORDER BY p.id`),
    rows<any>(ctx.db, sql`SELECT c.id, c.number, c.status, ca.amount::text amount FROM check_apps ca JOIN checks c ON c.id = ca.check_id WHERE ca.bill_id = ${id} AND c.status IN ('draft','printed')`),
    listDocuments(ctx, { entity: { type: 'bill', id } }),
    rows<any>(ctx.db, sql`SELECT p.number, p.name, oa.amount::text amount, oa.method, oa.basis FROM overhead_allocations oa JOIN projects p ON p.id = oa.project_id WHERE oa.bill_id = ${id} ORDER BY p.number`),
    rows<any>(ctx.db, sql`SELECT to_char(a.at, 'YYYY-MM-DD HH24:MI') at, a.summary, coalesce(u.name, '') who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = 'bill' AND a.entity_id = ${id} ORDER BY a.id`)]);
  const balance = D(b.total).minus(b.amount_paid); const pending = pend.reduce((a, c) => a.plus(c.amount), D(0)); const payable = balance.minus(pending); const open = b.status === 'open';
  const canBill = can(user, 'bills.write'), canPay = can(user, 'payments.write'); const title = b.kind === 'internal' ? `Payment request ${b.internal_no}` : `Bill ${b.bill_no ?? '#' + b.id}`;
  return (<>
    <PageHeader back={b.project_id ? { href: `/projects/${b.project_id}/bills`, label: `${b.pnum} invoices & receipts` } : { href: '/expenses', label: 'Business expenses' }} title={<>{title} <span className="align-middle"><Badge>{b.st}</Badge></span></>} subtitle={`${b.vendor} · ${fmtDate(b.d)}`}>
      {b.kind === 'internal' && <a className="btn" href={`/api/bills/${id}/pdf`} target="_blank">Payment request PDF</a>}
      {open && canBill && <ActionButton label="Void" variant="btn-danger" reason="Why is this bill being voided?" action={voidBillAction.bind(null, id)} />}
      {open && canBill && <BillForm label="Edit" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} businessOnly={false} initial={{ id, kind: b.kind, vendorId: b.vendor_id, payee: b.payee, projectId: b.project_id, billNo: b.bill_no, date: b.d, dueDate: b.due, taxAmount: b.tax_amount, description: b.description, notes: b.notes, lines: lines.map(l => ({ categoryId: l.category_id, description: l.description, amount: l.amount })) }} />}
      {open && payable.gt(0) && canPay && <FormModal title="Record a payment (not by check)" trigger="Record payment" action={payBillAction} hidden={{ billId: id }} fields={payFields(o.accounts)} initial={{ amount: payable.toFixed(2), date: today(), method: 'ach' }} note="For card, ACH, cash or wire. To pay by printed check, use Write check instead." />}
      {open && payable.gt(0) && b.vendor_id && can(user, 'checks.write') && <CheckForm label="Write check" variant="btn-primary" banks={o.banks} bills={await openBills(ctx)} presetBillId={id} />}
    </PageHeader>
    {b.kind === 'internal' && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">Internally prepared by {b.creator ?? 'staff'} on behalf of {b.vendor}. This is the company’s own record, not a document issued by the vendor.</p>}
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Details" className="lg:col-span-2">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4"><Field label="Vendor / payee">{b.vendor_id ? <Link className="link" href={`/vendors/${b.vendor_id}`}>{b.vendor}</Link> : b.vendor}</Field><Field label="Project">{b.project_id ? <Link className="link" href={`/projects/${b.project_id}`}>{b.pnum} — {b.pname}</Link> : 'General business expense'}</Field><Field label="Date">{fmtDate(b.d)}</Field><Field label="Due">{fmtDate(b.due)}</Field>
          <Field label="Total">{fmtMoney(b.total)}</Field><Field label="Sales tax included">{Number(b.tax_amount) ? fmtMoney(b.tax_amount) : ''}</Field><Field label="Paid">{fmtMoney(b.amount_paid)}</Field><Field label="Balance">{fmtMoney(balance)}</Field>
          <div className="col-span-2 md:col-span-4"><Field label="Description">{b.description}</Field></div><div className="col-span-2 md:col-span-4"><Field label="Notes">{b.notes}</Field></div></dl>
        <table className="mt-4 w-full border-t border-line"><thead><tr><th className="th">Category</th><th className="th">Line note</th><th className="th text-right">Amount</th></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t border-line"><td className="td">{l.category}</td><td className="td">{l.description}</td><td className="td text-right">{fmtMoney(l.amount)}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title="Receipt or invoice on file">
        {docs.map(d => <div key={d.id} className="mb-2 text-sm"><Link className="link" href={`/documents/${d.id}`}>{d.name}</Link> <span className="text-xs text-muted">{fmtDate(d.uploaded)}</span></div>)}
        {!docs.length && <p className="mb-2 text-sm text-muted">No supporting document attached yet.</p>}
        {can(user, 'documents.write') && <UploadZone compact links={[{ type: 'bill', id }, ...(b.vendor_id ? [{ type: 'vendor', id: b.vendor_id }] : []), ...(b.project_id ? [{ type: 'project', id: b.project_id }] : [])]} folder="Financial Documents" />}
      </Panel>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Panel title="Payments" pad={false}>
        {pend.map(c => <p key={c.id} className="border-b border-line bg-amber-50 px-4 py-2 text-sm">Check <Link className="link" href={`/checks/${c.id}`}>#{c.number}</Link> for {fmtMoney(c.amount)} is {c.status} but not yet recorded as issued.</p>)}
        {pays.length ? <table className="w-full"><tbody>{pays.map(p => <tr key={p.id} className="border-b border-line last:border-0"><td className="td">{fmtDate(p.date)}</td><td className="td">{p.check_id ? <Link className="link" href={`/checks/${p.check_id}`}>Check #{p.reference}</Link> : `${String(p.method).toUpperCase()} ${p.reference ?? ''}`}<div className="text-xs text-muted">{p.account}</div></td><td className="td">{p.status === 'void' && <Badge>void</Badge>}</td><td className="td text-right">{fmtMoney(p.amount)}</td>
          <td className="td text-right">{p.status === 'posted' && !p.check_id && canPay && <ActionButton variant="btn-sm btn-danger" label="Void" reason="Why is this payment being voided?" action={voidPaymentAction.bind(null, p.id)} />}</td></tr>)}</tbody></table> : !pend.length && <Empty>No payments yet.</Empty>}
      </Panel>
      {!b.project_id ? <Panel title="Allocation to projects (for profitability only)" action={open && canBill && <FormModal title="Allocate this overhead across projects" trigger="Allocate" variant="btn-sm" action={allocateAction} hidden={{ billId: id }} fields={[{ name: 'method', label: 'Method', type: 'select', required: true, options: [{ value: 'equal', label: 'Equal split' }, { value: 'cost', label: 'In proportion to each project’s direct cost to date' }] }]} initial={{ method: 'equal' }} note={<><span className="mb-2 block">Choose the projects that share this expense. The general ledger is not changed — the expense stays in overhead — but each project’s “allocated overhead” and estimated net profit will reflect its share.</span>{o.projects.map(p => <label key={p.id} className="mr-3 inline-flex items-center gap-1 text-ink"><input type="checkbox" name="projectIds" value={p.id} />{p.name}</label>)}</>} />}>
        {allocs.length ? <table className="w-full text-sm"><tbody>{allocs.map((a, i) => <tr key={i} className="border-b border-line last:border-0"><td className="py-1.5">{a.number} — {a.name}<div className="text-xs text-muted">{a.basis}</div></td><td className="py-1.5 text-right">{fmtMoney(a.amount)}</td></tr>)}</tbody></table> : <p className="text-sm text-muted">Not allocated. This expense counts toward company overhead only.</p>}
      </Panel> : <div />}
      <Panel title="History" className="lg:col-span-2" pad={false}><table className="w-full"><tbody>{hist.map((h, i) => <tr key={i} className="border-b border-line last:border-0"><td className="td whitespace-nowrap text-muted">{h.at}</td><td className="td">{h.summary}</td><td className="td text-right text-muted">{h.who}</td></tr>)}</tbody></table></Panel>
    </div>
  </>);
}
