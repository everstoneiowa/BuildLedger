import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { listDocuments } from '@/services/lists';
import { PageHeader, Panel } from '@/components/ui';
import { UploadZone } from '@/components/UploadZone';
import { DocumentsTable } from '@/components/tables';
export default async function Documents() {
  const { user, ctx } = await session(); const [o, docs] = await Promise.all([loadOptions(ctx), listDocuments(ctx)]); const w = can(user, 'documents.write');
  return (<><PageHeader title="Documents" subtitle="Every file in the company, across all projects. Open a project to see only its filing cabinet." />
    {w && <div className="mb-5"><UploadZone label="Drop files here to upload them, then use Edit to file each one under a project, vendor and folder — or" /></div>}
    <Panel pad={false}><DocumentsTable rows={docs} canEdit={w} projects={o.projects} vendors={o.vendors} /></Panel></>);
}
