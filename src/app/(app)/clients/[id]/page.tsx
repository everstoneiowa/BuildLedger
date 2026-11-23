import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { clientFields } from '@/lib/fields';
import { fmtMoney } from '@/lib/money';
import { listInvoices, listPayments, listDocuments } from '@/services/lists';
import { PageHeader, Panel, Stat, Field, Badge } from '@/components/ui';
import { FormModal } from '@/components/FormModal';
import { InvoiceForm } from '@/components/MoneyForms';
import { UploadZone } from '@/components/UploadZone';
import { InvoicesTable, PaymentsTable, DocumentsTable } from '@/components/tables';
import { saveClient } from '../../../actions';

export default async function Client({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session();
  const c = await one<any>(ctx.db, sql`SELECT * FROM clients WHERE id = ${id} AND company_id = ${ctx.companyId}`); if (!c) notFound();
  const [o, invs, pays, docs, projs] = await Promise.all([loadOptions(ctx), listInvoices(ctx, { clientId: id }), listPayments(ctx, { clientId: id }), listDocuments(ctx, { entity: { type: 'client', id } }), rows<any>(ctx.db, sql`SELECT id, number, name, status FROM projects WHERE client_id = ${id} ORDER BY number`)]);
  const live = invs.filter(i => i.status !== 'void'); const sum = (k: string) => live.reduce((a, b) => a + Number(b[k]), 0).toFixed(2);
  return (<>
    <PageHeader back={{ href: '/clients', label: 'All clients' }} title={c.name}>
      {can(user, 'invoices.write') && <InvoiceForm label="New invoice" clients={o.clients} projects={o.projects} defaults={{ clientId: id }} />}
      {can(user, 'contacts.write') && <FormModal title="Edit client" trigger="Edit" action={saveClient} hidden={{ id }} fields={clientFields} initial={c} />}
    </PageHeader>
    <div className="grid grid-cols-3 gap-3"><Stat label="Invoiced" value={fmtMoney(sum('total'))} /><Stat label="Received" value={fmtMoney(sum('paid'))} /><Stat label="Outstanding balance" value={fmtMoney(sum('balance'))} tone={Number(sum('balance')) > 0 ? 'warn' : undefined} /></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <Panel title="Contact" className="lg:col-span-2"><dl className="grid grid-cols-2 gap-4"><Field label="Contact person">{c.contact}</Field><Field label="Phone">{c.phone}</Field><Field label="Email">{c.email}</Field><Field label="Mailing address">{c.address}</Field><div className="col-span-2"><Field label="Notes">{c.notes}</Field></div></dl></Panel>
      <Panel title="Projects" pad={false}>{projs.length ? <table className="w-full"><tbody>{projs.map(p => <tr key={p.id} className="border-b border-line last:border-0"><td className="td"><Link className="link" href={`/projects/${p.id}`}>{p.number} — {p.name}</Link></td><td className="td text-right"><Badge>{p.status}</Badge></td></tr>)}</tbody></table> : <p className="p-4 text-sm text-muted">Not linked to a project yet.</p>}</Panel>
    </div>
    <div className="mt-5 space-y-5">
      <Panel pad={false} title="Invoices issued"><InvoicesTable rows={invs} /></Panel>
      <Panel pad={false} title="Payment history"><PaymentsTable rows={pays} /></Panel>
      <Panel title="Contracts and documents">{can(user, 'documents.write') && <div className="mb-3"><UploadZone compact links={[{ type: 'client', id }]} folder="Contracts" /></div>}<DocumentsTable rows={docs} canEdit={can(user, 'documents.write')} projects={o.projects} vendors={o.vendors} /></Panel>
    </div>
  </>);
}
