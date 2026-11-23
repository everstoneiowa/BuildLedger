import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one, rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { documentFields } from '@/lib/fields';
import { fmtDate } from '@/lib/money';
import { PageHeader, Panel, Field, Badge } from '@/components/ui';
import { FormModal, ActionButton } from '@/components/FormModal';
import { UploadZone } from '@/components/UploadZone';
import { updateDocument, deleteDocument } from '../../../actions';

const HREF: Record<string, (id: number) => string> = { project: i => `/projects/${i}/documents`, vendor: i => `/vendors/${i}`, client: i => `/clients/${i}`, bill: i => `/bills/${i}`, invoice: i => `/invoices/${i}`, check: i => `/checks/${i}`, waiver: () => '#' };
export default async function Doc({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const { user, ctx } = await session();
  const d = await one<any>(ctx.db, sql`SELECT d.*, to_char(d.uploaded_at, 'YYYY-MM-DD') up, b.mime, b.size, b.sha256, u.name uploader FROM documents d JOIN blobs b ON b.id = d.blob_id LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = ${id} AND d.company_id = ${ctx.companyId} AND d.deleted_at IS NULL`);
  if (!d) notFound(); const group = d.version_group ?? d.id;
  const [o, links, versions] = await Promise.all([loadOptions(ctx),
    rows<any>(ctx.db, sql`SELECT dl.entity_type t, dl.entity_id i, coalesce((SELECT number || ' — ' || name FROM projects WHERE id = dl.entity_id AND dl.entity_type = 'project'), (SELECT name FROM vendors WHERE id = dl.entity_id AND dl.entity_type = 'vendor'), (SELECT name FROM clients WHERE id = dl.entity_id AND dl.entity_type = 'client'), (SELECT coalesce(bill_no, internal_no, '#' || id) FROM bills WHERE id = dl.entity_id AND dl.entity_type = 'bill'), '#' || dl.entity_id) label FROM document_links dl WHERE dl.document_id = ${id} ORDER BY 1`),
    rows<any>(ctx.db, sql`SELECT d.id, d.version, d.name, d.is_current, to_char(d.uploaded_at, 'YYYY-MM-DD') up, coalesce(u.name, '') who FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE (d.id = ${group} OR d.version_group = ${group}) AND d.deleted_at IS NULL ORDER BY d.version DESC`)]);
  const w = can(user, 'documents.write'); const src = `/api/files/${id}`; const isImg = d.mime.startsWith('image/'), isPdf = d.mime === 'application/pdf';
  return (<>
    <PageHeader back={{ href: '/documents', label: 'All documents' }} title={<>{d.name} {!d.is_current && <Badge tone="amber">Older version</Badge>}</>} subtitle={`${d.folder} · version ${d.version}`}>
      <a className="btn" href={`${src}?download=1`}>Download</a>
      {w && <FormModal title="Document details" trigger="Rename / file" action={updateDocument} hidden={{ id }} fields={documentFields(o.projects, o.vendors)} initial={{ name: d.name, folder: d.folder, tags: d.tags, description: d.description }} />}
      {w && <ActionButton label="Move to trash" variant="btn-danger" confirm="Remove this document from all lists? The file itself is retained for audit purposes." action={deleteDocument.bind(null, id)} done="/documents" />}
    </PageHeader>
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel className="lg:col-span-2" pad={false} title="Preview">{isPdf ? <iframe src={src} title={d.name} className="h-[75vh] w-full" /> : isImg ? <img src={src} alt={d.name} className="mx-auto max-h-[75vh]" /> : <p className="p-8 text-center text-sm text-muted">This file type cannot be previewed in the browser. Download it to open it.</p>}</Panel>
      <div className="space-y-5">
        <Panel title="Details"><dl className="space-y-3"><Field label="Description">{d.description}</Field><Field label="Tags">{d.tags}</Field><Field label="Uploaded">{fmtDate(d.up)} by {d.uploader ?? 'unknown'}</Field><Field label="Size">{Math.max(1, Math.round(d.size / 1024)).toLocaleString()} KB · {d.mime}</Field></dl></Panel>
        <Panel title="Filed under">{links.length ? <ul className="space-y-1 text-sm">{links.map((l, k) => <li key={k}><span className="capitalize text-muted">{l.t}: </span><Link className="link" href={HREF[l.t]?.(l.i) ?? '#'}>{l.label}</Link></li>)}</ul> : <p className="text-sm text-muted">Not linked to a project or vendor yet. Use “Rename / file”.</p>}
          <p className="mt-2 text-xs text-muted">One stored file can be linked to many records; it is never duplicated.</p></Panel>
        <Panel title="Version history"><ul className="mb-3 space-y-1 text-sm">{versions.map(v => <li key={v.id}>{v.id === id ? <strong>v{v.version}</strong> : <Link className="link" href={`/documents/${v.id}`}>v{v.version}</Link>} <span className="text-muted">{fmtDate(v.up)} {v.who}{v.is_current ? ' · current' : ''}</span></li>)}</ul>
          {w && d.is_current && <UploadZone compact versionOf={id} label="Upload a newer version —" />}</Panel>
      </div>
    </div>
  </>);
}
