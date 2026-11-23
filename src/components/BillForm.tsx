'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './FormModal';
import { UploadZone, type Uploaded } from './UploadZone';
import { saveBill } from '@/app/actions';
import { fmtMoney, fmtDate, today } from '@/lib/money';

type Opt = { id: number; name: string };
export type BillInitial = { id?: number; kind?: string; vendorId?: number | null; payee?: string | null; projectId?: number | null; billNo?: string | null; date?: string; dueDate?: string | null; taxAmount?: string; description?: string | null; notes?: string | null; lines?: { categoryId: number; description: string; amount: string }[] };
type Props = { label: string; variant?: string; vendors: Opt[]; projects: Opt[]; categories: (Opt & { kind: string })[]; accounts: Opt[]; fixedProjectId?: number | null; businessOnly?: boolean; initial?: BillInitial; aiEnabled?: boolean; canPay?: boolean };
const blank = () => ({ categoryId: 0, description: '', amount: '' });

/** One form for vendor bills, receipts, quick paid expenses, and internally prepared payment requests. */
export function BillForm(p: Props) {
  const router = useRouter(); const [open, setOpen] = useState(false); const i = p.initial ?? {};
  const [kind, setKind] = useState(i.kind ?? 'vendor'); const [vendor, setVendor] = useState(i.vendorId ? String(i.vendorId) : i.payee ? 'payee' : '');
  const [newVendor, setNewVendor] = useState(''); const [payee, setPayee] = useState(i.payee ?? '');
  const [projectId, setProjectId] = useState<string>(String(p.fixedProjectId ?? i.projectId ?? ''));
  const [billNo, setBillNo] = useState(i.billNo ?? ''); const [date, setDate] = useState(i.date ?? today()); const [due, setDue] = useState(i.dueDate ?? '');
  const [tax, setTax] = useState(i.taxAmount && Number(i.taxAmount) ? i.taxAmount : ''); const [desc, setDesc] = useState(i.description ?? ''); const [notes, setNotes] = useState(i.notes ?? '');
  const [lines, setLines] = useState(i.lines?.length ? i.lines : [blank()]); const [docs, setDocs] = useState<Uploaded[]>([]);
  const [paid, setPaid] = useState(false); const [acct, setAcct] = useState(''); const [method, setMethod] = useState('card'); const [ref, setRef] = useState('');
  const [err, setErr] = useState(''); const [dups, setDups] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false);
  const isProject = !p.businessOnly && projectId !== ''; const cats = p.categories.filter(c => c.kind === (isProject ? 'project' : 'overhead'));
  const total = lines.reduce((a, l) => a + (Number(String(l.amount).replace(/[$,]/g, '')) || 0), 0);
  const setLine = (n: number, patch: Partial<ReturnType<typeof blank>>) => setLines(ls => ls.map((l, k) => (k === n ? { ...l, ...patch } : l)));

  async function read(doc: Uploaded) {
    setReading(true); setErr('');
    const res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: doc.id }) }); const body = await res.json(); setReading(false);
    if (!res.ok) return setErr(body.error);
    const f = body.fields ?? {};
    if (f.invoiceNumber) setBillNo(String(f.invoiceNumber)); if (f.date) setDate(f.date); if (f.dueDate) setDue(f.dueDate); if (f.tax) setTax(String(f.tax));
    if (f.vendor) { const m = p.vendors.find(v => v.name.toLowerCase() === String(f.vendor).toLowerCase()); if (m) setVendor(String(m.id)); else { setVendor('new'); setNewVendor(String(f.vendor)); } }
    if (f.total) setLines([{ categoryId: lines[0]?.categoryId ?? 0, description: (f.lineItems ?? []).map((l: any) => l.description).filter(Boolean).join('; ').slice(0, 200), amount: String(f.total) }]);
  }
  async function submit(confirmDuplicate = false) {
    setBusy(true); setErr('');
    const r = await saveBill({
      id: i.id, kind: kind as any, vendorId: /^\d+$/.test(vendor) ? Number(vendor) : null, newVendorName: vendor === 'new' ? newVendor : null, payee: vendor === 'payee' ? payee : null,
      projectId: isProject ? Number(projectId) : null, billNo, date, dueDate: due || null, taxAmount: tax || '0', description: desc, notes,
      lines: lines.filter(l => l.amount !== '').map(l => ({ categoryId: Number(l.categoryId), description: l.description, amount: String(l.amount).replace(/[$,\s]/g, '') })),
      docIds: docs.map(d => d.id), payNow: paid && !i.id ? { accountId: Number(acct), method, reference: ref, date } : null, confirmDuplicate,
    });
    setBusy(false);
    if (r.error) return setErr(r.error);
    if (r.data?.duplicates) return setDups(r.data.duplicates);
    setOpen(false); setDups([]); if (!i.id) { setLines([blank()]); setDocs([]); setBillNo(''); setDesc(''); setTax(''); } router.refresh();
  }
  return (<>
    <button type="button" className={`btn ${p.variant ?? ''}`} onClick={() => setOpen(true)}>{p.label}</button>
    <Modal open={open} onClose={() => setOpen(false)} title={i.id ? 'Edit bill' : isProject ? 'Add project bill or expense' : 'Add business expense'} wide>
      <div className="grid gap-3 sm:grid-cols-6">
        {!i.id && <div className="sm:col-span-6">
          <UploadZone compact onUploaded={d => setDocs(x => [...x, ...d])} label="Attach the invoice or receipt (PDF or photo) — drop here, or" />
          {docs.map(d => <div key={d.id} className="mt-1 flex items-center gap-3 text-xs"><a className="link" href={`/api/files/${d.id}`} target="_blank">{d.name}</a>{p.aiEnabled && <button type="button" className="btn btn-sm" disabled={reading} onClick={() => read(d)}>{reading ? 'Reading…' : 'Fill in from this document'}</button>}</div>)}
          {docs.length > 0 && p.aiEnabled && <p className="mt-1 text-xs text-muted">Automatic reading only fills in the form. Check every value before saving.</p>}
        </div>}
        {!i.id && <div className="sm:col-span-6"><label className="label">Document type</label>
          <select className="input" value={kind} onChange={e => setKind(e.target.value)}><option value="vendor">Invoice or receipt from the vendor</option><option value="internal">Payment request we prepare — subcontractor gave no invoice</option></select>
          {kind === 'internal' && <p className="mt-1 text-xs text-amber-800">Gets its own PR- number and is labelled “internally prepared” everywhere, including the printable PDF.</p>}</div>}
        <div className="sm:col-span-3"><label className="label">Vendor / payee *</label>
          <select className="input" value={vendor} onChange={e => setVendor(e.target.value)}><option value="">— Select —</option>{p.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}<option value="new">+ New vendor…</option>{kind !== 'internal' && <option value="payee">One-time payee (no vendor profile)…</option>}</select>
          {vendor === 'new' && <input className="input mt-1" placeholder="New vendor name" value={newVendor} onChange={e => setNewVendor(e.target.value)} />}
          {vendor === 'payee' && <input className="input mt-1" placeholder="Payee name" value={payee} onChange={e => setPayee(e.target.value)} />}</div>
        {!p.businessOnly && <div className="sm:col-span-3"><label className="label">Project</label>
          <select className="input" value={projectId} disabled={!!p.fixedProjectId} onChange={e => { setProjectId(e.target.value); setLines(ls => ls.map(l => ({ ...l, categoryId: 0 }))); }}><option value="">General business (no project)</option>{p.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
        <div className="sm:col-span-2"><label className="label">Invoice / receipt #</label><input className="input" value={billNo} onChange={e => setBillNo(e.target.value)} disabled={kind === 'internal'} placeholder={kind === 'internal' ? 'Assigned automatically' : ''} /></div>
        <div className="sm:col-span-2"><label className="label">Date *</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Due date</label><input type="date" className="input" value={due} onChange={e => setDue(e.target.value)} /></div>
        <div className="sm:col-span-6"><label className="label">Description</label><input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What was this for?" /></div>
        <div className="sm:col-span-6">
          <label className="label">Cost lines *</label>
          {lines.map((l, n) => (
            <div key={n} className="mb-1.5 grid grid-cols-12 gap-1.5">
              <select className="input col-span-12 sm:col-span-4" value={l.categoryId} onChange={e => setLine(n, { categoryId: Number(e.target.value) })} aria-label="Category"><option value={0}>— Category —</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input className="input col-span-7 sm:col-span-5" placeholder="Line note (optional)" value={l.description} onChange={e => setLine(n, { description: e.target.value })} />
              <input className="input col-span-4 text-right sm:col-span-2" inputMode="decimal" placeholder="0.00" value={l.amount} onChange={e => setLine(n, { amount: e.target.value })} aria-label="Amount" />
              <button type="button" className="btn btn-sm col-span-1" onClick={() => setLines(ls => (ls.length > 1 ? ls.filter((_, k) => k !== n) : ls))} aria-label="Remove line">×</button>
            </div>
          ))}
          <div className="flex items-center justify-between"><button type="button" className="link text-xs" onClick={() => setLines(ls => [...ls, blank()])}>+ Split across another category</button><span className="text-sm font-semibold">Total {fmtMoney(total.toFixed(2))}</span></div>
        </div>
        <div className="sm:col-span-2"><label className="label">Sales tax included in total</label><input className="input" inputMode="decimal" value={tax} onChange={e => setTax(e.target.value)} placeholder="0.00" /></div>
        <div className="sm:col-span-4"><label className="label">Notes</label><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        {!i.id && p.canPay && <div className="rounded-md border border-line bg-slate-50 p-3 sm:col-span-6">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} />Already paid (card, cash, ACH…)</label>
          {!paid && <p className="mt-1 text-xs text-muted">Leave unchecked to save as an unpaid bill, then write a check or record the payment later.</p>}
          {paid && <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <select className="input" value={acct} onChange={e => setAcct(e.target.value)} aria-label="Paid from"><option value="">— Paid from —</option>{p.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <select className="input" value={method} onChange={e => setMethod(e.target.value)} aria-label="Method">{['card', 'ach', 'cash', 'wire', 'other'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select>
            <input className="input" placeholder="Reference (optional)" value={ref} onChange={e => setRef(e.target.value)} /></div>}
        </div>}
      </div>
      {dups.length > 0 && <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">This looks like it may already be entered:</p>
        <ul className="mt-1 list-disc pl-5">{dups.map(d => <li key={d.id}>{d.reason}: #{d.bill_no ?? d.id}, {fmtDate(d.date)}, {fmtMoney(d.total)}</li>)}</ul>
        <div className="mt-2 flex gap-2"><button type="button" className="btn btn-sm" onClick={() => submit(true)}>It’s different — save anyway</button><button type="button" className="btn btn-sm" onClick={() => setDups([])}>Go back</button></div></div>}
      {err && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {i.id && <p className="mt-3 text-xs text-muted">Saving posts a reversing entry and a corrected entry; the original stays in the audit trail.</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(false)}>{busy ? 'Saving…' : i.id ? 'Save changes' : paid ? 'Save as paid' : 'Save as unpaid bill'}</button></div>
    </Modal>
  </>);
}
