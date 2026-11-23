import { session, can } from '@/lib/auth';
import { vendorFields } from '@/lib/fields';
import { listVendors } from '@/services/lists';
import { PageHeader, Panel } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import { saveVendor } from '../../actions';
export default async function Vendors() {
  const { user, ctx } = await session(); const vs = await listVendors(ctx);
  return (<><PageHeader title="Vendors" subtitle="Subcontractors and suppliers, with their activity across every project.">{can(user, 'contacts.write') && <FormModal title="New vendor" trigger="New vendor" variant="btn-primary" action={saveVendor} fields={vendorFields(can(user, 'sensitive.read'))} initial={{ kind: 'subcontractor' }} />}</PageHeader>
    <Panel pad={false}><DataTable exportName="vendors" empty="No vendors yet." columns={[{ key: 'name', label: 'Vendor', link: 'href' }, { key: 'kind', label: 'Type', filter: true }, { key: 'trade', label: 'Trade', filter: true }, { key: 'contact', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'projects', label: 'Projects', type: 'number' }, { key: 'state', label: 'Active', filter: true }, { key: 'billed', label: 'Billed', type: 'money', total: true }, { key: 'paid', label: 'Paid', type: 'money', total: true }, { key: 'owed', label: 'Outstanding', type: 'money', total: true }]}
      rows={vs.map(v => ({ ...v, href: `/vendors/${v.id}`, state: v.active ? 'Active' : 'Archived' }))} /></Panel></>);
}
