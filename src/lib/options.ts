import { sql } from 'drizzle-orm';
import { type Ctx, rows } from '@/db';
import { paymentAccounts } from '@/services/accounting';
import type { OpenBill } from '@/components/MoneyForms';

/** Dropdown data shared by most forms. */
export async function loadOptions(ctx: Ctx) {
  const c = ctx.companyId;
  const [vendors, clients, projects, categories, accounts, banks, jurisdictions] = await Promise.all([
    rows<{ id: number; name: string }>(ctx.db, sql`SELECT id, name FROM vendors WHERE company_id = ${c} AND active ORDER BY name`),
    rows<{ id: number; name: string }>(ctx.db, sql`SELECT id, name FROM clients WHERE company_id = ${c} AND active ORDER BY name`),
    rows<{ id: number; name: string; clientId: number | null }>(ctx.db, sql`SELECT id, number || ' — ' || name AS name, client_id AS "clientId" FROM projects WHERE company_id = ${c} AND status <> 'archived' ORDER BY number`),
    rows<{ id: number; name: string; kind: string }>(ctx.db, sql`SELECT c.id, CASE WHEN p.id IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS name, c.kind FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.company_id = ${c} AND c.active ORDER BY c.kind, coalesce(p.sort, c.sort), coalesce(p.name, c.name), c.parent_id NULLS FIRST, c.name`),
    paymentAccounts(ctx).then(a => a.map(x => ({ id: x.id, name: `${x.name}${x.subtype === 'credit_card' ? ' (credit card)' : ''}`, subtype: x.subtype }))),
    rows<{ id: number; name: string; next: number }>(ctx.db, sql`SELECT id, name, next_check_number AS next FROM bank_accounts WHERE company_id = ${c} AND active ORDER BY id`),
    rows<{ id: number; name: string; waiver_types: string[] }>(ctx.db, sql`SELECT id, name, waiver_types FROM jurisdictions WHERE company_id = ${c} ORDER BY id`),
  ]);
  return { vendors, clients, projects, categories, accounts, banks, jurisdictions, aiEnabled: !!process.env.ANTHROPIC_API_KEY };
}
/** Bills that can still go on a check: open balance net of checks already drafted or printed. */
export function openBills(ctx: Ctx) {
  return rows<OpenBill>(ctx.db, sql`
    SELECT * FROM (SELECT b.id, b.vendor_id AS "vendorId", v.name vendor, coalesce(b.bill_no, b.internal_no, 'Bill #' || b.id) ref, b.date::text date, b.project_id AS "projectId", coalesce(p.number, 'General') project, v.address,
      (b.total - b.amount_paid - coalesce((SELECT sum(ca.amount) FROM check_apps ca JOIN checks c ON c.id = ca.check_id WHERE ca.bill_id = b.id AND c.status IN ('draft','printed')), 0))::text open
    FROM bills b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id WHERE b.company_id = ${ctx.companyId} AND b.status = 'open') x WHERE x.open::numeric > 0 ORDER BY x.vendor, x.date`);
}
