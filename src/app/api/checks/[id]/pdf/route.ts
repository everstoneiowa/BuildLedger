import { session, can } from '@/lib/auth';
import { checkPdf } from '@/lib/pdf';
import { markPrinted } from '@/services/payments';
const pdf = (b: Uint8Array, name: string) => new Response(Buffer.from(b), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' } });
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, ctx } = await session(); const id = Number((await params).id);
  if (!can(user, 'checks.print')) return new Response('You are not authorized to print checks.', { status: 403 });
  try {
    // ?preview=1 shows the layout without counting as a print; anything else is recorded in the audit trail.
    if (!new URL(req.url).searchParams.has('preview')) await markPrinted(ctx, id);
    return pdf(await checkPdf(ctx, id), `check-${id}.pdf`);
  } catch (e: any) { return new Response(e.message, { status: 400 }); }
}
