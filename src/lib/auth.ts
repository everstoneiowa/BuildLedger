import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getDb, one, schema, type Ctx } from '@/db';
import { randomToken, sha256, verifyPassword } from './crypto';
import { can, type SessionUser } from './perm';

const COOKIE = 'bl_session';
export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value; if (!token) return null;
  const db = await getDb();
  const u = await one<any>(db, sql`SELECT u.id, u.company_id, u.name, u.email, u.role, u.can_print_checks FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now() AND u.active`);
  return u ? { id: u.id, companyId: u.company_id, name: u.name, email: u.email, role: u.role, canPrintChecks: u.can_print_checks } : null;
}
/** Use at the top of every page, route and action. Redirects to sign-in (or first-run setup) when there is no session. */
export async function session(): Promise<{ user: SessionUser; ctx: Ctx }> {
  const user = await getUser();
  if (!user) { const db = await getDb(); const any = await one(db, sql`SELECT 1 FROM users LIMIT 1`); redirect(any ? '/login' : '/setup'); }
  return { user: user!, ctx: { db: await getDb(), companyId: user!.companyId, userId: user!.id } };
}
export async function startSession(userId: number) {
  const db = await getDb(); const token = randomToken(); const expires = new Date(Date.now() + 14 * 864e5);
  await db.insert(schema.sessions).values({ userId, tokenHash: sha256(token), expiresAt: expires });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1', expires, path: '/' });
}
export async function signIn(email: string, password: string): Promise<boolean> {
  const db = await getDb();
  const u = await one<any>(db, sql`SELECT id, password_hash FROM users WHERE email = ${email.toLowerCase().trim()} AND active`);
  if (!u || !verifyPassword(password, u.password_hash)) return false;
  await startSession(u.id); return true;
}
export async function signOut() {
  const jar = await cookies(); const token = jar.get(COOKIE)?.value;
  if (token) { const db = await getDb(); await db.execute(sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`); }
  jar.delete(COOKIE);
}
export { can };
