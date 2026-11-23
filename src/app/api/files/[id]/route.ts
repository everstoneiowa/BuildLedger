import { session } from '@/lib/auth';
import { readDocument } from '@/services/documents';

// Files are never served from a public folder: every request is authenticated and scoped to the company.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await session(); const { id } = await params;
  const doc = await readDocument(ctx, Number(id)); if (!doc) return new Response('Not found', { status: 404 });
  const download = new URL(req.url).searchParams.has('download');
  const inlineOk = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)/.test(doc.mime);
  return new Response(new Uint8Array(doc.data), { headers: {
    'Content-Type': inlineOk ? doc.mime : 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Content-Disposition': `${download || !inlineOk ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
  } });
}
