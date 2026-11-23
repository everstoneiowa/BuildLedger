import { session, can } from '@/lib/auth';
import { checkTestPdf } from '@/lib/pdf';
export async function GET(req: Request) {
  const { user, ctx } = await session();
  if (!can(user, 'checks.print')) return new Response('You are not authorized to print checks.', { status: 403 });
  try { return new Response(Buffer.from(await checkTestPdf(ctx, Number(new URL(req.url).searchParams.get('bank')))), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="check-alignment-test.pdf"', 'Cache-Control': 'no-store' } }); }
  catch (e: any) { return new Response(e.message, { status: 400 }); }
}
