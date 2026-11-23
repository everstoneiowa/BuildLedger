import { NextResponse } from 'next/server';
import { session, can } from '@/lib/auth';
import { readDocument } from '@/services/documents';

/**
 * Optional AI-assisted reading of an uploaded invoice or receipt. Only active when ANTHROPIC_API_KEY is set.
 * The result only pre-fills the form — a person reviews and edits every value before anything is saved.
 */
export async function POST(req: Request) {
  const { user, ctx } = await session();
  if (!can(user, 'bills.write')) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return NextResponse.json({ error: 'Automatic reading is not configured.' }, { status: 400 });
  const { documentId } = await req.json(); const doc = await readDocument(ctx, Number(documentId));
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  const isPdf = doc.mime === 'application/pdf'; if (!isPdf && !/^image\/(png|jpe?g|gif|webp)$/.test(doc.mime)) return NextResponse.json({ error: 'Only PDFs and images can be read automatically.' }, { status: 400 });
  const source = { type: 'base64', media_type: doc.mime.replace('image/jpg', 'image/jpeg'), data: doc.data.toString('base64') };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 1500, messages: [{ role: 'user', content: [
      isPdf ? { type: 'document', source } : { type: 'image', source },
      { type: 'text', text: 'This is a vendor invoice or receipt. Reply with ONLY a JSON object with keys: vendor (string), invoiceNumber (string|null), date (YYYY-MM-DD|null), dueDate (YYYY-MM-DD|null), total (number|null), tax (number|null), lineItems (array of {description, amount}). Use null when a value is not printed on the document. Do not guess.' },
    ] }] }),
  });
  if (!res.ok) return NextResponse.json({ error: `The reading service returned an error (${res.status}).` }, { status: 502 });
  const body = await res.json(); const text: string = body?.content?.find((c: any) => c.type === 'text')?.text ?? '';
  try { return NextResponse.json({ fields: JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) }); }
  catch { return NextResponse.json({ error: 'The document could not be read automatically. Enter the details by hand.' }, { status: 422 }); }
}
