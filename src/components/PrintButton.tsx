'use client';
import { useRouter } from 'next/navigation';
/** Opens a generated PDF in a new tab, then refreshes this page so status and print counts update. */
export function OpenPdf({ href, label, variant = '', confirm }: { href: string; label: string; variant?: string; confirm?: string }) {
  const router = useRouter();
  return <button type="button" className={`btn ${variant}`} onClick={() => { if (confirm && !window.confirm(confirm)) return; window.open(href, '_blank'); setTimeout(() => router.refresh(), 1500); }}>{label}</button>;
}
export const PrintPage = () => <button type="button" className="btn" onClick={() => window.print()}>Print</button>;
