import { revalidatePath } from 'next/cache';
import type { Ctx } from '@/db';
import { session } from './auth';
import { can, type SessionUser } from './perm';

export type Result = { ok?: boolean; error?: string; id?: number; data?: any };
/** Wraps every server action: authenticate, authorise, run, refresh the UI, and turn exceptions into readable messages. */
export async function run(perm: string, fn: (ctx: Ctx, user: SessionUser) => Promise<Partial<Result> | void>): Promise<Result> {
  try {
    const { user, ctx } = await session();
    if (!can(user, perm)) return { error: 'Your role does not allow this action.' };
    const r = await fn(ctx, user);
    revalidatePath('/', 'layout');
    return { ok: true, ...(r ?? {}) };
  } catch (e: any) {
    if (typeof e?.digest === 'string' && e.digest.startsWith('NEXT_REDIRECT')) throw e;
    const msg = String(e?.message ?? e);
    if (/immutable/.test(msg)) return { error: 'Posted accounting entries cannot be changed directly.' };
    if (/duplicate key|unique/i.test(msg)) return { error: 'That number or name is already in use.' };
    console.error(e); return { error: msg.length > 300 ? 'Something went wrong while saving. Nothing was changed.' : msg };
  }
}
export const F = (fd: FormData) => {
  const s = (k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
  return {
    s, req: (k: string, label: string) => { const v = s(k); if (!v) throw new Error(`${label} is required`); return v; },
    n: (k: string) => { const v = s(k); return v && /^\d+$/.test(v) ? Number(v) : null; },
    b: (k: string) => ['on', 'true', '1'].includes(String(fd.get(k) ?? '')),
    money: (k: string) => { const v = s(k)?.replace(/[$,\s]/g, '') ?? '0'; if (!/^-?\d*\.?\d*$/.test(v)) throw new Error(`"${fd.get(k)}" is not a valid amount`); return v || '0'; },
    json: <T,>(k: string) => JSON.parse(String(fd.get(k) ?? 'null')) as T,
  };
};
