import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Standard PDF fonts only cover Latin-1; fold anything else to its closest plain form so generation never fails. */
export function safe(s: unknown): string {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, ch => {
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return /^[\x20-\x7E]+$/.test(base) ? base : ({ 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L' } as Record<string, string>)[ch] ?? '?';
  });
}
export const IN = 72;
type TextOpts = { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; maxWidth?: number; color?: [number, number, number]; font?: PDFFont };

/** Thin wrapper over pdf-lib that measures from the top-left corner in points, like a printed page. */
export class Sheet {
  page!: PDFPage; pages: PDFPage[] = [];
  private constructor(public pdf: PDFDocument, public font: PDFFont, public bold: PDFFont, public w: number, public h: number) {}
  static async create(landscape = false) {
    const pdf = await PDFDocument.create();
    const s = new Sheet(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), landscape ? 792 : 612, landscape ? 612 : 792);
    s.addPage(); return s;
  }
  addPage() { this.page = this.pdf.addPage([this.w, this.h]); this.pages.push(this.page); return this.page; }
  fit(text: string, font: PDFFont, size: number, max: number) {
    let t = safe(text); if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > max) t = t.slice(0, -1);
    return t + '…';
  }
  wrap(text: string, size: number, max: number, bold = false): string[] {
    const font = bold ? this.bold : this.font; const out: string[] = [];
    for (const para of String(text ?? '').split(/\r?\n/)) {
      let line = '';
      for (const word of safe(para).split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(next, size) > max && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(x: number, yTop: number, text: unknown, o: TextOpts = {}) {
    const size = o.size ?? 10, font = o.font ?? (o.bold ? this.bold : this.font);
    const t = o.maxWidth ? this.fit(String(text ?? ''), font, size, o.maxWidth) : (o.font ? String(text ?? '') : safe(text));
    const wd = font.widthOfTextAtSize(t, size);
    const px = o.align === 'right' ? x - wd : o.align === 'center' ? x - wd / 2 : x;
    this.page.drawText(t, { x: px, y: this.h - yTop - size * 0.75, size, font, color: rgb(...(o.color ?? [0.1, 0.12, 0.16])) });
    return wd;
  }
  line(x1: number, y1: number, x2: number, y2: number, thickness = 0.5, color: [number, number, number] = [0.75, 0.78, 0.82]) {
    this.page.drawLine({ start: { x: x1, y: this.h - y1 }, end: { x: x2, y: this.h - y2 }, thickness, color: rgb(...color) });
  }
  rect(x: number, yTop: number, w: number, h: number, color: [number, number, number]) {
    this.page.drawRectangle({ x, y: this.h - yTop - h, width: w, height: h, color: rgb(...color) });
  }
  async image(bytes: Uint8Array, mime: string, x: number, yTop: number, maxW: number, maxH: number) {
    const img = mime.includes('png') ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes);
    const k = Math.min(maxW / img.width, maxH / img.height, 1); const w = img.width * k, h = img.height * k;
    this.page.drawImage(img, { x, y: this.h - yTop - h, width: w, height: h }); return { w, h };
  }
  numberPages(left = '') {
    this.pages.forEach((p, i) => { this.page = p; this.text(this.w - 36, this.h - 26, `Page ${i + 1} of ${this.pages.length}`, { size: 8, align: 'right', color: [0.45, 0.48, 0.52] }); if (left) this.text(36, this.h - 26, left, { size: 8, color: [0.45, 0.48, 0.52] }); });
  }
  save() { return this.pdf.save(); }
}
