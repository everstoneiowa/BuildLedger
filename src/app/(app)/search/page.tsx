import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { rows } from '@/db';
import { session, can } from '@/lib/auth';
import { fmtMoney, fmtDate } from '@/lib/money';
import { PageHeader, Panel } from '@/components/ui';

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim(); const { user, ctx } = await session(); const c = ctx.companyId; const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`; const num = q.replace(/[#$,\s]/g, '');
  type Hit = { href: string; title: string; sub: string }; const groups: [string, Hit[]][] = [];
  if (q.length >= 2) {
    const [projects, vendors, clients, bills, invoices, checks, docs] = await Promise.all([
      rows<any>(ctx.db, sql`SELECT id, number, name, coalesce(address, '') address, status FROM projects WHERE company_id = ${c} AND (name ILIKE ${like} OR number ILIKE ${like} OR address ILIKE ${like} OR description ILIKE ${like}) LIMIT 15`),
      rows<any>(ctx.db, sql`SELECT id, name, coalesce(trade, '') trade, coalesce(contact, '') contact FROM vendors WHERE company_id = ${c} AND (name ILIKE ${like} OR trade ILIKE ${like} OR contact ILIKE ${like} OR email ILIKE ${like} OR phone ILIKE ${like}) LIMIT 15`),
      rows<any>(ctx.db, sql`SELECT id, name, coalesce(email, '') email FROM clients WHERE company_id = ${c} AND (name ILIKE ${like} OR contact ILIKE ${like} OR email ILIKE ${like} OR address ILIKE ${like}) LIMIT 15`),
      rows<any>(ctx.db, sql`SELECT b.id, coalesce(b.bill_no, b.internal_no, '#' || b.id) ref, coalesce(v.name, b.payee) vendor, b.date::text date, b.total::text total, coalesce(p.number, 'General') project FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id
        WHERE b.company_id = ${c} AND (b.bill_no ILIKE ${like} OR b.internal_no ILIKE ${like} OR b.description ILIKE ${like} OR v.name ILIKE ${like} OR b.payee ILIKE ${like} OR b.total::text = ${num}) ORDER BY b.date DESC LIMIT 25`),
      rows<any>(ctx.db, sql`SELECT i.id, i.number, cl.name client, i.date::text date, i.total::text total FROM invoices i JOIN clients cl ON cl.id = i.client_id WHERE i.company_id = ${c} AND (i.number ILIKE ${like} OR cl.name ILIKE ${like} OR i.total::text = ${num}) ORDER BY i.id DESC LIMIT 15`),
      can(user, 'checks.read') ? rows<any>(ctx.db, sql`SELECT id, number, payee, date::text date, amount::text amount, status FROM checks WHERE company_id = ${c} AND (number::text = ${num} OR payee ILIKE ${like} OR memo ILIKE ${like} OR amount::text = ${num}) ORDER BY number DESC LIMIT 15`) : [],
      rows<any>(ctx.db, sql`SELECT id, name, folder, to_char(uploaded_at, 'YYYY-MM-DD') up FROM documents WHERE company_id = ${c} AND deleted_at IS NULL AND is_current AND (name ILIKE ${like} OR description ILIKE ${like} OR tags ILIKE ${like} OR folder ILIKE ${like}) ORDER BY uploaded_at DESC LIMIT 25`),
    ]);
    groups.push(['Projects', projects.map(p => ({ href: `/projects/${p.id}`, title: `${p.number} — ${p.name}`, sub: `${p.address} · ${p.status}` }))], ['Vendors', vendors.map(v => ({ href: `/vendors/${v.id}`, title: v.name, sub: [v.trade, v.contact].filter(Boolean).join(' · ') }))], ['Clients', clients.map(x => ({ href: `/clients/${x.id}`, title: x.name, sub: x.email }))],
      ['Bills, receipts and expenses', bills.map(b => ({ href: `/bills/${b.id}`, title: `${b.ref} — ${b.vendor}`, sub: `${fmtDate(b.date)} · ${fmtMoney(b.total)} · ${b.project}` }))], ['Client invoices', invoices.map(i => ({ href: `/invoices/${i.id}`, title: `${i.number} — ${i.client}`, sub: `${fmtDate(i.date)} · ${fmtMoney(i.total)}` }))],
      ['Checks', checks.map(k => ({ href: `/checks/${k.id}`, title: `Check #${k.number} — ${k.payee}`, sub: `${fmtDate(k.date)} · ${fmtMoney(k.amount)} · ${k.status}` }))], ['Documents', docs.map(d => ({ href: `/documents/${d.id}`, title: d.name, sub: `${d.folder} · ${fmtDate(d.up)}` }))]);
  }
  const found = groups.filter(g => g[1].length); const total = found.reduce((a, g) => a + g[1].length, 0);
  return (<><PageHeader title={q ? `Search: “${q}”` : 'Search'} subtitle={q.length >= 2 ? `${total} result${total === 1 ? '' : 's'}${can(user, 'checks.read') ? '' : ' · check records are hidden for your role'}` : 'Type at least two characters in the search box above.'} />
    <div className="grid gap-5 md:grid-cols-2">{found.map(([name, hits]) => <Panel key={name} title={`${name} (${hits.length})`} pad={false}><ul>{hits.map(h => <li key={h.href} className="border-b border-line px-4 py-2 last:border-0"><Link className="link font-medium" href={h.href}>{h.title}</Link><div className="text-xs text-muted">{h.sub}</div></li>)}</ul></Panel>)}</div>
    {q.length >= 2 && !total && <div className="panel p-8 text-center text-sm text-muted">Nothing matched. Try a vendor name, project address, invoice number, check number or exact amount.</div>}</>);
}
