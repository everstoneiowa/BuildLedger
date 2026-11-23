import path from 'node:path';
import fs from 'node:fs';
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** Everything a service needs: a connection (or open transaction) and who is acting. */
export type Ctx = { db: DB; companyId: number; userId: number | null };

const g = globalThis as unknown as { __bl_db?: Promise<DB> };

// Posted journal entries can never be edited or deleted — corrections are new reversing entries.
const INTEGRITY_SQL = `
CREATE OR REPLACE FUNCTION bl_forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Posted accounting entries are immutable; post a reversal instead'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION bl_forbid_mutation();
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION bl_forbid_mutation();
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION bl_forbid_mutation();
ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS jl_one_sided;
ALTER TABLE journal_lines ADD CONSTRAINT jl_one_sided CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND (debit + credit) > 0);
`;

async function init(): Promise<DB> {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { Pool, types } = await import('pg');
    types.setTypeParser(1082, (v: string) => v); // DATE stays 'YYYY-MM-DD'
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    await pool.query(INTEGRITY_SQL);
    return db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  let dir = process.env.PGLITE_DIR;
  if (!dir) { dir = path.join(process.cwd(), '.data', 'db'); fs.mkdirSync(dir, { recursive: true }); }
  const client = dir === 'memory' ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  await client.exec(INTEGRITY_SQL);
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!g.__bl_db) g.__bl_db = init();
  return g.__bl_db;
}

/** Run a raw SQL query and return plain rows. Money and dates are cast to text in the SQL itself. */
export async function rows<T = Record<string, any>>(db: DB, query: SQL): Promise<T[]> {
  const res: any = await db.execute(query);
  return (res.rows ?? res) as T[];
}
export async function one<T = Record<string, any>>(db: DB, query: SQL): Promise<T | undefined> {
  return (await rows<T>(db, query))[0];
}
/** Run fn inside a database transaction; everything it does commits or rolls back together. */
export function inTx<T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(tx => fn({ ...ctx, db: tx as unknown as DB }));
}
export async function nextSeq(ctx: Ctx, key: string): Promise<number> {
  const r = await one<{ n: number }>(ctx.db, sql`
    INSERT INTO sequences (company_id, key, next) VALUES (${ctx.companyId}, ${key}, 2)
    ON CONFLICT (company_id, key) DO UPDATE SET next = sequences.next + 1 RETURNING next - 1 AS n`);
  return Number(r!.n);
}
export async function audit(ctx: Ctx, action: string, entityType: string, entityId: number | null, summary: string, data?: unknown) {
  await ctx.db.insert(schema.auditLog).values({ companyId: ctx.companyId, userId: ctx.userId, action, entityType, entityId, summary, data: data ?? null });
}
export { schema, sql };
