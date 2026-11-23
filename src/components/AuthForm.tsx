'use client';
import { useState } from 'react';
import type { Result } from '@/lib/action';
export function AuthForm({ action, fields, submit }: { action: (fd: FormData) => Promise<Result>; fields: { name: string; label: string; type?: string; autoComplete?: string }[]; submit: string }) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setErr(''); const r = await action(new FormData(e.currentTarget)); setBusy(false); if (r?.error) setErr(r.error); }} className="space-y-3">
      {fields.map(f => <div key={f.name}><label htmlFor={f.name} className="label">{f.label}</label><input id={f.name} name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} required className="input" /></div>)}
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'One moment…' : submit}</button>
    </form>
  );
}
