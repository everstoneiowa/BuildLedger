import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { one } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { resolvePeriod } from '@/lib/filters';
import { fmtMoney, fmtDate, today } from '@/lib/money';
import { REPORTS, type Report, type Col } from '@/services/reports';
import { PageHeader, NoAccess } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { PrintPage } from '@/components/PrintButton';

const show = (c: Col, v: any) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? fmtMoney(v, { paren: true }) : c.type === 'date' ? fmtDate(String(v)) : String(v));
export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string>> }) {
  const { key } = await params; const sp = await searchParams; const def = REPORTS.find(r => r.key === key); if (!def) notFound();
  const { user, ctx } = await session(); const projectScoped = def.params.includes('projectRequired');
  if (!can(user, 'reports.read') && !projectScoped) return <NoAccess />; if (key === 'check-register' && !can(user, 'checks.read')) return <NoAccess />;
  const o = await loadOptions(ctx); const co = await one<{ name: string }>(ctx.db, sql`SELECT name FROM companies WHERE id = ${ctx.companyId}`);
  const range = resolvePeriod(sp.period, sp.from, sp.to); const projectId = Number(sp.project) || undefined; const basis = sp.basis === 'cash' ? 'cash' : 'accrual'; const granularity = (['month', 'quarter', 'year'].includes(sp.granularity) ? sp.granularity : 'quarter') as 'month' | 'quarter' | 'year';
  const asof = def.params.includes('asof'); const hasRange = def.params.includes('range');
  const f = { from: hasRange ? range.from : undefined, to: asof ? (sp.to || today()) : hasRange ? range.to : undefined, projectId, basis, granularity } as const;
  let report: Report | null = null, error = '';
  if (projectScoped && !projectId) error = 'Choose a project above to run this report.'; else try { report = await def.run(ctx, f); } catch (e: any) { error = e.message; }
  const q = new URLSearchParams(Object.entries({ from: f.from, to: f.to, project: projectId, basis, granularity }).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  const showBar = [...(def.params.includes('project') || projectScoped ? ['project'] : []), ...(projectScoped ? ['projectRequired'] : []), ...(hasRange ? ['period'] : []), ...(asof ? ['asof'] : []), ...(def.params.includes('basis') ? ['basis'] : []), ...(def.params.includes('granularity') ? ['granularity'] : [])];
  return (<>
    <PageHeader back={{ href: '/reports', label: 'Report center' }} title={def.title} subtitle={def.desc}>
      {report && <><PrintPage /><a className="btn" target="_blank" href={`/api/reports/${key}?${q}&format=pdf`}>PDF</a><a className="btn" href={`/api/reports/${key}?${q}&format=xlsx`}>Excel</a><a className="btn" href={`/api/reports/${key}?${q}&format=csv`}>CSV</a></>}
    </PageHeader>
    {showBar.length > 0 && <FilterBar projects={o.projects} show={showBar} values={{ ...range, project: projectId, basis, granularity, to: asof ? f.to : range.to }} />}
    {error && <div className="panel p-8 text-center text-sm text-muted">{error}</div>}
    {report && <article className="panel p-6">
      <header className="mb-5 border-b-2 border-ink pb-3"><div className="text-sm font-semibold text-muted">{co?.name}</div><h2 className="text-xl font-semibold">{report.title}</h2><div className="text-sm text-muted">{[report.period, report.basis, `Prepared ${fmtDate(today())}`].filter(Boolean).join('  ·  ')}</div></header>
      {report.sections.map((s, n) => <section key={n} className="mb-7">
        {s.heading && <h3 className="mb-1 text-sm font-semibold">{s.heading}</h3>}{s.note && <p className="mb-1 text-xs text-muted">{s.note}</p>}
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
          {s.columns.some(c => c.label) && <thead><tr className="border-b border-slate-300 bg-slate-50">{s.columns.map(c => <th key={c.key} className={`th ${c.type === 'money' || c.type === 'number' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>}
          <tbody>{s.rows.map((r, i) => <tr key={i} className="border-b border-line">{s.columns.map(c => <td key={c.key} className={`px-3 py-1.5 ${c.type === 'money' || c.type === 'number' ? 'whitespace-nowrap text-right' : ''} ${c.type === 'money' && Number(r[c.key]) < 0 ? 'text-red-700' : ''}`}>{show(c, r[c.key])}</td>)}</tr>)}
            {!s.rows.length && <tr><td colSpan={s.columns.length} className="px-3 py-3 text-muted">No records for this period.</td></tr>}</tbody>
          {s.totals && <tfoot><tr className="border-t-2 border-slate-400 font-semibold">{s.columns.map((c, i) => <td key={c.key} className={`px-3 py-1.5 ${c.type === 'money' || c.type === 'number' ? 'whitespace-nowrap text-right' : ''}`}>{s.totals![c.key] !== undefined ? show(c, s.totals![c.key]) : i === 0 ? String(Object.values(s.totals!).find(v => typeof v === 'string' && isNaN(Number(v))) ?? 'Total') : ''}</td>)}</tr></tfoot>}
        </table></div></section>)}
      {report.notes?.map((n, i) => <p key={i} className="text-xs text-muted">{n}</p>)}
    </article>}
  </>);
}
