import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { payFields } from '@/lib/fields';
import { D, fmtMoney, fmtDate, today } from '@/lib/money';
import { INV_STATUS } from '@/services/reports';
import { PageHeader, Panel, Field, Badge, Empty } from '@/components/ui';
import { FormModal, ActionButton } from '@/components/FormModal';
import { InvoiceForm } from '@/components/MoneyForms';
import { voidInvoiceAction, receivePaymentAction, voidPaymentAction } from '../../../actions';

export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session();
  const i = await one<any>(ctx.db, sql`SELECT i.*, i.date::text d, i.due_date::text due, ${INV_STATUS} st, c.name client, p.number pnum, p.name pname FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ${id} AND i.company_id = ${ctx.companyId}`);
  if (!i) notFound();
  const [o, lines, pays] = await Promise.all([loadOptions(ctx), rows<any>(ctx.db, sql`SELECT description, quantity::text quantity, unit_price::text "unitPrice", amount::text amount, taxable FROM invoice_lines WHERE invoice_id = ${id} ORDER BY id`),
    rows<any>(ctx.db, sql`SELECT p.id, p.date::text date, p.method, p.reference, p.status, pa.amount::text amount, a.name account FROM payment_apps pa JOIN payments p ON p.id = pa.payment_id JOIN accounts a ON a.id = p.account_id WHERE pa.invoice_id = ${id} ORDER BY p.id`)]);
  const balance = D(i.total).minus(i.amount_paid); const open = i.status === 'open'; const w = can(user, 'invoices.write');
  return (<>
    <PageHeader back={{ href: '/invoices?tab=invoices', label: 'Client invoices' }} title={<>Invoice {i.number} <span className="align-middle"><Badge>{i.st}</Badge></span></>} subtitle={`${i.client} · ${fmtDate(i.d)}`}>
      <a className="btn btn-primary" href={`/api/invoices/${id}/pdf`} target="_blank">Download / print PDF</a>
      {open && w && <ActionButton label="Void" variant="btn-danger" reason="Why is this invoice being voided?" action={voidInvoiceAction.bind(null, id)} />}
      {open && w && <InvoiceForm label="Edit" clients={o.clients} projects={o.projects} initial={{ id, number: i.number, clientId: i.client_id, projectId: i.project_id, date: i.d, dueDate: i.due, taxRate: i.tax_rate, notes: i.notes, paymentInstructions: i.payment_instructions, lines }} />}
      {open && balance.gt(0) && can(user, 'payments.write') && <FormModal title="Record payment received" trigger="Record payment received" action={receivePaymentAction} hidden={{ invoiceId: id }} fields={payFields(o.accounts.filter(a => a.subtype === 'bank'), true)} initial={{ amount: balance.toFixed(2), date: today(), method: 'check' }} />}
    </PageHeader>
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title="Invoice" className="lg:col-span-2">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4"><Field label="Client"><Link className="link" href={`/clients/${i.client_id}`}>{i.client}</Link></Field><Field label="Project">{i.project_id ? <Link className="link" href={`/projects/${i.project_id}`}>{i.pnum} — {i.pname}</Link> : ''}</Field><Field label="Date">{fmtDate(i.d)}</Field><Field label="Due">{fmtDate(i.due)}</Field></dl>
        <table className="mt-4 w-full border-t border-line"><thead><tr><th className="th">Description</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Amount</th></tr></thead>
          <tbody>{lines.map((l, k) => <tr key={k} className="border-t border-line"><td className="td">{l.description}{l.taxable && <span className="ml-2 text-xs text-muted">taxable</span>}</td><td className="td text-right">{Number(l.quantity)}</td><td className="td text-right">{fmtMoney(l.unitPrice)}</td><td className="td text-right">{fmtMoney(l.amount)}</td></tr>)}</tbody>
          <tfoot className="border-t-2 border-slate-300 text-sm"><tr><td colSpan={3} className="td text-right">Subtotal</td><td className="td text-right">{fmtMoney(i.subtotal)}</td></tr>{Number(i.tax_amount) > 0 && <tr><td colSpan={3} className="td text-right">Tax ({Number(i.tax_rate)}%)</td><td className="td text-right">{fmtMoney(i.tax_amount)}</td></tr>}
            <tr className="font-semibold"><td colSpan={3} className="td text-right">Total</td><td className="td text-right">{fmtMoney(i.total)}</td></tr><tr><td colSpan={3} className="td text-right">Balance due</td><td className="td text-right">{fmtMoney(balance)}</td></tr></tfoot></table>
        <dl className="mt-4 grid grid-cols-2 gap-4"><Field label="Payment instructions">{i.payment_instructions}</Field><Field label="Notes">{i.notes}</Field></dl>
      </Panel>
      <Panel title="Payments received" pad={false}>{pays.length ? <table className="w-full"><tbody>{pays.map(p => <tr key={p.id} className="border-b border-line last:border-0"><td className="td">{fmtDate(p.date)}<div className="text-xs text-muted">{String(p.method).toUpperCase()} {p.reference} → {p.account}</div></td><td className="td text-right">{fmtMoney(p.amount)} {p.status === 'void' && <Badge>void</Badge>}</td>
        <td className="td text-right">{p.status === 'posted' && can(user, 'payments.write') && <ActionButton variant="btn-sm btn-danger" label="Void" reason="Why is this payment being voided?" action={voidPaymentAction.bind(null, p.id)} />}</td></tr>)}</tbody></table> : <Empty>No payments received yet.</Empty>}</Panel>
    </div>
  </>);
}
