import { sql } from 'drizzle-orm';
import { rows } from '@/db';
import { session, can } from '@/lib/auth';
import { loadOptions } from '@/lib/options';
import { resolvePeriod } from '@/lib/filters';
import { tripFields } from '@/lib/fields';
import { fmtMoney, today } from '@/lib/money';
import { mileageTrips } from '@/services/reports';
import { PageHeader, Panel, Stat } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { FormModal, ActionButton } from '@/components/FormModal';
import { saveTrip, deleteTrip, saveVehicle } from '../../actions';

export default async function Mileage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams; const { user, ctx } = await session(); const o = await loadOptions(ctx); const range = resolvePeriod(sp.period, sp.from, sp.to); const projectId = Number(sp.project) || undefined;
  const [trips, vehicles, rate] = await Promise.all([mileageTrips(ctx, { ...range, projectId }), rows<any>(ctx.db, sql`SELECT id, name FROM vehicles WHERE company_id = ${ctx.companyId} AND active ORDER BY id`),
    rows<any>(ctx.db, sql`SELECT rate::text rate, effective_from::text ef FROM mileage_rates WHERE company_id = ${ctx.companyId} AND effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1`)]);
  const w = can(user, 'mileage.write'); const miles = trips.reduce((a, t) => a + Number(t.miles), 0), ded = trips.reduce((a, t) => a + Number(t.deduction), 0); const fields = tripFields(o.projects, vehicles);
  const qs = `period=${range.period}&from=${range.from}&to=${range.to}`;
  return (<>
    <PageHeader title="Mileage" subtitle="Log business trips from your phone or desk. Deductions use the rate in effect on each trip date.">
      <a className="btn" href={`/reports/mileage?${qs}`}>Mileage report</a><a className="btn" href={`/api/reports/mileage?from=${range.from}&to=${range.to}&format=xlsx`}>Export log (Excel)</a>
      {w && <FormModal title="Add a vehicle" trigger="Add vehicle" action={saveVehicle} fields={[{ name: 'name', label: 'Vehicle', required: true, placeholder: '2023 F-150', full: true }]} />}
      {w && <FormModal title="Log a trip" trigger="Log a trip" variant="btn-primary" action={saveTrip} fields={fields} initial={{ date: today(), vehicleId: vehicles[0]?.id }} />}
    </PageHeader>
    <FilterBar projects={o.projects} values={{ ...range, project: projectId }} />
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Trips" value={trips.length} /><Stat label="Business miles" value={miles.toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Stat label="Estimated deduction" value={fmtMoney(ded.toFixed(2))} hint="Confirm with your tax preparer" /><Stat label="Current rate" value={rate[0] ? `$${Number(rate[0].rate)}/mi` : 'Not set'} hint={rate[0] ? `Effective ${rate[0].ef} · change in Settings` : 'Add a rate in Settings'} /></div>
    <Panel pad={false}><DataTable exportName="mileage-log" empty="No trips logged in this period." columns={[{ key: 'date', label: 'Date', type: 'date' }, { key: 'origin', label: 'From' }, { key: 'destination', label: 'To' }, { key: 'purpose', label: 'Business purpose' }, { key: 'project', label: 'Project', filter: true }, { key: 'vehicle', label: 'Vehicle' }, { key: 'odo_start', label: 'Odo start', type: 'number' }, { key: 'odo_end', label: 'Odo end', type: 'number' }, { key: 'miles', label: 'Miles', type: 'number' }, { key: 'deduction', label: 'Deduction', type: 'money', total: true }, { key: 'actions', label: '' }]}
      rows={trips.map(t => ({ ...t, actions: w ? <span className="flex justify-end gap-1"><FormModal title="Edit trip" trigger="Edit" variant="btn-sm" action={saveTrip} hidden={{ id: t.id }} fields={fields} initial={{ date: t.date, origin: t.origin, destination: t.destination, purpose: t.purpose, projectId: t.project_id, vehicleId: t.vehicle_id, miles: t.miles, odoStart: t.odo_start, odoEnd: t.odo_end, notes: t.notes }} /><ActionButton variant="btn-sm btn-danger" label="Delete" confirm="Delete this trip?" action={deleteTrip.bind(null, t.id)} /></span> : '' }))} /></Panel>
  </>);
}
