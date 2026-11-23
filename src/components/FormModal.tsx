'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Result } from '@/lib/action';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={`m-auto w-[calc(100vw-1.5rem)] ${wide ? 'max-w-4xl' : 'max-w-xl'} rounded-lg border border-line bg-white p-0 text-left text-ink shadow-xl backdrop:bg-navy-950/50`}>
      {open && <>
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} className="cursor-pointer text-xl leading-none text-muted hover:text-ink" aria-label="Close">×</button></div>
        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">{children}</div>
      </>}
    </dialog>
  );
}
export type FieldDef = { name: string; label: string; type?: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'checkbox' | 'email' | 'tel' | 'password'; options?: { value: string | number; label: string }[]; required?: boolean; placeholder?: string; help?: string; full?: boolean; step?: string };

export function Fields({ fields, initial }: { fields: FieldDef[]; initial?: Record<string, any> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map(f => {
        const v = initial?.[f.name] ?? ''; const id = `f-${f.name}`;
        const wide = f.full || f.type === 'textarea' ? 'sm:col-span-2' : '';
        if (f.type === 'checkbox') return <label key={f.name} className={`flex items-start gap-2 text-sm ${wide}`}><input type="checkbox" name={f.name} defaultChecked={!!v} className="mt-0.5" /><span>{f.label}{f.help && <span className="block text-xs text-muted">{f.help}</span>}</span></label>;
        return (
          <div key={f.name} className={wide}>
            <label htmlFor={id} className="label">{f.label}{f.required && ' *'}</label>
            {f.type === 'textarea' ? <textarea id={id} name={f.name} defaultValue={v} rows={3} className="input" placeholder={f.placeholder} />
              : f.type === 'select' ? <select id={id} name={f.name} defaultValue={String(v)} required={f.required} className="input"><option value="">{f.placeholder ?? '— Select —'}</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input id={id} name={f.name} defaultValue={v} required={f.required} placeholder={f.placeholder} className="input" type={f.type === 'money' ? 'text' : f.type ?? 'text'} inputMode={f.type === 'money' ? 'decimal' : undefined} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} />}
            {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
/** A button that opens a form in a dialog and submits it to a server action. */
export function FormModal({ title, trigger, variant = '', fields, action, initial, hidden, submitLabel = 'Save', note, go }: { title: string; trigger: ReactNode; variant?: string; fields: FieldDef[]; action: (fd: FormData) => Promise<Result>; initial?: Record<string, any>; hidden?: Record<string, string | number | null | undefined>; submitLabel?: string; note?: ReactNode; go?: string }) {
  const [open, setOpen] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await action(new FormData(e.currentTarget)); setBusy(false);
    if (r?.error) return setErr(r.error);
    setOpen(false); if (go && r?.id) router.push(`${go}/${r.id}`); router.refresh();
  }
  return (<>
    <button type="button" className={`btn ${variant}`} onClick={() => { setErr(''); setOpen(true); }}>{trigger}</button>
    <Modal open={open} onClose={() => setOpen(false)} title={title}>
      <form onSubmit={submit}>
        {Object.entries(hidden ?? {}).map(([k, v]) => v !== null && v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
        {note && <div className="mb-3 rounded-md bg-slate-50 p-3 text-xs text-muted">{note}</div>}
        <Fields fields={fields} initial={initial} />
        {err && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
      </form>
    </Modal>
  </>);
}
/** A button that runs a server action after confirmation; optionally asks for a reason. */
export function ActionButton({ action, label, confirm, reason, variant = '', done }: { action: (reason: string) => Promise<Result>; label: ReactNode; confirm?: string; reason?: string; variant?: string; done?: string }) {
  const [busy, setBusy] = useState(false); const router = useRouter();
  async function go() {
    let why = '';
    if (reason) { const r = window.prompt(reason); if (r === null) return; if (!r.trim()) return alert('A reason is required.'); why = r.trim(); }
    else if (confirm && !window.confirm(confirm)) return;
    setBusy(true); const r = await action(why); setBusy(false);
    if (r?.error) return alert(r.error);
    if (done) router.push(done); router.refresh();
  }
  return <button type="button" className={`btn ${variant}`} disabled={busy} onClick={go}>{busy ? 'Working…' : label}</button>;
}
