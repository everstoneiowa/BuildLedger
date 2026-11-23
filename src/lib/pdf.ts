import fontkit from '@pdf-lib/fontkit';
import { sql } from 'drizzle-orm';
import { type Ctx, one, rows } from '@/db';
import { Sheet, IN } from './pdfkit';
import { amountInWords, fmtMoney, fmtDate, D } from './money';
import { decrypt } from './crypto';
import { readDocument } from '@/services/documents';

/** Where the check sits on an 8.5×11 sheet (inches from the top edge) and where its two stubs go. */
export const CHECK_LAYOUTS: Record<string, { label: string; check: number; stubs: number[] }> = {
  top: { label: 'Check on top (most common voucher stock)', check: 0, stubs: [3.6, 7.2] },
  middle: { label: 'Check in middle', check: 3.5, stubs: [0.15, 7.2] },
  bottom: { label: 'Check on bottom', check: 7.5, stubs: [0.15, 3.8] },
};
type CheckData = { number: number | string; date: string; payee: string; address?: string | null; amount: string; memo?: string | null; project?: string | null; status?: string; items: { ref: string; date: string; description: string; amount: string }[] };
type BankData = { layout: string; stock: string; offset_x: string; offset_y: string; name: string; bank_name: string | null; bank_address: string | null; routing_enc: string | null; account_enc: string | null; micr_font_doc_id: number | null };

