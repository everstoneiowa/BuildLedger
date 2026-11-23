import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and, sql } from 'drizzle-orm';
import { type Ctx, schema, audit, one } from '@/db';
import { sha256 } from '@/lib/crypto';
const { blobs, documents, documentLinks } = schema;

const root = () => path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), '.data', 'files'));
const keyPath = (key: string) => path.join(root(), key);
export const FOLDER_FOR: Record<string, string> = { bill: 'Financial Documents', invoice: 'Financial Documents', check: 'Financial Documents', payment: 'Financial Documents', waiver: 'Lien Waivers', vendor: 'Vendor Documents', client: 'Contracts' };

/** Store a file once (by content hash) and create a document record pointing at it. */
export async function saveDocument(ctx: Ctx, f: { name: string; mime: string; data: Buffer; folder?: string | null; description?: string | null; tags?: string | null; links?: { type: string; id: number }[]; versionOf?: number | null }) {
  if (!f.data.length) throw new Error('The file is empty');
  const hash = sha256(f.data);
  let blob = await one<{ id: number }>(ctx.db, sql`SELECT id FROM blobs WHERE sha256 = ${hash}`);
  if (!blob) {
    const key = path.join(hash.slice(0, 2), hash);
    await fs.mkdir(path.dirname(keyPath(key)), { recursive: true });
    await fs.writeFile(keyPath(key), f.data, { mode: 0o600 });
    [blob] = await ctx.db.insert(blobs).values({ sha256: hash, size: f.data.length, mime: f.mime || 'application/octet-stream', storageKey: key }).returning({ id: blobs.id });
  }
  let versionGroup: number | null = null, version = 1;
  if (f.versionOf) {
    const [prev] = await ctx.db.select().from(documents).where(and(eq(documents.id, f.versionOf), eq(documents.companyId, ctx.companyId)));
    if (!prev) throw new Error('Original document not found');
    versionGroup = prev.versionGroup ?? prev.id;
    const max = await one<{ v: number }>(ctx.db, sql`SELECT max(version)::int v FROM documents WHERE version_group = ${versionGroup} OR id = ${versionGroup}`);
    version = (max?.v ?? 1) + 1;
    await ctx.db.update(documents).set({ isCurrent: false, versionGroup }).where(sql`${documents.id} = ${versionGroup} OR ${documents.versionGroup} = ${versionGroup}`);
    f = { ...f, folder: f.folder ?? prev.folder, description: f.description ?? prev.description, tags: f.tags ?? prev.tags };
  }
  const folder = f.folder || (f.links?.map(l => FOLDER_FOR[l.type]).find(Boolean)) || (f.mime.startsWith('image/') ? 'Project Photos' : 'Miscellaneous');
  const [doc] = await ctx.db.insert(documents).values({ companyId: ctx.companyId, blobId: blob.id, name: f.name, description: f.description || null, folder, tags: f.tags || null, versionGroup, version, uploadedBy: ctx.userId }).returning({ id: documents.id });
  if (f.versionOf) { // a new version inherits every association of the previous one
    await ctx.db.execute(sql`INSERT INTO document_links (document_id, entity_type, entity_id) SELECT ${doc.id}, entity_type, entity_id FROM document_links WHERE document_id = ${f.versionOf} ON CONFLICT DO NOTHING`);
  }
  for (const l of f.links ?? []) await linkDocument(ctx, doc.id, l.type, l.id);
  await audit(ctx, 'upload', 'document', doc.id, `Uploaded "${f.name}"${version > 1 ? ` (version ${version})` : ''}`);
  return doc.id;
}
export async function linkDocument(ctx: Ctx, documentId: number, entityType: string, entityId: number) {
  await ctx.db.insert(documentLinks).values({ documentId, entityType, entityId }).onConflictDoNothing();
  // A file that was uploaded loose gets filed automatically the first time it is attached to a record.
  const folder = FOLDER_FOR[entityType];
  if (folder) await ctx.db.update(documents).set({ folder }).where(and(eq(documents.id, documentId), eq(documents.folder, 'Miscellaneous')));
}
export async function readDocument(ctx: Ctx, id: number) {
  const d = await one<{ name: string; mime: string; storage_key: string }>(ctx.db, sql`
    SELECT d.name, b.mime, b.storage_key FROM documents d JOIN blobs b ON b.id = d.blob_id WHERE d.id = ${id} AND d.company_id = ${ctx.companyId} AND d.deleted_at IS NULL`);
  if (!d) return null;
  return { name: d.name, mime: d.mime, data: await fs.readFile(keyPath(d.storage_key)) };
}
