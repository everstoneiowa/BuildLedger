import { sql, type SQL } from 'drizzle-orm';
import { type Ctx, rows } from '@/db';
import { BILL_STATUS, INV_STATUS, PAID_VIA } from './reports';

type Scope = { projectId?: number; vendorId?: number; clientId?: number; businessOnly?: boolean };
const w = (cond: unknown, s: SQL) => (cond ? s : sql``);

export function listBills(ctx: Ctx, f: Scope = {}) {
  return rows<any>(ctx.db, sql`
    SELECT b.id, b.date::text date, b.due_date::text due, coalesce(v.name, b.payee) vendor, b.vendor_id, coalesce(b.bill_no, b.internal_no, '') ref, b.kind, coalesce(p.number, '') project, b.project_id,
      coalesce(b.description, '') description, (SELECT string_agg(DISTINCT c.name, ', ') FROM bill_lines bl JOIN categories c ON c.id = bl.category_id WHERE bl.bill_id = b.id) categories,
      b.total::text total, b.amount_paid::text paid, (b.total - b.amount_paid)::text balance, ${BILL_STATUS} status, coalesce(${PAID_VIA}, '') paid_via,
      (SELECT count(*)::int FROM document_links dl JOIN documents d ON d.id = dl.document_id AND d.deleted_at IS NULL WHERE dl.entity_type = 'bill' AND dl.entity_id = b.id) docs,
      (b.status = 'open' AND b.amount_paid < b.total AND b.due_date < CURRENT_DATE) overdue
    FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id
    WHERE b.company_id = ${ctx.companyId} ${w(f.projectId, sql`AND b.project_id = ${f.projectId}`)} ${w(f.vendorId, sql`AND b.vendor_id = ${f.vendorId}`)} ${w(f.businessOnly, sql`AND b.project_id IS NULL`)}
    ORDER BY b.date DESC, b.id DESC`);
}
export function listInvoices(ctx: Ctx, f: Scope = {}) {
  return rows<any>(ctx.db, sql`
    SELECT i.id, i.number, i.date::text date, i.due_date::text due, c.name client, i.client_id, coalesce(p.number, '') project, i.project_id, i.total::text total, i.amount_paid::text paid, (i.total - i.amount_paid)::text balance, ${INV_STATUS} status
    FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.company_id = ${ctx.companyId} ${w(f.projectId, sql`AND i.project_id = ${f.projectId}`)} ${w(f.clientId, sql`AND i.client_id = ${f.clientId}`)} ORDER BY i.id DESC`);
}
export function listChecks(ctx: Ctx, f: Scope = {}) {
  return rows<any>(ctx.db, sql`
    SELECT c.id, c.number, c.date::text date, c.payee, c.vendor_id, coalesce(c.memo, '') memo, coalesce(p.number, '') project, ba.name bank, c.status, c.amount::text amount, c.print_count, c.cleared_at::text cleared
    FROM checks c JOIN bank_accounts ba ON ba.id = c.bank_account_id LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.company_id = ${ctx.companyId} ${w(f.vendorId, sql`AND c.vendor_id = ${f.vendorId}`)}
      ${w(f.projectId, sql`AND (c.project_id = ${f.projectId} OR EXISTS (SELECT 1 FROM check_apps ca JOIN bills b ON b.id = ca.bill_id WHERE ca.check_id = c.id AND b.project_id = ${f.projectId}))`)}
    ORDER BY c.number DESC`);
}
export function listPayments(ctx: Ctx, f: Scope = {}) {
  return rows<any>(ctx.db, sql`
    SELECT p.id, p.date::text date, p.direction, p.method, coalesce(p.reference, '') reference, coalesce(v.name, c.name, '') party, a.name account, p.status, p.amount::text amount,
      (SELECT string_agg(coalesce(b.bill_no, b.internal_no, i.number, '#' || coalesce(b.id, i.id)), ', ') FROM payment_apps pa LEFT JOIN bills b ON b.id = pa.bill_id LEFT JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id) applied,
      ${f.projectId ? sql`(SELECT coalesce(sum(pa.amount), 0)::text FROM payment_apps pa LEFT JOIN bills b ON b.id = pa.bill_id LEFT JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id AND coalesce(b.project_id, i.project_id) = ${f.projectId})` : sql`p.amount::text`} scoped,
      (SELECT ck.id FROM checks ck WHERE ck.payment_id = p.id LIMIT 1) check_id
    FROM payments p JOIN accounts a ON a.id = p.account_id LEFT JOIN vendors v ON v.id = p.vendor_id LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.company_id = ${ctx.companyId} ${w(f.vendorId, sql`AND p.vendor_id = ${f.vendorId}`)} ${w(f.clientId, sql`AND p.client_id = ${f.clientId}`)}
      ${w(f.projectId, sql`AND EXISTS (SELECT 1 FROM payment_apps pa LEFT JOIN bills b ON b.id = pa.bill_id LEFT JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id AND coalesce(b.project_id, i.project_id) = ${f.projectId})`)}
    ORDER BY p.date DESC, p.id DESC`);
}
export function listWaivers(ctx: Ctx, f: Scope = {}) {
  return rows<any>(ctx.db, sql`
    SELECT w.id, w.type, w.status, w.amount::text amount, w.payment_date::text payment_date, w.received_date::text received_date, w.document_id, coalesce(w.notes, '') notes, v.name vendor, w.vendor_id, p.number project, w.project_id,
      (SELECT CASE WHEN pm.method = 'check' THEN 'Check #' || pm.reference ELSE upper(pm.method) END FROM payments pm WHERE pm.id = w.payment_id) payment
    FROM lien_waivers w JOIN vendors v ON v.id = w.vendor_id JOIN projects p ON p.id = w.project_id
    WHERE w.company_id = ${ctx.companyId} ${w(f.projectId, sql`AND w.project_id = ${f.projectId}`)} ${w(f.vendorId, sql`AND w.vendor_id = ${f.vendorId}`)}
    ORDER BY (w.status = 'requested') DESC, w.payment_date DESC NULLS LAST, w.id DESC`);
}
export function listDocuments(ctx: Ctx, f: { entity?: { type: string; id: number }; limit?: number } = {}) {
  return rows<any>(ctx.db, sql`
    SELECT d.id, d.name, coalesce(d.description, '') description, d.folder, coalesce(d.tags, '') tags, d.version, to_char(d.uploaded_at, 'YYYY-MM-DD') uploaded, coalesce(u.name, '') uploader, b.mime, b.size,
      (SELECT string_agg(DISTINCT p.number, ', ') FROM document_links dl JOIN projects p ON p.id = dl.entity_id WHERE dl.document_id = d.id AND dl.entity_type = 'project') projects,
      (SELECT string_agg(DISTINCT v.name, ', ') FROM document_links dl JOIN vendors v ON v.id = dl.entity_id WHERE dl.document_id = d.id AND dl.entity_type = 'vendor') vendors
    FROM documents d JOIN blobs b ON b.id = d.blob_id LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.company_id = ${ctx.companyId} AND d.deleted_at IS NULL AND d.is_current
      ${w(f.entity, sql`AND d.id IN (SELECT document_id FROM document_links WHERE entity_type = ${f.entity?.type ?? ''} AND entity_id = ${f.entity?.id ?? 0})`)}
    ORDER BY d.uploaded_at DESC ${f.limit ? sql`LIMIT ${f.limit}` : sql``}`);
}
export function listVendors(ctx: Ctx, f: { projectId?: number } = {}) {
  return rows<any>(ctx.db, sql`
    SELECT v.id, v.name, v.kind, coalesce(v.trade, '') trade, coalesce(v.contact, '') contact, coalesce(v.phone, '') phone, coalesce(v.email, '') email, v.active, v.insurance_expires::text insurance_expires,
      coalesce(sum(b.total) FILTER (WHERE b.status = 'open'), 0)::text billed, coalesce(sum(b.amount_paid) FILTER (WHERE b.status = 'open'), 0)::text paid, coalesce(sum(b.total - b.amount_paid) FILTER (WHERE b.status = 'open'), 0)::text owed,
      count(DISTINCT b.project_id)::int projects
    FROM vendors v LEFT JOIN bills b ON b.vendor_id = v.id ${w(f.projectId, sql`AND b.project_id = ${f.projectId}`)}
    WHERE v.company_id = ${ctx.companyId} ${w(f.projectId, sql`AND b.id IS NOT NULL`)} GROUP BY v.id ORDER BY v.name`);
}
export function listClients(ctx: Ctx) {
  return rows<any>(ctx.db, sql`
    SELECT c.id, c.name, coalesce(c.contact, '') contact, coalesce(c.phone, '') phone, coalesce(c.email, '') email, c.active,
      (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id) projects,
      coalesce((SELECT sum(total) FROM invoices i WHERE i.client_id = c.id AND i.status = 'open'), 0)::text invoiced,
      coalesce((SELECT sum(total - amount_paid) FROM invoices i WHERE i.client_id = c.id AND i.status = 'open'), 0)::text owed
    FROM clients c WHERE c.company_id = ${ctx.companyId} ORDER BY c.name`);
}
