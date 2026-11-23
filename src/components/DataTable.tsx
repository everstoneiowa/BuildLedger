'use client';
import Link from 'next/link';
import { isValidElement, useMemo, useState, type ReactNode } from 'react';
import { fmtMoney, fmtDate } from '@/lib/money';
import { Badge } from './ui';

export type Column = { key: string; label: string; type?: 'money' | 'date' | 'badge' | 'number' | 'text'; link?: string; total?: boolean; filter?: boolean; sortable?: boolean; className?: string };
type Row = Record<string, any>;
const raw = (r: Row, k: string) => (r[k + '_sort'] !== undefined ? r[k + '_sort'] : isValidElement(r[k]) ? '' : r[k]);

/** Sortable, searchable, filterable, paginated table with CSV export. Used for every list in the app. */
export function DataTable({ columns, rows, pageSize = 25, exportName, empty = 'Nothing here yet.', search = true }: { columns: Column[]; rows: Row[]; pageSize?: number; exportName?: string; empty?: ReactNode; search?: boolean }) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null); const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterCols = columns.filter(c => c.filter);
  const view = useMemo(() => {
    let out = rows;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter(r => columns.some(c => String(raw(r, c.key) ?? '').toLowerCase().includes(needle)));
    for (const [k, v] of Object.entries(filters)) if (v) out = out.filter(r => String(raw(r, k) ?? '') === v);
    if (sort) { const c = columns.find(c => c.key === sort.key); const num = c?.type === 'money' || c?.type === 'number';
      out = [...out].sort((a, b) => { const x = raw(a, sort.key), y = raw(b, sort.key); return (num ? Number(x || 0) - Number(y || 0) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * sort.dir; }); }
    return out;
  }, [rows, q, sort, filters, columns]);
  const pages = Math.max(1, Math.ceil(view.length / pageSize)); const p = Math.min(page, pages - 1);
  const shown = view.slice(p * pageSize, (p + 1) * pageSize);
  const exportCsv = () => {
    const cols = columns.filter(c => c.key !== 'actions'); const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map(c => esc(c.label)).join(','), ...view.map(r => cols.map(c => esc(raw(r, c.key))).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${exportName ?? 'export'}.csv`; a.click();
  };
  const cell = (c: Column, r: Row) => {
    const v = r[c.key]; if (isValidElement(v)) return v; if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
    const body = c.type === 'money' ? fmtMoney(v) : c.type === 'date' ? fmtDate(String(v)) : c.type === 'badge' ? <Badge>{String(v)}</Badge> : String(v);
    return c.link && r[c.link] ? <Link href={r[c.link]} className="link font-medium">{body}</Link> : body;
  };
  const right = (c: Column) => (c.type === 'money' || c.type === 'number' ? 'text-right' : '');
  return (
    <div>
      {(search || filterCols.length > 0 || exportName) && rows.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {search && <input className="input max-w-56" placeholder="Search this list" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} aria-label="Search this list" />}
          {filterCols.map(c => (
            <select key={c.key} className="input w-auto" value={filters[c.key] ?? ''} onChange={e => { setFilters({ ...filters, [c.key]: e.target.value }); setPage(0); }} aria-label={`Filter by ${c.label}`}>
              <option value="">All {c.label.toLowerCase()}</option>
              {[...new Set(rows.map(r => String(raw(r, c.key) ?? '')).filter(Boolean))].sort().map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
            </select>
          ))}
          <span className="ml-auto text-xs text-muted">{view.length} {view.length === 1 ? 'row' : 'rows'}</span>
          {exportName && <button type="button" className="btn btn-sm" onClick={exportCsv}>Export CSV</button>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr className="border-b border-line bg-slate-50">
            {columns.map(c => <th key={c.key} className={`th ${right(c)}`}>
              {c.key === 'actions' || c.sortable === false ? c.label : <button type="button" className="cursor-pointer hover:text-ink" onClick={() => setSort(s => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>}
            </th>)}
          </tr></thead>
          <tbody>
            {shown.map((r, i) => <tr key={r.id ?? i} className="border-b border-line last:border-0 hover:bg-slate-50/60">{columns.map(c => <td key={c.key} className={`td ${right(c)} ${c.className ?? ''}`}>{cell(c, r)}</td>)}</tr>)}
          </tbody>
          {columns.some(c => c.total) && view.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              {columns.map((c, i) => <td key={c.key} className={`td ${right(c)}`}>{c.total ? fmtMoney(view.reduce((a, r) => a + Number(raw(r, c.key) || 0), 0).toFixed(2)) : i === 0 ? 'Total' : ''}</td>)}
            </tr></tfoot>
          )}
        </table>
      </div>
      {view.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">{rows.length ? 'No rows match your search or filters.' : empty}</div>}
      {pages > 1 && (
        <div className="no-print flex items-center justify-end gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <button type="button" className="btn btn-sm" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</button>
          <span>Page {p + 1} of {pages}</span>
          <button type="button" className="btn btn-sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
