import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions, openBills } from '@/lib/options';
import { projectFields, waiverFields, clientFields } from '@/lib/fields';
import { D, fmtMoney, fmtDate, today } from '@/lib/money';
import { projectSummaries, projectLedger, categoryBreakdown } from '@/services/reports';
import { listBills, listInvoices, listChecks, listPayments, listWaivers, listDocuments, listVendors } from '@/services/lists';
import { FOLDERS, DEFAULT_WAIVER_TYPES } from '@/services/seed';
import { PageHeader, Panel, Stat, Badge, Tabs, Field, Empty } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { FormModal, ActionButton } from '@/components/FormModal';
import { BillForm } from '@/components/BillForm';
import { InvoiceForm, CheckForm } from '@/components/MoneyForms';
import { UploadZone } from '@/components/UploadZone';
import { CategoryChart } from '@/components/Charts';
import { BillsTable, InvoicesTable, ChecksTable, PaymentsTable, WaiversTable, DocumentsTable, LedgerTable } from '@/components/tables';
import { saveProject, setProjectStatus, saveBudgetLine, saveChangeOrder, saveWaiver, saveClient } from '../../../../actions';

const TABS = [['overview', 'Overview'], ['ledger', 'Expense ledger'], ['bills', 'Invoices & receipts'], ['vendors', 'Vendors'], ['client', 'Client'], ['payments', 'Payments'], ['checks', 'Checks'], ['waivers', 'Lien waivers'], ['documents', 'Documents'], ['budget', 'Budget'], ['reports', 'Reports'], ['closeout', 'Closeout']] as const;

