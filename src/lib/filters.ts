import type { Filters } from '@/services/reports';
export function filtersFrom(get: (k: string) => string | null | undefined): Filters {
  const d = (k: string) => { const v = get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
  const g = get('granularity');
  return { from: d('from'), to: d('to'), projectId: Number(get('project')) || undefined, basis: get('basis') === 'cash' ? 'cash' : 'accrual', granularity: g === 'month' || g === 'quarter' || g === 'year' ? g : undefined };
}

export const PERIODS = [['ytd', 'This year'], ['month', 'This month'], ['quarter', 'This quarter'], ['last-year', 'Last year'], ['all', 'All time'], ['custom', 'Custom range']] as const;
/** Turn a preset (or custom dates) into a concrete from/to range. */
export function resolvePeriod(period: string | undefined, from?: string, to?: string): { period: string; from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth(); const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (period === 'custom' || (!period && (ok(from) || ok(to)))) return { period: 'custom', from: ok(from) ? from! : `${y}-01-01`, to: ok(to) ? to! : iso(now) };
  switch (period) {
    case 'month': return { period, from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { period, from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
    case 'last-year': return { period, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'all': return { period, from: '2000-01-01', to: `${y + 1}-12-31` };
    default: return { period: 'ytd', from: `${y}-01-01`, to: `${y}-12-31` };
  }
}
