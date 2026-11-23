import { sql } from 'drizzle-orm';
import { one } from '@/db';
import { session, can } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import { logoutAction } from '../actions';
export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ctx } = await session();
  const co = await one<{ name: string }>(ctx.db, sql`SELECT name FROM companies WHERE id = ${ctx.companyId}`);
  const allowed = [can(user, 'ledger.read') && 'ledger', can(user, 'checks.read') && 'checks', can(user, 'reports.read') && 'reports', can(user, 'settings.admin') && 'settings'].filter(Boolean) as string[];
  return <Shell company={co?.name ?? 'BuildLedger'} userName={user.name} role={user.role} allowed={allowed} logout={logoutAction}>{children}</Shell>;
}