export default async function Project({ params }: { params: Promise<{ id: string; tab?: string[] }> }) {
  const { id: rawId, tab: t } = await params; const id = Number(rawId); const tab = t?.[0] ?? 'overview';
  const { user, ctx } = await session(); const [s] = await projectSummaries(ctx, { projectId: id }); if (!s) notFound();
  const p = (await one<any>(ctx.db, sql`SELECT p.*, p.start_date::text sd, p.est_completion::text ec, p.actual_completion::text ac, j.name jurisdiction, j.waiver_types FROM projects p LEFT JOIN jurisdictions j ON j.id = p.jurisdiction_id WHERE p.id = ${id}`))!;
  const o = await loadOptions(ctx); const base = `/projects/${id}`; const canBill = can(user, 'bills.write'), canPay = can(user, 'payments.write'), canCheck = can(user, 'checks.write'), canEdit = can(user, 'projects.write');
  const types: string[] = p.waiver_types ?? DEFAULT_WAIVER_TYPES; const exp = (k: string, extra = '') => `/api/reports/${k}?project=${id}${extra}`;
  const addBill = canBill && <BillForm label="Add bill or expense" variant="btn-primary" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} fixedProjectId={id} aiEnabled={o.aiEnabled} canPay={canPay} />;
  const writeCheck = canCheck && <CheckForm label="Write check" banks={o.banks} bills={await openBills(ctx)} projectId={id} />;
  let body: React.ReactNode = null;

  if (tab === 'overview') {
    const cats = await categoryBreakdown(ctx, { projectId: id, from: '2000-01-01', to: '2100-01-01' });
    body = (<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Original budget" value={fmtMoney(s.originalBudget, { cents: false })} /><Stat label="Revised budget" value={fmtMoney(s.revisedBudget, { cents: false })} hint="with approved change orders" />
        <Stat label="Actual cost to date" value={fmtMoney(s.actualCost, { cents: false })} hint={`${fmtMoney(s.paid, { cents: false })} paid`} /><Stat label="Committed but unpaid" value={fmtMoney(s.unpaid, { cents: false })} tone={Number(s.unpaid) > 0 ? 'warn' : undefined} />
        <Stat label="Remaining budget" value={fmtMoney(s.remainingBudget, { cents: false })} tone={Number(s.remainingBudget) < 0 ? 'bad' : 'good'} hint={Number(s.remainingBudget) < 0 ? 'over budget' : 'under budget'} />
        <Stat label="Revenue to date" value={fmtMoney(s.revenue, { cents: false })} hint={`${fmtMoney(s.contractPrice, { cents: false })} contract / sale price`} />
        <Stat label="Gross profit" value={fmtMoney(s.grossProfit, { cents: false })} tone={Number(s.grossProfit) < 0 ? 'bad' : 'good'} hint={s.margin ? `${s.margin}% margin` : 'no revenue recorded yet'} />
        <Stat label="Estimated net profit" value={fmtMoney(s.netProfit, { cents: false })} hint={`after ${fmtMoney(s.overhead, { cents: false })} allocated overhead`} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Spending by category"><CategoryChart data={cats.map(c => ({ category: c.category, amount: Number(c.amount) }))} /></Panel>
        <Panel title="Project information" action={canEdit && <FormModal title="Edit project" trigger="Edit" variant="btn-sm" action={saveProject} hidden={{ id }} fields={projectFields(o.clients, o.jurisdictions, true)} initial={{ ...p, clientId: p.client_id, jurisdictionId: p.jurisdiction_id, startDate: p.sd, estCompletion: p.ec, actualCompletion: p.ac, contractPrice: p.contract_price }} />}>
          <dl className="grid grid-cols-2 gap-4"><Field label="Property address">{p.address}</Field><Field label="Client / owner">{s.client}</Field><Field label="Start date">{fmtDate(p.sd)}</Field><Field label="Estimated completion">{fmtDate(p.ec)}</Field><Field label="Actual completion">{fmtDate(p.ac)}</Field><Field label="Lien-waiver jurisdiction">{p.jurisdiction}</Field>
            <div className="col-span-2"><Field label="Description">{p.description}</Field></div><div className="col-span-2"><Field label="Notes">{p.notes}</Field></div></dl>
        </Panel>
      </div></>);
  } else if (tab === 'ledger') {
    body = <Panel pad={false} title="Every cost and revenue item on this project, straight from the general ledger" action={<><a className="btn btn-sm" href={exp('project-ledger', '&format=pdf')} target="_blank">PDF</a><a className="btn btn-sm" href={exp('project-ledger', '&format=xlsx')}>Excel</a><a className="btn btn-sm" href={exp('project-ledger', '&format=csv')}>CSV</a></>}><LedgerTable rows={await projectLedger(ctx, { projectId: id })} name={`ledger-${s.number}`} /></Panel>;
  } else if (tab === 'bills') {
    const [bills, invs] = await Promise.all([listBills(ctx, { projectId: id }), listInvoices(ctx, { projectId: id })]);
    body = (<div className="space-y-5"><Panel pad={false} title="Vendor bills, receipts and payment requests (money out)"><BillsTable rows={bills} hideProject name={`bills-${s.number}`} /></Panel>
      <Panel pad={false} title="Invoices to the client (money in)" action={can(user, 'invoices.write') && <InvoiceForm label="New invoice" variant="btn-sm" clients={o.clients} projects={o.projects} defaults={{ projectId: id, clientId: p.client_id }} />}><InvoicesTable rows={invs} /></Panel></div>);
  } else if (tab === 'vendors') {
    const vs = await listVendors(ctx, { projectId: id });
    body = <Panel pad={false} title="Vendors and subcontractors who have billed this project"><DataTable exportName={`vendors-${s.number}`} empty="No vendor has billed this project yet." columns={[{ key: 'name', label: 'Vendor', link: 'href' }, { key: 'trade', label: 'Trade' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'billed', label: 'Billed on this project', type: 'money', total: true }, { key: 'paid', label: 'Paid', type: 'money', total: true }, { key: 'owed', label: 'Still owed', type: 'money', total: true }]} rows={vs.map(v => ({ ...v, href: `/vendors/${v.id}` }))} /></Panel>;
  } else if (tab === 'client') {
    const cl = p.client_id ? await one<any>(ctx.db, sql`SELECT * FROM clients WHERE id = ${p.client_id}`) : null; const invs = await listInvoices(ctx, { projectId: id });
    body = cl ? (<div className="space-y-5"><Panel title={<Link className="link" href={`/clients/${cl.id}`}>{cl.name}</Link>} action={can(user, 'contacts.write') && <FormModal title="Edit client" trigger="Edit" variant="btn-sm" action={saveClient} hidden={{ id: cl.id }} fields={clientFields} initial={cl} />}>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4"><Field label="Contact">{cl.contact}</Field><Field label="Phone">{cl.phone}</Field><Field label="Email">{cl.email}</Field><Field label="Mailing address">{cl.address}</Field><div className="col-span-2 md:col-span-4"><Field label="Notes">{cl.notes}</Field></div></dl></Panel>
      <Panel pad={false} title="Invoices on this project"><InvoicesTable rows={invs} /></Panel></div>) : <Panel><Empty>No client is assigned. Use Overview → Edit to choose the client or property owner.</Empty></Panel>;
  } else if (tab === 'payments') {
    body = <Panel pad={false} title="Money paid out and received for this project"><PaymentsTable rows={await listPayments(ctx, { projectId: id })} scoped /></Panel>;
  } else if (tab === 'checks') {
    body = can(user, 'checks.read') ? <Panel pad={false} title="Check register for this project"><ChecksTable rows={await listChecks(ctx, { projectId: id })} /></Panel> : <Panel><Empty>Your role does not include check records.</Empty></Panel>;
  } else if (tab === 'waivers') {
    const [ws, docs] = await Promise.all([listWaivers(ctx, { projectId: id }), listDocuments(ctx, { entity: { type: 'project', id } })]); const dopts = docs.map(d => ({ id: d.id, name: d.name })); const missing = ws.filter(w => w.status === 'requested').length;
    body = (<>{missing > 0 && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{missing} lien waiver{missing > 1 ? 's are' : ' is'} still missing for payments already made.</p>}
      <Panel pad={false} title={`Lien waivers — ${p.jurisdiction ?? 'Default'} rules`} action={canBill && <FormModal title="Track a lien waiver" trigger="Add waiver" variant="btn-sm" action={saveWaiver} fields={waiverFields(o.projects, o.vendors, types, dopts)} initial={{ projectId: id, status: 'requested' }} />}>
        <WaiversTable rows={ws} canEdit={!!canBill} projects={o.projects} vendors={o.vendors} types={types} docs={dopts} /></Panel>
      <p className="mt-2 text-xs text-muted">Waiver types come from this project’s jurisdiction (Settings → Lien waivers). Requirements differ by state; confirm forms and deadlines with your attorney.</p></>);
  } else if (tab === 'documents') {
    const docs = await listDocuments(ctx, { entity: { type: 'project', id } }); const counts = new Map<string, number>(); docs.forEach(d => counts.set(d.folder, (counts.get(d.folder) ?? 0) + 1));
    body = (<div className="space-y-4">{can(user, 'documents.write') && <UploadZone links={[{ type: 'project', id }]} label="Drop blueprints, permits, contracts, photos or any project file here, or" />}
      <div className="flex flex-wrap gap-2">{FOLDERS.map(f => <span key={f} className="rounded-md border border-line bg-white px-2.5 py-1 text-xs">{f} <span className="text-muted">{counts.get(f) ?? 0}</span></span>)}</div>
      <Panel pad={false}><DocumentsTable rows={docs} canEdit={can(user, 'documents.write')} projects={o.projects} vendors={o.vendors} /></Panel></div>);
  } else if (tab === 'budget') {
    const [lines, cos] = await Promise.all([rows<any>(ctx.db, sql`
      SELECT c.id, c.name, coalesce(pb.amount, 0)::text budget, coalesce((SELECT sum(jl.debit - jl.credit) FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.project_id = ${id} AND jl.category_id = c.id AND a.type IN ('cogs','expense')), 0)::text actual
      FROM categories c LEFT JOIN project_budgets pb ON pb.category_id = c.id AND pb.project_id = ${id} WHERE c.company_id = ${ctx.companyId} AND c.kind = 'project' AND c.active ORDER BY c.sort, c.name`),
      rows<any>(ctx.db, sql`SELECT id, number, date::text date, description, budget_change::text bc, price_change::text pc, status FROM change_orders WHERE project_id = ${id} ORDER BY id`)]);
    const used = lines.filter(l => Number(l.budget) || Number(l.actual));
    body = (<div className="space-y-5">
      <Panel pad={false} title="Budget versus actual by category" action={canEdit && <FormModal title="Set a category budget" trigger="Set budget line" variant="btn-sm" action={saveBudgetLine} hidden={{ projectId: id }} fields={[{ name: 'categoryId', label: 'Category', type: 'select', required: true, options: lines.map(l => ({ value: l.id, label: l.name })) }, { name: 'amount', label: 'Budget amount', type: 'money', required: true }]} note="When category budgets are set, their total replaces the single estimated budget as the original budget." />}>
        <DataTable search={false} exportName={`budget-${s.number}`} empty="No category budgets or costs yet." columns={[{ key: 'name', label: 'Category' }, { key: 'budget', label: 'Budget', type: 'money', total: true }, { key: 'actual', label: 'Actual', type: 'money', total: true }, { key: 'variance', label: 'Remaining', type: 'money', total: true }, { key: 'pct', label: 'Used' }]}
          rows={used.map(l => ({ ...l, variance: D(l.budget).minus(l.actual).toFixed(2), pct: Number(l.budget) ? <Badge tone={Number(l.actual) > Number(l.budget) ? 'red' : 'gray'}>{`${D(l.actual).div(l.budget).times(100).toFixed(0)}%`}</Badge> : '', pct_sort: Number(l.budget) ? Number(l.actual) / Number(l.budget) : 0 }))} /></Panel>
      <Panel pad={false} title="Change orders" action={canEdit && <FormModal title="New change order" trigger="Add change order" variant="btn-sm" action={saveChangeOrder} hidden={{ projectId: id }} initial={{ date: today(), status: 'pending' }} fields={coFields} />}>
        <DataTable search={false} empty="No change orders." columns={[{ key: 'number', label: 'No.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'description', label: 'Description' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'bc', label: 'Budget change', type: 'money' }, { key: 'pc', label: 'Price change', type: 'money' }, { key: 'actions', label: '' }]}
          rows={cos.map(c => ({ ...c, actions: canEdit ? <FormModal title={`Change order ${c.number}`} trigger="Edit" variant="btn-sm" action={saveChangeOrder} hidden={{ projectId: id, id: c.id, number: c.number }} fields={coFields} initial={{ date: c.date, description: c.description, budgetChange: c.bc, priceChange: c.pc, status: c.status }} /> : '' }))} />
        <p className="border-t border-line px-4 py-2 text-xs text-muted">Only approved change orders adjust the revised budget and contract price.</p></Panel></div>);
  } else if (tab === 'reports') {
    const R = [['final-project', 'Final project ledger & cost report', 'Closeout package for your accountant and permanent records'], ['project-ledger', 'Project expense ledger', 'Every cost with vendor, category, invoice number and payment'], ['profit-loss', 'Project profit & loss', 'Revenue and costs for this project only'], ['unpaid-bills', 'Unpaid bills on this project', 'What is still owed to vendors'], ['vendor-payments', 'Vendor payments on this project', 'Totals paid per vendor']];
    body = <Panel pad={false} title="Reports for this project"><table className="w-full"><tbody>{R.map(([k, t2, d]) => <tr key={k} className="border-b border-line last:border-0"><td className="td"><Link className="link font-medium" href={`/reports/${k}?project=${id}&period=all`}>{t2}</Link><div className="text-xs text-muted">{d}</div></td>
      <td className="td whitespace-nowrap text-right"><a className="btn btn-sm" target="_blank" href={exp(k, '&from=2000-01-01&to=2100-01-01&format=pdf')}>PDF</a> <a className="btn btn-sm" href={exp(k, '&from=2000-01-01&to=2100-01-01&format=xlsx')}>Excel</a> <a className="btn btn-sm" href={exp(k, '&from=2000-01-01&to=2100-01-01&format=csv')}>CSV</a></td></tr>)}</tbody></table></Panel>;
  } else if (tab === 'closeout') {
    const c = (await one<any>(ctx.db, sql`SELECT
      (SELECT count(*)::int FROM bills WHERE project_id = ${id} AND status = 'open' AND amount_paid < total) unpaid_bills,
      (SELECT count(*)::int FROM lien_waivers WHERE project_id = ${id} AND status = 'requested') missing_waivers,
      (SELECT count(*)::int FROM checks WHERE project_id = ${id} AND status IN ('draft','printed')) pending_checks,
      (SELECT count(*)::int FROM checks WHERE project_id = ${id} AND status = 'issued') uncleared_checks,
      (SELECT count(*)::int FROM invoices WHERE project_id = ${id} AND status = 'open' AND amount_paid < total) open_invoices,
      (SELECT count(*)::int FROM bills b WHERE b.project_id = ${id} AND b.status = 'open' AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type = 'bill' AND dl.entity_id = b.id)) undocumented`))!;
    const items: [string, number, string, string][] = [['Vendor bills still unpaid', c.unpaid_bills, 'bills', 'Pay or void them'], ['Lien waivers still missing', c.missing_waivers, 'waivers', 'Collect and attach them'], ['Checks drafted or printed but not recorded as issued', c.pending_checks, 'checks', 'Issue or void them'], ['Issued checks that have not cleared the bank', c.uncleared_checks, 'checks', 'Clear them in a bank reconciliation'], ['Client invoices not fully collected', c.open_invoices, 'bills', 'Record the payments'], ['Bills with no receipt or invoice attached', c.undocumented, 'bills', 'Attach supporting documents (recommended)']];
    const blocking = items.slice(0, 5).reduce((a, i) => a + i[1], 0);
    body = (<div className="space-y-5"><Panel pad={false} title="Closeout checklist"><table className="w-full"><tbody>{items.map(([label, n, to, fix]) => <tr key={label} className="border-b border-line last:border-0"><td className="td w-10">{n === 0 ? <Badge tone="green">OK</Badge> : <Badge tone="amber">{n}</Badge>}</td><td className="td">{label}{n > 0 && <span className="ml-2 text-xs text-muted">{fix}</span>}</td><td className="td text-right">{n > 0 && <Link className="link text-xs" href={`${base}/${to}`}>Review</Link>}</td></tr>)}</tbody></table></Panel>
      <Panel title="Finish the project">
        <p className="mb-3 text-sm text-muted">{blocking ? `${blocking} item(s) above are still open. You can still generate the reports, but the final ledger will show unpaid balances.` : 'Everything is settled. Generate the final package, then mark the project completed.'} Archived projects stay fully searchable and their records are never deleted.</p>
        <div className="flex flex-wrap gap-2"><a className="btn btn-primary" target="_blank" href={exp('final-project', '&format=pdf')}>Final ledger (PDF)</a><a className="btn" href={exp('final-project', '&format=xlsx')}>Final ledger (Excel)</a><Link className="btn" href={`${base}/documents`}>Review documents</Link>
          {canEdit && p.status !== 'closeout' && p.status !== 'completed' && p.status !== 'archived' && <ActionButton label="Mark ready for closeout" action={setProjectStatus.bind(null, id, 'closeout')} />}
          {canEdit && p.status !== 'completed' && p.status !== 'archived' && <ActionButton label="Mark completed" confirm={blocking ? 'There are still open items. Mark completed anyway?' : 'Mark this project completed?'} action={setProjectStatus.bind(null, id, 'completed')} />}
          {canEdit && p.status === 'completed' && <ActionButton label="Archive project" confirm="Archive this project? It stays searchable and can be reopened." action={setProjectStatus.bind(null, id, 'archived')} />}
          {canEdit && ['completed', 'archived'].includes(p.status) && <ActionButton label="Reopen" action={setProjectStatus.bind(null, id, 'active')} />}</div></Panel></div>);
  } else notFound();

  return (<>
    <PageHeader back={{ href: '/projects', label: 'All projects' }} title={<>{s.name} <span className="ml-1 align-middle text-sm font-normal text-muted">{s.number}</span> <span className="align-middle"><Badge>{s.status}</Badge></span></>} subtitle={s.address ?? undefined}>{writeCheck}{addBill}</PageHeader>
    <Tabs current={tab} items={TABS.filter(([k]) => k !== 'checks' || can(user, 'checks.read')).map(([k, l]) => ({ key: k, label: l, href: k === 'overview' ? base : `${base}/${k}` }))} />
    {body}
  </>);
}
const coFields = [{ name: 'description', label: 'Description', required: true, full: true }, { name: 'date', label: 'Date', type: 'date' as const }, { name: 'status', label: 'Status', type: 'select' as const, options: ['pending', 'approved', 'rejected'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) }, { name: 'budgetChange', label: 'Change to cost budget', type: 'money' as const }, { name: 'priceChange', label: 'Change to contract price', type: 'money' as const }];
