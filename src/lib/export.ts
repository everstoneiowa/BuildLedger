import ExcelJS from 'exceljs';
import type { Report, Col } from '@/services/reports';
import { Sheet } from './pdfkit';
import { fmtMoney, fmtDate, today, D } from './money';

const cell = (c: Col, v: any) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? fmtMoney(v, { paren: true }) : c.type === 'date' ? fmtDate(String(v)) : String(v));
const prepared = () => `Prepared ${fmtDate(today())}`;

/** Render any report to a paginated PDF with the company name, period, basis and preparation date on every page. */
export async function reportPdf(r: Report, company: string): Promise<Uint8Array> {
  const maxCols = Math.max(...r.sections.map(s => s.columns.length));
  const s = await Sheet.create(maxCols > 6); const M = 36, W = s.w - M * 2; let y = 0;
  const header = () => {
    s.text(M, 30, company, { size: 9, bold: true, color: [0.35, 0.4, 0.47] });
    s.text(s.w - M, 30, [r.period, r.basis, prepared()].filter(Boolean).join('  ·  '), { size: 8, align: 'right', color: [0.35, 0.4, 0.47] });
    s.text(M, 44, r.title, { size: 15, bold: true }); s.line(M, 68, s.w - M, 68, 1, [0.2, 0.25, 0.33]); y = 80;
  };
  const need = (h: number, redraw?: () => void) => { if (y + h > s.h - 44) { s.addPage(); header(); redraw?.(); } };
  header();
  for (const sec of r.sections) {
    const fixed = sec.columns.map(c => (c.type === 'money' ? 78 : c.type === 'number' ? 52 : c.width ? c.width * 5.4 : 0));
    const flexN = fixed.filter(f => !f).length; const flexW = Math.max(60, (W - fixed.reduce((a, b) => a + b, 0)) / Math.max(1, flexN));
    const widths = fixed.map(f => f || flexW); const scale = Math.min(1, W / widths.reduce((a, b) => a + b, 0));
    const xs: number[] = []; widths.reduce((x, w, i) => { xs[i] = x; return x + w * scale; }, M);
    const right = (c: Col) => c.type === 'money' || c.type === 'number';
    const drawRow = (vals: any[], o: { bold?: boolean; size?: number; raw?: boolean } = {}) => sec.columns.forEach((c, i) => {
      const w = widths[i] * scale - 6, t = o.raw ? String(vals[i] ?? '') : cell(c, vals[i]);
      if (t) s.text(right(c) ? xs[i] + w : xs[i], y, t, { size: o.size ?? 8.5, bold: o.bold, align: right(c) ? 'right' : 'left', maxWidth: w });
    });
    const head = () => { if (sec.columns.some(c => c.label)) { s.rect(M, y - 3, W, 15, [0.94, 0.95, 0.97]); drawRow(sec.columns.map(c => c.label), { bold: true, size: 8, raw: true }); y += 16; } };
    need(60);
    if (sec.heading) { s.text(M, y, sec.heading, { size: 11, bold: true }); y += 18; }
    if (sec.note) { s.text(M, y, sec.note, { size: 8.5, color: [0.35, 0.4, 0.47] }); y += 14; }
    head();
    if (!sec.rows.length) { s.text(M, y, 'No records for this period.', { size: 8.5, color: [0.5, 0.52, 0.56] }); y += 14; }
    for (const row of sec.rows) { need(14, head); drawRow(sec.columns.map(c => row[c.key])); y += 13; s.line(M, y - 2.5, s.w - M, y - 2.5, 0.25, [0.9, 0.91, 0.93]); }
    if (sec.totals) {
      need(18); s.line(M, y - 1, s.w - M, y - 1, 0.8, [0.2, 0.25, 0.33]); y += 3;
      const label = Object.entries(sec.totals).find(([k, v]) => v && !sec.columns.some(c => c.key === k && (c.type === 'money' || c.type === 'number')))?.[1];
      drawRow(sec.columns.map((c, i) => (sec.totals![c.key] ?? (i === 0 ? label : ''))), { bold: true }); y += 16;
    }
    y += 12;
  }
  for (const n of r.notes ?? []) for (const ln of s.wrap(n, 8, W)) { need(12); s.text(M, y, ln, { size: 8, color: [0.4, 0.43, 0.48] }); y += 11; }
  s.numberPages(`${company} — ${r.title}`);
  return s.save();
}

export async function reportXlsx(r: Report, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(r.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 12 }; ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([[r.period, r.basis, prepared()].filter(Boolean).join(' · ')]).font = { color: { argb: 'FF667085' } }; ws.addRow([]);
  const widths: number[] = [];
  for (const sec of r.sections) {
    if (sec.heading) ws.addRow([sec.heading]).font = { bold: true, size: 11 };
    if (sec.note) ws.addRow([sec.note]);
    const h = ws.addRow(sec.columns.map(c => c.label)); h.font = { bold: true }; h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } }; });
    const put = (vals: Record<string, any>, bold = false) => {
      const row = ws.addRow(sec.columns.map(c => { const v = vals[c.key]; if (v === '' || v === null || v === undefined) return null; return c.type === 'money' || c.type === 'number' ? Number(D(String(v).replace('%', '')).toString()) : c.type === 'date' ? fmtDate(String(v)) : v; }));
      sec.columns.forEach((c, i) => { const cl = row.getCell(i + 1); if (c.type === 'money') cl.numFmt = '$#,##0.00;[Red]($#,##0.00)'; if (bold) cl.font = { bold: true }; widths[i] = Math.max(widths[i] ?? 10, Math.min(48, String(vals[c.key] ?? c.label).length + 3)); });
    };
    sec.rows.forEach(rw => put(rw));
    if (sec.totals) { const t = { ...sec.totals }; const first = sec.columns[0].key; if (t[first] === undefined) t[first] = Object.values(sec.totals).find(v => typeof v === 'string' && isNaN(Number(v))) ?? 'Total'; put(t, true); }
    ws.addRow([]);
  }
  (r.notes ?? []).forEach(n => { ws.addRow([n]).font = { italic: true, color: { argb: 'FF667085' } }; });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const q = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function reportCsv(r: Report, company: string): string {
  const out: string[] = [q(company), q(r.title), q([r.period, r.basis, prepared()].filter(Boolean).join(' · ')), ''];
  for (const sec of r.sections) {
    if (sec.heading) out.push(q(sec.heading));
    out.push(sec.columns.map(c => q(c.label)).join(','));
    sec.rows.forEach(rw => out.push(sec.columns.map(c => q(c.type === 'date' ? fmtDate(rw[c.key]) : rw[c.key])).join(',')));
    if (sec.totals) out.push(sec.columns.map(c => q(sec.totals![c.key])).join(','));
    out.push('');
  }
  return out.join('\n');
}
