import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { projectFields } from '@/lib/fields';
import { projectSummaries } from '@/services/reports';
import { PageHeader, Panel } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import { saveProject } from '../../actions';

export default async function Projects() {
  const { user, ctx } = await session(); const [o, ps] = await Promise.all([loadOptions(ctx), projectSummaries(ctx)]);
  return (<>
    <PageHeader title="Projects" subtitle="Every home has its own ledger, documents, vendors and reports.">
      {can(user, 'projects.write') && <FormModal title="New project" trigger="New project" variant="btn-primary" action={saveProject} go="/projects" fields={projectFields(o.clients, o.jurisdictions, false)} initial={{ status: 'active', jurisdictionId: o.jurisdictions[0]?.id }} />}
    </PageHeader>
    <Panel pad={false}>
      <DataTable exportName="projects" empty="No projects yet. Create the first home you are building." columns={[{ key: 'number', label: 'No.', link: 'href' }, { key: 'name', label: 'Project', link: 'href' }, { key: 'address', label: 'Address' }, { key: 'client', label: 'Client' }, { key: 'status', label: 'Status', type: 'badge', filter: true },
        { key: 'revisedBudget', label: 'Budget', type: 'money', total: true }, { key: 'actualCost', label: 'Cost to date', type: 'money', total: true }, { key: 'unpaid', label: 'Unpaid', type: 'money', total: true }, { key: 'revenue', label: 'Revenue', type: 'money', total: true }, { key: 'grossProfit', label: 'Gross profit', type: 'money', total: true }]}
        rows={ps.map(p => ({ ...p, href: `/projects/${p.id}` }))} />
    </Panel>
  </>);
}
