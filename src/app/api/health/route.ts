import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
export const dynamic = 'force-dynamic';
// Used by the host to confirm the app and its database are up. Reveals nothing else.
export async function GET() {
  try { await (await getDb()).execute(sql`SELECT 1`); return Response.json({ ok: true }); }
  catch { return Response.json({ ok: false }, { status: 503 }); }
}
