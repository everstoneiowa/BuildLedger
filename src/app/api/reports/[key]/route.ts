import { sql } from 'drizzle-orm';
import { one } from '@/db';
import { session, can } from '@/lib/auth';
import { runReport } from '@/services/reports';
import { filtersFrom } from '@/lib/filters';
import { reportPdf, reportXlsx, reportCsv } from '@/lib/export';

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { user, ctx } = await session(); const { key } = await params; const sp = new URL(req.url).searchParams;
  const projectScoped = ['project-ledger', 'final-project'].includes(key);
  if (!can(user, 'reports.read') && !projectScoped) return new Response('Your role does not have access to company reports.', { status: 403 });
  if (key === 'check-register' && !can(user, 'checks.read')) return new Response('Forbidden', { status: 403 });
  try {
    const r = await runReport(ctx, key, filtersFrom(k => sp.get(k))); const co = (await one<{ name: string }>(ctx.db, sql`SELECT name FROM companies WHERE id = ${ctx.companyId}`))!.name;
    const format = sp.get('format') ?? 'pdf'; const name = `${key}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'xlsx') return new Response(new Uint8Array(await reportXlsx(r, co)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` } });
    if (format === 'csv') return new Response(reportCsv(r, co), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` } });
    return new Response(Buffer.from(await reportPdf(r, co)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"` } });
  } catch (e: any) { return new Response(e.message, { status: 400 }); }
}
