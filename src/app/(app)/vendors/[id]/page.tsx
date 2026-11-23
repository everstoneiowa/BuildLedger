import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { vendorFields } from '@/lib/fields';
import { fmtMoney, fmtDate, today } from '@/lib/money';
import { listBills, listChecks, listPayments, listWaivers, listDocuments } from '@/services/lists';
import { DEFAULT_WAIVER_TYPES } from '@/services/seed';
import { PageHeader, Panel, Stat, Field, Badge } from '@/components/ui';
import { FormModal, ActionButton } from '@/components/FormModal';
import { UploadZone } from '@/components/UploadZone';
import { BillsTable, ChecksTable, PaymentsTable, WaiversTable, DocumentsTable } from '@/components/tables';
import { saveVendor, setContactActive } from '../../../actions';

export default async function Vendor({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session();
  const v = await one<any>(ctx.db, sql`SELECT *, insurance_expires::text ins FROM vendors WHERE id = ${id} AND company_id = ${ctx.companyId}`); if (!v) notFound();
  const [o, bills, checks, pays, waivers, docs, projs] = await Promise.all([loadOptions(ctx), listBills(ctx, { vendorId: id }), can(user, 'checks.read') ? listChecks(ctx, { vendorId: id }) : [], listPayments(ctx, { vendorId: id }), listWaivers(ctx, { vendorId: id }), listDocuments(ctx, { entity: { type: 'vendor', id } }),
    rows<any>(ctx.db, sql`SELECT p.id, p.number, p.name, sum(b.total)::text billed FROM bills b JOIN projects p ON p.id = b.project_id WHERE b.vendor_id = ${id} AND b.status = 'open' GROUP BY p.id ORDER BY p.number`)]);
  const live = bills.filter(b => b.status !== 'void'); const sum = (k: string) => live.reduce((a, b) => a + Number(b[k]), 0).toFixed(2);
  const expired = v.ins && v.ins < today(); const w = can(user, 'contacts.write');
  return (<>
    <PageHeader back={{ href: '/vendors', label: 'All vendors' }} title={<>{v.name} {!v.active && <Badge tone="gray">Archived</Badge>}</>} subtitle={[v.kind, v.trade].filter(Boolean).join(' · ')}>
      {w && <ActionButton label={v.active ? 'Archive' : 'Restore'} action={setContactActive.bind(null, 'vendor', id, !v.active)} confirm={v.active ? 'Archive this vendor? Their history is kept.' : undefined} />}
      {w && <FormModal title="Edit vendor" trigger="Edit" action={saveVendor} hidden={{ id }} fields={vendorFields(can(user, 'sensitive.read'))} initial={{ ...v, insuranceExpires: v.ins, is1099: v.is_1099, requiresWaiver: v.requires_waiver, taxId: '' }} />}
    </PageHeader>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Total billed" value={fmtMoney(sum('total'))} /><Stat label="Total paid" value={fmtMoney(sum('paid'))} /><Stat label="Outstanding balance" value={fmtMoney(sum('balance'))} tone={Number(sum('balance')) > 0 ? 'warn' : undefined} /><Stat label="Lien waivers missing" value={waivers.filter(x => x.status === 'requested').length} tone={waivers.some(x => x.status === 'requested') ? 'warn' : undefined} /></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <Panel title="Profile" className="lg:col-span-2"><dl className="grid grid-cols-2 gap-4 md:grid-cols-3"><Field label="Contact">{v.contact}</Field><Field label="Phone">{v.phone}</Field><Field label="Email">{v.email}</Field><Field label="Mailing address">{v.address}</Field>
        <Field label="Tax ID">{v.tax_id_last4 ? `•••••${v.tax_id_last4} (encrypted)` : ''}</Field><Field label="1099 vendor">{v.is_1099 ? 'Yes' : 'No'}</Field><Field label="Insurance expires">{v.ins ? <span className={expired ? 'font-medium text-red-700' : ''}>{fmtDate(v.ins)}{expired ? ' — expired' : ''}</span> : ''}</Field><Field label="Lien waivers">{v.requires_waiver ? 'Expected with each project payment' : 'Not tracked'}</Field><div className="col-span-2 md:col-span-3"><Field label="Notes">{v.notes}</Field></div></dl></Panel>
      <Panel title="Projects" pad={false}>{projs.length ? <table className="w-full"><tbody>{projs.map(p => <tr key={p.id} className="border-b border-line last:border-0"><td className="td"><Link className="link" href={`/projects/${p.id}`}>{p.number} — {p.name}</Link></td><td className="td text-right">{fmtMoney(p.billed)}</td></tr>)}</tbody></table> : <p className="p-4 text-sm text-muted">No project activity yet.</p>}</Panel>
    </div>
    <div className="mt-5 space-y-5">
      <Panel pad={false} title="Invoices and bills"><BillsTable rows={bills} name={`bills-${v.name}`} /></Panel>
      <Panel pad={false} title="Payment history"><PaymentsTable rows={pays} /></Panel>
      {can(user, 'checks.read') && <Panel pad={false} title="Checks issued"><ChecksTable rows={checks} /></Panel>}
      <Panel pad={false} title="Lien waivers"><WaiversTable rows={waivers} canEdit={can(user, 'bills.write')} projects={o.projects} vendors={o.vendors} types={DEFAULT_WAIVER_TYPES} docs={docs.map(d => ({ id: d.id, name: d.name }))} /></Panel>
      <Panel title="Documents — W-9, insurance certificates, contracts">{can(user, 'documents.write') && <div className="mb-3"><UploadZone compact links={[{ type: 'vendor', id }]} folder="Vendor Documents" label="Drop the W-9, insurance certificate or other vendor files here, or" /></div>}<DocumentsTable rows={docs} canEdit={can(user, 'documents.write')} projects={o.projects} vendors={o.vendors} /></Panel>
    </div>
  </>);
}
