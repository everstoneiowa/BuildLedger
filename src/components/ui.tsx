import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtMoney } from '@/lib/money';

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200', amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200', blue: 'bg-sky-50 text-sky-800 border-sky-200', gray: 'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_TONE: Record<string, string> = {
  paid: 'green', cleared: 'green', received: 'green', completed: 'green', approved: 'green', posted: 'green',
  partial: 'amber', printed: 'amber', requested: 'amber', pending: 'amber', closeout: 'amber', open: 'amber',
  issued: 'blue', active: 'blue', planning: 'blue',
  void: 'red', voided: 'red', rejected: 'red', overdue: 'red',
};
export const statusTone = (s: string) => STATUS_TONE[String(s).toLowerCase()] ?? 'gray';
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const t = tone ?? statusTone(String(children));
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${TONES[t] ?? TONES.gray}`}>{String(children).replace(/_/g, ' ')}</span>;
}
export function PageHeader({ title, subtitle, children, back }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link href={back.href} className="no-print mb-1 block text-xs text-muted hover:text-ink">‹ {back.label}</Link>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="no-print flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
export function Panel({ title, action, children, className = '', pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5"><h2 className="text-sm font-semibold">{title}</h2><div className="no-print flex items-center gap-2">{action}</div></div>}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}
export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'warn'; href?: string }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink';
  const body = (<><div className="text-xs font-medium text-muted">{label}</div><div className={`mt-1 text-xl font-semibold tracking-tight ${color}`}>{value}</div>{hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}</>);
  return href ? <Link href={href} className="panel block px-4 py-3 hover:border-slate-400">{body}</Link> : <div className="panel px-4 py-3">{body}</div>;
}
export const Money = ({ v, color }: { v: any; color?: boolean }) => <span className={color ? (Number(v) < 0 ? 'text-red-700' : 'text-emerald-700') : ''}>{fmtMoney(v)}</span>;
export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {items.map(i => <Link key={i.key} href={i.href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${i.key === current ? 'border-brand font-semibold text-brand-dark' : 'border-transparent text-muted hover:text-ink'}`}>{i.label}</Link>)}
    </nav>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-8 text-center text-sm text-muted">{children}</div>;
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm">{children || <span className="text-slate-400">—</span>}</dd></div>;
}
export const NoAccess = () => <div className="panel p-8 text-center text-sm text-muted">Your role does not have access to this area. Ask an owner or administrator if you need it.</div>;
