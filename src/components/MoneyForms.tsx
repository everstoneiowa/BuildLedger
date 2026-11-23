'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from './FormModal';
import { saveInvoice, createCheckAction, postManualEntry, toggleReconAction } from '@/app/actions';
import { fmtMoney, fmtDate, today } from '@/lib/money';

type Opt = { id: number; name: string };
const Err = ({ msg }: { msg: string }) => (msg ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p> : null);

export function InvoiceForm({ label, variant, clients, projects, initial, defaults }: { label: string; variant?: string; clients: Opt[]; projects: (Opt & { clientId?: number | null })[]; initial?: any; defaults?: { paymentInstructions?: string | null; notes?: string | null; projectId?: number; clientId?: number | null } }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const i = initial ?? {};
  const [clientId, setClientId] = useState(String(i.clientId ?? defaults?.clientId ?? '')); const [projectId, setProjectId] = useState(String(i.projectId ?? defaults?.projectId ?? ''));
  const [date, setDate] = useState(i.date ?? today()); const [due, setDue] = useState(i.dueDate ?? ''); const [taxRate, setTaxRate] = useState(i.taxRate && Number(i.taxRate) ? String(Number(i.taxRate)) : '');
  const [notes, setNotes] = useState(i.notes ?? defaults?.notes ?? ''); const [pay, setPay] = useState(i.paymentInstructions ?? defaults?.paymentInstructions ?? '');
  const [lines, setLines] = useState<any[]>(i.lines?.length ? i.lines : [{ description: '', quantity: '1', unitPrice: '', taxable: false }]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const num = (v: any) => Number(String(v).replace(/[$,]/g, '')) || 0;
  const sub = lines.reduce((a, l) => a + num(l.quantity) * num(l.unitPrice), 0); const tax = lines.filter(l => l.taxable).reduce((a, l) => a + num(l.quantity) * num(l.unitPrice), 0) * num(taxRate) / 100;
  const set = (n: number, patch: any) => setLines(ls => ls.map((l, k) => (k === n ? { ...l, ...patch } : l)));
  async function submit() {
    setBusy(true); setErr('');
    const r = await saveInvoice({ id: i.id, clientId: Number(clientId), projectId: Number(projectId) || null, date, dueDate: due || null, taxRate: taxRate || '0', notes, paymentInstructions: pay, lines: lines.map(l => ({ ...l, unitPrice: String(l.unitPrice).replace(/[$,\s]/g, '') || '0' })) });
    setBusy(false); if (r.error) return setErr(r.error); setOpen(false); if (!i.id && r.id) router.push(`/invoices/${r.id}`); router.refresh();
  }
  return (<>
    <button type="button" className={`btn ${variant ?? ''}`} onClick={() => setOpen(true)}>{label}</button>
    <Modal open={open} onClose={() => setOpen(false)} title={i.id ? `Edit invoice ${i.number}` : 'New invoice to a client'} wide>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="label">Client *</label><select className="input" value={clientId} onChange={e => setClientId(e.target.value)}><option value="">— Select —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Project</label><select className="input" value={projectId} onChange={e => { setProjectId(e.target.value); const pr = projects.find(x => String(x.id) === e.target.value); if (pr?.clientId && !clientId) setClientId(String(pr.clientId)); }}><option value="">— None —</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className="label">Invoice date *</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label className="label">Due date</label><input type="date" className="input" value={due} onChange={e => setDue(e.target.value)} /></div>
        <div><label className="label">Sales tax rate %</label><input className="input" inputMode="decimal" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="0" /></div>
        <div className="self-end text-xs text-muted">{i.id ? '' : 'The invoice number is assigned automatically, in sequence.'}</div>
        <div className="sm:col-span-4"><label className="label">Line items *</label>
          {lines.map((l, n) => <div key={n} className="mb-1.5 grid grid-cols-12 gap-1.5">
            <input className="input col-span-12 sm:col-span-6" placeholder="Description" value={l.description} onChange={e => set(n, { description: e.target.value })} />
            <input className="input col-span-3 text-right sm:col-span-1" inputMode="decimal" value={l.quantity} onChange={e => set(n, { quantity: e.target.value })} aria-label="Quantity" />
            <input className="input col-span-4 text-right sm:col-span-2" inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={e => set(n, { unitPrice: e.target.value })} />
            <label className="col-span-3 flex items-center gap-1 text-xs sm:col-span-2"><input type="checkbox" checked={!!l.taxable} onChange={e => set(n, { taxable: e.target.checked })} />Taxable</label>
            <button type="button" className="btn btn-sm col-span-2 sm:col-span-1" onClick={() => setLines(ls => (ls.length > 1 ? ls.filter((_, k) => k !== n) : ls))} aria-label="Remove line">×</button></div>)}
          <div className="flex items-start justify-between"><button type="button" className="link text-xs" onClick={() => setLines(ls => [...ls, { description: '', quantity: '1', unitPrice: '', taxable: false }])}>+ Add line</button>
            <div className="text-right text-sm"><div>Subtotal {fmtMoney(sub.toFixed(2))}</div>{tax > 0 && <div>Tax {fmtMoney(tax.toFixed(2))}</div>}<div className="font-semibold">Total {fmtMoney((sub + tax).toFixed(2))}</div></div></div></div>
        <div className="sm:col-span-2"><label className="label">Payment instructions</label><textarea className="input" rows={3} value={pay} onChange={e => setPay(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>
      <Err msg={err} />
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : i.id ? 'Save changes' : 'Create invoice'}</button></div>
    </Modal>
  </>);
}

export type OpenBill = { id: number; vendorId: number; vendor: string; ref: string; date: string; projectId: number | null; project: string; open: string; address: string | null };
export function CheckForm({ label, variant, banks, bills, presetBillId, projectId }: { label: string; variant?: string; banks: { id: number; name: string; next: number }[]; bills: OpenBill[]; presetBillId?: number; projectId?: number }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const preset = bills.find(b => b.id === presetBillId);
  const [bank, setBank] = useState(String(banks[0]?.id ?? '')); const [vendor, setVendor] = useState(String(preset?.vendorId ?? '')); const [date, setDate] = useState(today());
  const [number, setNumber] = useState(''); const [memo, setMemo] = useState(''); const [picked, setPicked] = useState<Record<number, string>>(preset ? { [preset.id]: preset.open } : {});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const scope = projectId ? bills.filter(b => b.projectId === projectId) : bills;
  const vendors = useMemo(() => [...new Map(scope.map(b => [b.vendorId, b.vendor])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [scope]);
  const mine = scope.filter(b => String(b.vendorId) === vendor); const total = Object.values(picked).reduce((a, v) => a + (Number(v) || 0), 0); const next = banks.find(b => String(b.id) === bank)?.next;
  async function submit() {
    setBusy(true); setErr('');
    const r = await createCheckAction({ bankAccountId: Number(bank), number: Number(number) || null, date, memo, projectId: projectId ?? null, apps: Object.entries(picked).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ billId: Number(k), amount: String(v) })) });
    setBusy(false); if (r.error) return setErr(r.error); setOpen(false); router.push(`/checks/${r.id}`); router.refresh();
  }
  return (<>
    <button type="button" className={`btn ${variant ?? ''}`} onClick={() => setOpen(true)}>{label}</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Write a check" wide>
      {!banks.length ? <p className="text-sm text-muted">Add a bank account in Settings first.</p> : !scope.length ? <p className="text-sm text-muted">There are no unpaid bills to pay. Enter the vendor’s bill first, then write the check against it — that keeps the expense, the payable and the check linked.</p> : <>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="label">Bank account</label><select className="input" value={bank} onChange={e => setBank(e.target.value)}>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label className="label">Check number</label><input className="input" inputMode="numeric" value={number} onChange={e => setNumber(e.target.value)} placeholder={next ? `${next} (next)` : ''} /></div>
          <div><label className="label">Check date</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Pay to</label><select className="input" value={vendor} onChange={e => { setVendor(e.target.value); setPicked({}); }}><option value="">— Vendor with unpaid bills —</option>{vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label">Memo</label><input className="input" value={memo} onChange={e => setMemo(e.target.value)} /></div>
        </div>
        {vendor && <table className="mt-3 w-full text-sm"><thead><tr className="border-b border-line"><th className="th">Pay</th><th className="th">Bill</th><th className="th">Date</th><th className="th">Project</th><th className="th text-right">Open balance</th><th className="th text-right">Amount on this check</th></tr></thead>
          <tbody>{mine.map(b => <tr key={b.id} className="border-b border-line"><td className="td"><input type="checkbox" checked={picked[b.id] !== undefined} onChange={e => setPicked(p => { const n = { ...p }; if (e.target.checked) n[b.id] = b.open; else delete n[b.id]; return n; })} aria-label={`Pay bill ${b.ref}`} /></td>
            <td className="td">{b.ref}</td><td className="td">{fmtDate(b.date)}</td><td className="td">{b.project}</td><td className="td text-right">{fmtMoney(b.open)}</td>
            <td className="td text-right">{picked[b.id] !== undefined && <input className="input ml-auto w-28 text-right" inputMode="decimal" value={picked[b.id]} onChange={e => setPicked(p => ({ ...p, [b.id]: e.target.value }))} />}</td></tr>)}</tbody></table>}
        <p className="mt-3 text-right text-sm font-semibold">Check total {fmtMoney(total.toFixed(2))}</p>
        <p className="text-right text-xs text-muted">Saved as a draft. Nothing posts to the books until you record it as issued.</p>
        <Err msg={err} />
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || total <= 0} onClick={submit}>{busy ? 'Saving…' : 'Create draft check'}</button></div></>}
    </Modal>
  </>);
}

export function JournalForm({ accounts, projects }: { accounts: Opt[]; projects: Opt[] }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [date, setDate] = useState(today()); const [memo, setMemo] = useState('');
  const blank = () => ({ accountId: 0, debit: '', credit: '', projectId: 0 }); const [lines, setLines] = useState([blank(), blank()]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (n: number, patch: any) => setLines(ls => ls.map((l, k) => (k === n ? { ...l, ...patch } : l)));
  const dr = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0), cr = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  async function submit() { setBusy(true); setErr(''); const r = await postManualEntry({ date, memo, lines }); setBusy(false); if (r.error) return setErr(r.error); setOpen(false); setLines([blank(), blank()]); setMemo(''); router.refresh(); }
  return (<>
    <button type="button" className="btn" onClick={() => setOpen(true)}>Manual journal entry</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Manual journal entry" wide>
      <p className="mb-3 text-xs text-muted">For things that are not bills, invoices or payments — owner draws, paying the credit card statement, loan proceeds, accountant’s adjustments. Debits must equal credits. Posted entries cannot be edited, only reversed.</p>
      <div className="grid gap-3 sm:grid-cols-4"><div><label className="label">Date</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div><div className="sm:col-span-3"><label className="label">Memo *</label><input className="input" value={memo} onChange={e => setMemo(e.target.value)} /></div></div>
      <div className="mt-3">{lines.map((l, n) => <div key={n} className="mb-1.5 grid grid-cols-12 gap-1.5">
        <select className="input col-span-12 sm:col-span-5" value={l.accountId} onChange={e => set(n, { accountId: Number(e.target.value) })} aria-label="Account"><option value={0}>— Account —</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="input col-span-6 sm:col-span-3" value={l.projectId} onChange={e => set(n, { projectId: Number(e.target.value) })} aria-label="Project"><option value={0}>No project</option>{projects.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input className="input col-span-3 text-right sm:col-span-2" placeholder="Debit" inputMode="decimal" value={l.debit} onChange={e => set(n, { debit: e.target.value, credit: '' })} />
        <input className="input col-span-3 text-right sm:col-span-2" placeholder="Credit" inputMode="decimal" value={l.credit} onChange={e => set(n, { credit: e.target.value, debit: '' })} /></div>)}
        <div className="flex justify-between text-sm"><button type="button" className="link text-xs" onClick={() => setLines(ls => [...ls, blank()])}>+ Add line</button><span className={dr === cr && dr > 0 ? 'text-emerald-700' : 'text-red-700'}>Debits {fmtMoney(dr.toFixed(2))} · Credits {fmtMoney(cr.toFixed(2))}</span></div></div>
      <Err msg={err} />
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || dr !== cr || dr === 0} onClick={submit}>Post entry</button></div>
    </Modal>
  </>);
}

export function ReconList({ reconId, items, locked }: { reconId: number; items: { id: number; date: string; memo: string | null; debit: string; credit: string; cleared: boolean; reference: string | null; method: string | null; party: string | null }[]; locked: boolean }) {
  const router = useRouter(); const [local, setLocal] = useState<Record<number, boolean>>({});
  // Tick immediately, then confirm with the server; roll back if it refuses.
  async function toggle(id: number, on: boolean) { setLocal(l => ({ ...l, [id]: on })); const r = await toggleReconAction(reconId, id, on); if (r.error) { alert(r.error); setLocal(l => ({ ...l, [id]: !on })); } router.refresh(); }
  return (
    <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-line bg-slate-50"><th className="th">Cleared</th><th className="th">Date</th><th className="th">Type</th><th className="th">Payee / source</th><th className="th text-right">Payment</th><th className="th text-right">Deposit</th></tr></thead>
      <tbody>{items.map(i => { const on = local[i.id] ?? i.cleared; return <tr key={i.id} className={`border-b border-line ${on ? 'bg-emerald-50/50' : ''}`}>
        <td className="td"><input type="checkbox" checked={on} disabled={locked} onChange={e => toggle(i.id, e.target.checked)} aria-label="Cleared the bank" className="h-4 w-4" /></td>
        <td className="td">{fmtDate(i.date)}</td><td className="td">{i.method === 'check' ? `Check #${i.reference}` : (i.method ?? 'Entry').toUpperCase()}</td><td className="td">{i.party ?? i.memo}</td>
        <td className="td text-right">{Number(i.credit) ? fmtMoney(i.credit) : ''}</td><td className="td text-right">{Number(i.debit) ? fmtMoney(i.debit) : ''}</td></tr>; })}</tbody></table>
      {!items.length && <p className="px-4 py-8 text-center text-sm text-muted">No uncleared transactions on or before the statement date.</p>}</div>
  );
}
