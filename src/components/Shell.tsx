'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { LayoutDashboard, Hammer, BookOpen, Truck, Users, FileText, PenLine, Receipt, Car, FolderOpen, BarChart3, Settings, Menu, Search, LogOut } from 'lucide-react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard }, { href: '/projects', label: 'Projects', icon: Hammer }, { href: '/ledger', label: 'Transactions / Ledger', icon: BookOpen, perm: 'ledger' },
  { href: '/vendors', label: 'Vendors', icon: Truck }, { href: '/clients', label: 'Clients', icon: Users }, { href: '/invoices', label: 'Invoices & Bills', icon: FileText },
  { href: '/checks', label: 'Checks', icon: PenLine, perm: 'checks' }, { href: '/expenses', label: 'Business Expenses', icon: Receipt }, { href: '/mileage', label: 'Mileage', icon: Car },
  { href: '/documents', label: 'Documents', icon: FolderOpen }, { href: '/reports', label: 'Reports & Analytics', icon: BarChart3, perm: 'reports' }, { href: '/settings', label: 'Settings', icon: Settings, perm: 'settings' },
];
export function Shell({ children, company, userName, role, allowed, logout }: { children: ReactNode; company: string; userName: string; role: string; allowed: string[]; logout: () => Promise<void> }) {
  const path = usePathname(); const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className={`no-print fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy-900 text-slate-300 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-white/10 px-5 py-4"><div className="text-[15px] font-semibold leading-tight text-white">{company}</div><div className="mt-0.5 text-xs text-slate-400">Job costing &amp; accounting</div></div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.filter(n => !n.perm || allowed.includes(n.perm)).map(n => { const I = n.icon; const on = active(n.href);
            return <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={on ? 'page' : undefined} className={`mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${on ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'}`}><I size={16} strokeWidth={1.75} className={on ? 'text-emerald-300' : 'text-slate-400'} />{n.label}</Link>; })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-xs"><div className="font-medium text-white">{userName}</div><div className="capitalize text-slate-400">{role === 'pm' ? 'Project manager' : role}</div>
          <form action={logout}><button className="mt-2 flex cursor-pointer items-center gap-1.5 text-slate-300 hover:text-white"><LogOut size={13} />Sign out</button></form></div>
      </aside>
      {open && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} />}
      <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur">
        <button className="btn btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
        <form action="/search" className="relative max-w-xl flex-1"><Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" /><input name="q" className="input pl-8" placeholder="Search vendors, projects, invoice or check numbers, addresses, documents" aria-label="Search everything" /></form>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