async function drawCheck(ctx: Ctx, s: Sheet, c: CheckData, bank: BankData, company: { name: string; address: string | null }, test: boolean) {
  const L = CHECK_LAYOUTS[bank.layout] ?? CHECK_LAYOUTS.top;
  const ox = Number(bank.offset_x) * IN, oy = Number(bank.offset_y) * IN;
  const X = (inch: number) => inch * IN + ox, Y = (inch: number) => (L.check + inch) * IN + oy;
  const amt = fmtMoney(c.amount).replace('$', '');
  if (test) { // alignment aids: the check outline and inch ticks, so a plain-paper print can be held against real stock
    for (const yy of [0, 3.5]) s.line(X(0) - ox, Y(yy), s.w, Y(yy), 0.4, [0.8, 0.3, 0.3]);
    for (let i = 0; i <= 8; i++) { s.line(i * IN, Y(0) - oy, i * IN, Y(0) - oy + 6, 0.4, [0.8, 0.3, 0.3]); s.text(i * IN + 2, Y(0) - oy + 7, `${i}"`, { size: 5, color: [0.8, 0.3, 0.3] }); }
    s.text(X(2.6), Y(0.2), 'ALIGNMENT TEST — NOT A VALID CHECK', { size: 9, bold: true, color: [0.8, 0.3, 0.3] });
  }
  if (bank.stock === 'blank') { // print what pre-printed stock would already carry
    s.text(X(0.4), Y(0.3), company.name, { size: 11, bold: true });
    (company.address ?? '').split(/\r?\n/).slice(0, 3).forEach((ln, i) => s.text(X(0.4), Y(0.3) + 14 + i * 10, ln, { size: 8 }));
    s.text(X(4.25), Y(0.3), bank.bank_name ?? '', { size: 9, bold: true, align: 'center' });
    (bank.bank_address ?? '').split(/\r?\n/).slice(0, 2).forEach((ln, i) => s.text(X(4.25), Y(0.3) + 12 + i * 9, ln, { size: 7, align: 'center' }));
    s.text(X(8.1), Y(0.3), String(c.number), { size: 12, bold: true, align: 'right' });
    s.text(X(6.3), Y(0.8), 'DATE', { size: 7 }); s.line(X(6.65), Y(0.93), X(8.1), Y(0.93));
    s.text(X(0.4), Y(1.18), 'PAY TO THE', { size: 6 }); s.text(X(0.4), Y(1.28), 'ORDER OF', { size: 6 }); s.line(X(1.0), Y(1.42), X(6.6), Y(1.42));
    s.text(X(6.75), Y(1.25), '$', { size: 11, bold: true }); s.line(X(6.9), Y(1.42), X(8.1), Y(1.42));
    s.line(X(0.4), Y(1.77), X(7.5), Y(1.77)); s.text(X(7.55), Y(1.66), 'DOLLARS', { size: 7 });
    s.text(X(0.4), Y(2.8), 'MEMO', { size: 7 }); s.line(X(0.8), Y(2.93), X(3.8), Y(2.93)); s.line(X(5.2), Y(2.93), X(8.1), Y(2.93));
    s.text(X(6.65), Y(2.97), 'AUTHORIZED SIGNATURE', { size: 6, align: 'center' });
  }
  s.text(X(6.9), Y(0.78), fmtDate(c.date), { size: 10.5 });
  s.text(X(1.05), Y(1.27), c.payee, { size: 11, maxWidth: 5.4 * IN });
  s.text(X(7.0), Y(1.27), `**${amt}`, { size: 11, bold: true });
  const words = amountInWords(c.amount); const size = 10; let filler = '';
  while (s.font.widthOfTextAtSize(`${words} ${filler}*`, size) < 6.9 * IN) filler += '*';
  s.text(X(0.45), Y(1.62), `${words} ${filler}`, { size });
  [c.payee, ...(c.address ?? '').split(/\r?\n/)].filter(Boolean).slice(0, 4).forEach((ln, i) => s.text(X(1.05), Y(1.95) + i * 11.5, ln, { size: 9.5 }));
  if (c.memo) s.text(X(0.85), Y(2.78), c.memo, { size: 9.5, maxWidth: 2.9 * IN });
  if (c.status === 'voided') s.text(X(4.25), Y(1.0), 'VOID', { size: 72, bold: true, align: 'center', color: [0.85, 0.2, 0.2] });

  // MICR line: only on blank stock, only when a MICR E-13B font has been uploaded by an administrator.
  if (bank.stock === 'blank' && bank.micr_font_doc_id && bank.routing_enc && bank.account_enc && !test) {
    const f = await readDocument(ctx, bank.micr_font_doc_id);
    if (f) {
      s.pdf.registerFontkit(fontkit); const micr = await s.pdf.embedFont(f.data);
      // Common E-13B font mapping: A = transit, C = on-us, D = dash.
      s.text(X(1.3), Y(3.12), `C${String(c.number).padStart(6, '0')}C A${decrypt(bank.routing_enc)}A ${decrypt(bank.account_enc)}C`, { size: 12, font: micr });
    }
  }
  // Voucher stubs: one for the payee, one for the company's file.
  for (const top of L.stubs) {
    const sy = (i: number) => (top + i) * IN + oy;
    s.text(X(0.45), sy(0.15), company.name, { size: 9, bold: true }); s.text(X(8.1), sy(0.15), `Check #${c.number}   ${fmtDate(c.date)}`, { size: 9, bold: true, align: 'right' });
    s.text(X(0.45), sy(0.37), `Pay to: ${c.payee}${c.project ? '     Project: ' + c.project : ''}`, { size: 9, maxWidth: 7.6 * IN });
    let y = sy(0.65);
    s.text(X(0.45), y, 'Invoice / reference', { size: 8, bold: true }); s.text(X(2.3), y, 'Date', { size: 8, bold: true }); s.text(X(3.2), y, 'Description', { size: 8, bold: true }); s.text(X(8.1), y, 'Amount', { size: 8, bold: true, align: 'right' });
    for (const it of c.items.slice(0, 10)) { y += 12; s.text(X(0.45), y, it.ref, { size: 8.5, maxWidth: 1.8 * IN }); s.text(X(2.3), y, fmtDate(it.date), { size: 8.5 }); s.text(X(3.2), y, it.description, { size: 8.5, maxWidth: 3.9 * IN }); s.text(X(8.1), y, fmtMoney(it.amount), { size: 8.5, align: 'right' }); }
    if (c.items.length > 10) { y += 12; s.text(X(0.45), y, `…and ${c.items.length - 10} more`, { size: 8.5 }); }
    y += 16; s.text(X(8.1), y, `Total  ${fmtMoney(c.amount)}`, { size: 9.5, bold: true, align: 'right' }); if (c.memo) s.text(X(0.45), y, `Memo: ${c.memo}`, { size: 8.5, maxWidth: 5 * IN });
  }
}
async function bankAndCompany(ctx: Ctx, bankAccountId: number) {
  const bank = await one<BankData>(ctx.db, sql`SELECT layout, stock, offset_x::text, offset_y::text, name, bank_name, bank_address, routing_enc, account_enc, micr_font_doc_id FROM bank_accounts WHERE id = ${bankAccountId} AND company_id = ${ctx.companyId}`);
  const company = await one<{ name: string; address: string | null }>(ctx.db, sql`SELECT name, address FROM companies WHERE id = ${ctx.companyId}`);
  if (!bank || !company) throw new Error('Bank account not found'); return { bank, company };
}
/** Letter-size PDF at exact physical dimensions. Print at 100% / "Actual size" — never "Fit to page". */
export async function checkPdf(ctx: Ctx, checkId: number): Promise<Uint8Array> {
  const c = await one<any>(ctx.db, sql`SELECT c.number, c.date::text date, c.payee, c.payee_address, c.amount::text amount, c.memo, c.status, c.bank_account_id, p.number || ' ' || p.name project FROM checks c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ${checkId} AND c.company_id = ${ctx.companyId}`);
  if (!c) throw new Error('Check not found');
  const items = await rows<any>(ctx.db, sql`SELECT coalesce(b.bill_no, b.internal_no, 'Bill #' || b.id) ref, b.date::text date, coalesce(b.description, '') description, ca.amount::text amount FROM check_apps ca JOIN bills b ON b.id = ca.bill_id WHERE ca.check_id = ${checkId} ORDER BY b.date`);
  const { bank, company } = await bankAndCompany(ctx, c.bank_account_id);
  const s = await Sheet.create(); s.pdf.setTitle(`Check ${c.number}`);
  await drawCheck(ctx, s, { ...c, address: c.payee_address, items }, bank, company, false);
  return s.save();
}
export async function checkTestPdf(ctx: Ctx, bankAccountId: number): Promise<Uint8Array> {
  const { bank, company } = await bankAndCompany(ctx, bankAccountId);
  const s = await Sheet.create();
  await drawCheck(ctx, s, { number: 'TEST', date: '2026-12-31', payee: 'Sample Payee Name LLC', address: '123 Alignment Way\nAnytown, ST 00000', amount: '1234.56', memo: 'Alignment test', items: [{ ref: 'INV-TEST', date: '2026-12-31', description: 'Sample line', amount: '1234.56' }] }, bank, company, true);
  return s.save();
}

