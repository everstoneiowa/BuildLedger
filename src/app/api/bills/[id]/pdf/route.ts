import { session, can } from '@/lib/auth';
import { paymentRequestPdf } from '@/lib/pdf';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, ctx } = await session(); const id = Number((await params).id);
  void user; void req;
  try { return new Response(Buffer.from(await paymentRequestPdf(ctx, id)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="payment-request-${id}.pdf"`, 'Cache-Control': 'no-store' } }); }
  catch (e: any) { return new Response(e.message, { status: 404 }); }
}
