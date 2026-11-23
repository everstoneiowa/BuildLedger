import { NextResponse } from 'next/server';
import { session, can } from '@/lib/auth';
import { saveDocument } from '@/services/documents';

const MAX = 40 * 1024 * 1024;
export async function POST(req: Request) {
  const { user, ctx } = await session();
  if (!can(user, 'documents.write')) return NextResponse.json({ error: 'Your role cannot upload documents.' }, { status: 403 });
  try {
    const fd = await req.formData(); const files = fd.getAll('files').filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: 'No files received.' }, { status: 400 });
    const links = JSON.parse(String(fd.get('links') ?? '[]')) as { type: string; id: number }[];
    const versionOf = Number(fd.get('versionOf')) || null; const out = [];
    for (const file of files) {
      if (file.size > MAX) return NextResponse.json({ error: `"${file.name}" is larger than 40 MB.` }, { status: 400 });
      const id = await saveDocument(ctx, { name: file.name, mime: file.type || 'application/octet-stream', data: Buffer.from(await file.arrayBuffer()), folder: (fd.get('folder') as string) || null, description: (fd.get('description') as string) || null, tags: (fd.get('tags') as string) || null, links, versionOf });
      out.push({ id, name: file.name, mime: file.type });
    }
    return NextResponse.json({ documents: out });
  } catch (e: any) { return NextResponse.json({ error: e.message ?? 'Upload failed' }, { status: 500 }); }
}
