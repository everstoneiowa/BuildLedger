'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type Uploaded = { id: number; name: string; mime: string };
/** Drag-and-drop (or tap-to-choose, including phone camera) multi-file upload. */
export function UploadZone({ links = [], folder, versionOf, onUploaded, compact, label }: { links?: { type: string; id: number }[]; folder?: string; versionOf?: number; onUploaded?: (docs: Uploaded[]) => void; compact?: boolean; label?: string }) {
  const [over, setOver] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const input = useRef<HTMLInputElement>(null); const router = useRouter();
  async function send(files: FileList | File[]) {
    const list = Array.from(files); if (!list.length) return; setBusy(true); setErr('');
    const fd = new FormData(); list.forEach(f => fd.append('files', f)); fd.append('links', JSON.stringify(links)); if (folder) fd.append('folder', folder); if (versionOf) fd.append('versionOf', String(versionOf));
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd }); const body = await res.json();
      if (!res.ok) setErr(body.error ?? 'Upload failed'); else if (onUploaded) onUploaded(body.documents); else router.refresh();
    } catch { setErr('Upload failed. Check your connection and try again.'); }
    setBusy(false); if (input.current) input.current.value = '';
  }
  return (
    <div>
      <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        className={`rounded-md border border-dashed text-center text-sm ${compact ? 'px-3 py-2' : 'px-4 py-6'} ${over ? 'border-brand bg-brand-soft' : 'border-slate-300 bg-slate-50'}`}>
        <input ref={input} type="file" multiple={!versionOf} className="hidden" onChange={e => e.target.files && send(e.target.files)} accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt,.dwg,.eml,.msg,.zip,.ttf,.otf,image/*" />
        {busy ? <span className="text-muted">Uploading…</span> : <span className="text-muted">{label ?? 'Drop files here, or'} <button type="button" className="link font-medium" onClick={() => input.current?.click()}>choose files</button></span>}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}
