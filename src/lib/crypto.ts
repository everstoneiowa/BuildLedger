import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let key: Buffer | null = null;
function getKey(): Buffer {
  if (key) return key;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) throw new Error('APP_SECRET must be set in production');
    // Local/dev convenience: generate and persist a secret next to the embedded database.
    const f = path.join(process.cwd(), '.data', 'secret.key');
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
    secret = fs.readFileSync(f, 'utf8').trim();
  }
  key = crypto.createHash('sha256').update(secret).digest();
  return key;
}
/** AES-256-GCM. Used for bank account/routing numbers and vendor tax IDs. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
export const last4 = (s: string) => s.replace(/\D/g, '').slice(-4);
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$'); if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('hex');
