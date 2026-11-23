import { PERIODS } from '@/lib/filters';
type Opt = { id: number; name: string };
/** Plain GET form: filters live in the URL, so any view can be bookmarked or shared. */
export function FilterBar({ projects, values, show = ['project', 'period'], extra, action }: { projects?: Opt[]; values: Record<string, string | number | undefined>; show?: string[]; extra?: React.ReactNode; action?: string }) {
  return (
    <form action={action} className="no-print panel mb-5 flex flex-wrap items-end gap-3 px-4 py-3">
      {show.includes('project') && <div><label className="label" htmlFor="fp">Project</label><select id="fp" name="project" defaultValue={values.project ?? ''} className="input w-56"><option value="">{show.includes('projectRequired') ? '— Choose a project —' : 'All projects (company-wide)'}</option>{projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
      {show.includes('period') && <div><label className="label" htmlFor="fpe">Period</label><select id="fpe" name="period" defaultValue={values.period ?? 'ytd'} className="input w-40">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}
      {(show.includes('period') || show.includes('range')) && <><div><label className="label" htmlFor="ff">From</label><input id="ff" type="date" name="from" defaultValue={values.period === 'custom' || show.includes('range') ? values.from : ''} className="input" /></div>
        <div><label className="label" htmlFor="ft">To</label><input id="ft" type="date" name="to" defaultValue={values.period === 'custom' || show.includes('range') ? values.to : ''} className="input" /></div></>}
      {show.includes('asof') && <div><label className="label" htmlFor="fa">As of</label><input id="fa" type="date" name="to" defaultValue={values.to} className="input" /></div>}
      {show.includes('basis') && <div><label className="label" htmlFor="fb">Accounting method</label><select id="fb" name="basis" defaultValue={values.basis ?? 'accrual'} className="input w-44"><option value="accrual">Accrual basis</option><option value="cash">Cash basis</option></select></div>}
      {show.includes('granularity') && <div><label className="label" htmlFor="fg">Group by</label><select id="fg" name="granularity" defaultValue={values.granularity ?? 'quarter'} className="input w-32"><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></div>}
      {extra}
      <button className="btn">Apply</button>
    </form>
  );
}
