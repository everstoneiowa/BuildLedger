import Decimal from 'decimal.js';
export { Decimal };
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v === null || v === undefined || v === '' ? 0 : v);
export const m2 = (v: Decimal.Value | null | undefined) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const sum = (vs: (Decimal.Value | null | undefined)[]) => vs.reduce<Decimal>((a, v) => a.plus(D(v)), D(0));
export const fmtMoney = (v: Decimal.Value | null | undefined, opts: { cents?: boolean; paren?: boolean } = {}) => {
  const d = D(v); const neg = d.isNegative() && !d.isZero();
  const s = Number(d.abs().toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: opts.cents === false ? 0 : 2 });
  return neg ? (opts.paren ? `($${s})` : `-$${s}`) : `$${s}`;
};
export const fmtDate = (s?: string | null) => { if (!s) return ''; const [y, mo, d] = s.slice(0, 10).split('-'); return `${mo}/${d}/${y}`; };
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
/** 1234.56 → "One Thousand Two Hundred Thirty-Four and 56/100" (the legal-amount line of a check). */
export function amountInWords(v: Decimal.Value): string {
  const d = D(v).toDecimalPlaces(2); const whole = d.floor(); const cents = d.minus(whole).times(100).toFixed(0).padStart(2, '0');
  let n = BigInt(whole.toFixed(0)); if (n === 0n) return `Zero and ${cents}/100`;
  const units = ['', ' Thousand', ' Million', ' Billion']; const out: string[] = [];
  for (let i = 0; n > 0n; i++, n /= 1000n) { const chunk = Number(n % 1000n); if (chunk) out.unshift(under1000(chunk) + units[i]); }
  return `${out.join(' ')} and ${cents}/100`;
}