type DocParty = { name: string; lines: (string | null | undefined)[] };
async function letterhead(ctx: Ctx, s: Sheet, title: string, meta: [string, string][]) {
  const co = await one<any>(ctx.db, sql`SELECT name, address, phone, email, logo_doc_id FROM companies WHERE id = ${ctx.companyId}`);
  let y = 40, x = 44;
  if (co.logo_doc_id) { const logo = await readDocument(ctx, co.logo_doc_id); if (logo && /png|jpe?g/.test(logo.mime)) { try { const d = await s.image(logo.data, logo.mime, 44, 36, 150, 64); y = 36 + d.h + 8; } catch { /* unreadable logo: fall back to text */ } } }
  s.text(x, y, co.name, { size: 13, bold: true }); y += 17;
  for (const ln of [...(co.address ?? '').split(/\r?\n/), co.phone, co.email].filter(Boolean)) { s.text(x, y, ln, { size: 9, color: [0.35, 0.4, 0.47] }); y += 11.5; }
  s.text(s.w - 44, 40, title, { size: 20, bold: true, align: 'right', color: [0.12, 0.2, 0.33] });
  meta.forEach(([k, v], i) => { s.text(s.w - 150, 72 + i * 13, k, { size: 9, align: 'right', color: [0.35, 0.4, 0.47] }); s.text(s.w - 44, 72 + i * 13, v, { size: 9, bold: true, align: 'right' }); });
  return { y: Math.max(y, 72 + meta.length * 13) + 18, company: co };
}
function party(s: Sheet, x: number, y: number, label: string, p: DocParty) {
  s.text(x, y, label, { size: 8, bold: true, color: [0.35, 0.4, 0.47] }); y += 13; s.text(x, y, p.name, { size: 10.5, bold: true }); y += 14;
  for (const ln of p.lines.flatMap(l => (l ?? '').split(/\r?\n/)).filter(Boolean)) { s.text(x, y, ln, { size: 9 }); y += 11.5; }
  return y;
}
function itemTable(s: Sheet, y: number, cols: { label: string; x: number; align?: 'right' }[], data: string[][]) {
  s.rect(44, y - 4, s.w - 88, 18, [0.12, 0.2, 0.33]);
  cols.forEach(c => s.text(c.x, y, c.label, { size: 8.5, bold: true, align: c.align, color: [1, 1, 1] })); y += 22;
  for (const r of data) {
    if (y > s.h - 150) { s.addPage(); y = 50; }
    const lines = s.wrap(r[0], 9.5, (cols[1]?.x ?? s.w - 44) - cols[0].x - 60);
    lines.forEach((ln, i) => s.text(cols[0].x, y + i * 12, ln, { size: 9.5 }));
    r.slice(1).forEach((v, i) => s.text(cols[i + 1].x, y, v, { size: 9.5, align: cols[i + 1].align }));
    y += lines.length * 12 + 6; s.line(44, y - 4, s.w - 44, y - 4, 0.3);
  }
  return y;
}

