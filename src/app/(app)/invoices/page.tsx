import { session, can } from '@/lib/auth';
import { loadOptions, openBills } from '@/lib/options';
import { listBills, listInvoices } from '@/services/lists';
import { PageHeader, Panel, Tabs } from '@/components/ui';
import { BillForm } from '@/components/BillForm';
import { InvoiceForm, CheckForm } from '@/components/MoneyForms';
import { BillsTable, InvoicesTable } from '@/components/tables';

export default async function InvoicesAndBills({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const tab = (await searchParams).tab ?? 'bills'; const { user, ctx } = await session(); const o = await loadOptions(ctx);
  const bills = tab === 'invoices' ? [] : (await listBills(ctx)).filter(b => (tab === 'internal' ? b.kind === 'internal' : tab === 'unpaid' ? ['unpaid', 'partial'].includes(b.status) : true));
  return (<>
    <PageHeader title="Invoices & Bills" subtitle="Bills are what vendors charge the company. Invoices are what the company charges clients. They are kept separate everywhere.">
      {can(user, 'checks.write') && <CheckForm label="Write check" banks={o.banks} bills={await openBills(ctx)} />}
      {can(user, 'invoices.write') && <InvoiceForm label="New client invoice" clients={o.clients} projects={o.projects} />}
      {can(user, 'bills.write') && <BillForm label="Add vendor bill" variant="btn-primary" vendors={o.vendors} projects={o.projects} categories={o.categories} accounts={o.accounts} aiEnabled={o.aiEnabled} canPay={can(user, 'payments.write')} />}
    </PageHeader>
    <Tabs current={tab} items={[{ key: 'bills', label: 'Vendor bills (payable)', href: '/invoices' }, { key: 'unpaid', label: 'Unpaid bills', href: '/invoices?tab=unpaid' }, { key: 'internal', label: 'Internally prepared payment requests', href: '/invoices?tab=internal' }, { key: 'invoices', label: 'Client invoices (receivable)', href: '/invoices?tab=invoices' }]} />
    <Panel pad={false}>{tab === 'invoices' ? <InvoicesTable rows={await listInvoices(ctx)} /> : <BillsTable rows={bills} />}</Panel>
    {tab === 'internal' && <p className="mt-2 text-xs text-muted">Payment requests are prepared by the company when a subcontractor has no invoice. They use their own PR- numbers and are always labelled as internally prepared.</p>}
  </>);
}
