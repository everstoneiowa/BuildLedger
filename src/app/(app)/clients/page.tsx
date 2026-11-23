import { session, can } from '@/lib/auth';
import { clientFields } from '@/lib/fields';
import { listClients } from '@/services/lists';
import { PageHeader, Panel } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import { saveClient } from '../../actions';
export default async function Clients() {
  const { user, ctx } = await session(); const cs = await listClients(ctx);
  return (<><PageHeader title="Clients" subtitle="Home buyers and property owners.">{can(user, 'contacts.write') && <FormModal title="New client" trigger="New client" variant="btn-primary" action={saveClient} fields={clientFields} />}</PageHeader>
    <Panel pad={false}><DataTable exportName="clients" empty="No clients yet." columns={[{ key: 'name', label: 'Client', link: 'href' }, { key: 'contact', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'projects', label: 'Projects', type: 'number' }, { key: 'invoiced', label: 'Invoiced', type: 'money', total: true }, { key: 'owed', label: 'Outstanding', type: 'money', total: true }]} rows={cs.map(c => ({ ...c, href: `/clients/${c.id}` }))} /></Panel></>);
}