export async function invoicePdf(ctx: Ctx, id: number): Promise<Uint8Array> {
  const inv = await one<any>(ctx.db, sql`
    SELECT i.number, i.date::text date, i.due_date::text due, i.subtotal::text, i.tax_amount::text, i.tax_rate::text, i.total::text, i.amount_paid::text, i.notes, i.payment_instructions, i.status,
      c.name client, c.address client_address, c.email client_email, c.contact, p.number pnum, p.name pname, p.address paddr
    FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ${id} AND i.company_id = ${ctx.companyId}`);
  if (!inv) throw new Error('Invoice not found');
  const lines = await rows<any>(ctx.db, sql`SELECT description, quantity::text, unit_price::text, amount::text FROM invoice_lines WHERE invoice_id = ${id} ORDER BY id`);
  const s = await Sheet.create(); s.pdf.setTitle(`Invoice ${inv.number}`);
  const head = await letterhead(ctx, s, 'INVOICE', [['Invoice #', inv.number], ['Date', fmtDate(inv.date)], ...(inv.due ? [['Due', fmtDate(inv.due)] as [string, string]] : [])]);
  let y = party(s, 44, head.y, 'BILL TO', { name: inv.client, lines: [inv.contact, inv.client_address, inv.client_email] });
  if (inv.pname) y = Math.max(y, party(s, 330, head.y, 'PROJECT', { name: `${inv.pnum} — ${inv.pname}`, lines: [inv.paddr] }));
  y = itemTable(s, y + 14, [{ label: 'DESCRIPTION', x: 52 }, { label: 'QTY', x: 400, align: 'right' }, { label: 'UNIT PRICE', x: 480, align: 'right' }, { label: 'AMOUNT', x: s.w - 52, align: 'right' }],
    lines.map(l => [l.description, Number(l.quantity).toString(), fmtMoney(l.unit_price), fmtMoney(l.amount)]));
  const tot = (k: string, v: string, bold = false) => { s.text(480, y, k, { size: bold ? 11 : 9.5, bold, align: 'right' }); s.text(s.w - 52, y, v, { size: bold ? 11 : 9.5, bold, align: 'right' }); y += bold ? 18 : 14; };
  y += 6; tot('Subtotal', fmtMoney(inv.subtotal)); if (!D(inv.tax_amount).isZero()) tot(`Tax (${Number(inv.tax_rate)}%)`, fmtMoney(inv.tax_amount));
  tot('Total', fmtMoney(inv.total), true); if (!D(inv.amount_paid).isZero()) { tot('Payments received', fmtMoney(D(inv.amount_paid).neg(), { paren: true })); tot('Balance due', fmtMoney(D(inv.total).minus(inv.amount_paid)), true); }
  for (const [label, body] of [['PAYMENT INSTRUCTIONS', inv.payment_instructions ?? head.company.payment_instructions], ['NOTES', inv.notes]] as const) {
    if (!body) continue; y += 12; s.text(44, y, label, { size: 8, bold: true, color: [0.35, 0.4, 0.47] }); y += 13;
    for (const ln of s.wrap(body, 9.5, s.w - 88)) { s.text(44, y, ln, { size: 9.5 }); y += 12; }
  }
  if (inv.status === 'void') s.text(s.w / 2, 330, 'VOID', { size: 90, bold: true, align: 'center', color: [0.9, 0.75, 0.75] });
  return s.save();
}

/** Payment request the company prepares when a subcontractor has no invoice of their own. Clearly labelled as such. */
export async function paymentRequestPdf(ctx: Ctx, billId: number): Promise<Uint8Array> {
  const b = await one<any>(ctx.db, sql`
    SELECT b.internal_no, b.kind, b.date::text date, b.due_date::text due, b.total::text, b.description, b.notes, b.status, v.name vendor, v.address vaddr, v.phone vphone, v.email vemail, p.number pnum, p.name pname, p.address paddr, u.name preparer
    FROM bills b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN projects p ON p.id = b.project_id LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ${billId} AND b.company_id = ${ctx.companyId}`);
  if (!b || b.kind !== 'internal') throw new Error('Payment request not found');
  const lines = await rows<any>(ctx.db, sql`SELECT coalesce(bl.description, c.name) description, c.name category, bl.amount::text FROM bill_lines bl JOIN categories c ON c.id = bl.category_id WHERE bl.bill_id = ${billId} ORDER BY bl.id`);
  const s = await Sheet.create(); s.pdf.setTitle(`Payment request ${b.internal_no}`);
  const head = await letterhead(ctx, s, 'PAYMENT REQUEST', [['Request #', b.internal_no], ['Date', fmtDate(b.date)], ...(b.due ? [['Pay by', fmtDate(b.due)] as [string, string]] : [])]);
  let y = head.y; s.rect(44, y - 6, s.w - 88, 34, [1, 0.96, 0.86]);
  s.text(52, y, 'INTERNALLY PREPARED DOCUMENT', { size: 9, bold: true, color: [0.55, 0.35, 0.05] });
  s.text(52, y + 12, `Prepared by ${head.company.name} on behalf of the payee for record-keeping. This is not an invoice issued by the payee.`, { size: 8.5, color: [0.55, 0.35, 0.05], maxWidth: s.w - 104 });
  y += 44; const y0 = y; y = party(s, 44, y0, 'PAYEE (VENDOR / SUBCONTRACTOR)', { name: b.vendor, lines: [b.vaddr, b.vphone, b.vemail] });
  if (b.pname) y = Math.max(y, party(s, 330, y0, 'PROJECT', { name: `${b.pnum} — ${b.pname}`, lines: [b.paddr] }));
  y = itemTable(s, y + 14, [{ label: 'WORK PERFORMED / DESCRIPTION', x: 52 }, { label: 'CATEGORY', x: 360 }, { label: 'AMOUNT', x: s.w - 52, align: 'right' }], lines.map(l => [l.description, l.category, fmtMoney(l.amount)]));
  y += 6; s.text(480, y, 'Total requested', { size: 11, bold: true, align: 'right' }); s.text(s.w - 52, y, fmtMoney(b.total), { size: 11, bold: true, align: 'right' }); y += 30;
  if (b.notes) for (const ln of s.wrap(b.notes, 9.5, s.w - 88)) { s.text(44, y, ln, { size: 9.5 }); y += 12; }
  y += 30; s.line(44, y, 260, y); s.line(330, y, 546, y); s.text(44, y + 4, 'Payee acknowledgment (signature / date)', { size: 8 }); s.text(330, y + 4, `Prepared by ${b.preparer ?? ''}`, { size: 8 });
  if (b.status === 'void') s.text(s.w / 2, 330, 'VOID', { size: 90, bold: true, align: 'center', color: [0.9, 0.75, 0.75] });
  return s.save();
}
