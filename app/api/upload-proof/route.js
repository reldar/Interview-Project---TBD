import { MAX_PDF_BYTES } from '../../limit.js';
import { MAX_MULTIPART_OVERHEAD_BYTES } from '../../../lib/contracts.js';
import { extractPdfText } from '../../../lib/pdf.js';

export const runtime = 'nodejs';
const fail = (error, status) => Response.json({ error }, { status });

export async function POST(request) {
  // Bound multipart overhead as well as the file, including chunked requests.
  const bodyLimit = MAX_PDF_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
  if (Number(request.headers.get('content-length')) > bodyLimit) return fail('FILE_TOO_LARGE', 413);
  if (!request.body) return fail('INVALID_INPUT', 400);

  let form;
  let chunks = [];
  try {
    let received = 0;
    for await (const chunk of request.body) {
      received += chunk.byteLength;
      if (received > bodyLimit) {
        chunks = null;
        return fail('FILE_TOO_LARGE', 413);
      }
      chunks.push(chunk);
    }
    form = await new Response(Buffer.concat(chunks), { headers: request.headers }).formData();
  } catch {
    return fail('INVALID_INPUT', 400);
  } finally {
    chunks = null;
  }

  const files = form.getAll('file');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof Blob)) return fail('INVALID_INPUT', 400);
  if (file.size > MAX_PDF_BYTES) return fail('FILE_TOO_LARGE', 413);
  if (file.type !== 'application/pdf') return fail('UNSUPPORTED_FILE', 415);

  let rawBytes = null;
  try {
    rawBytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractPdfText(rawBytes, { maxBytes: MAX_PDF_BYTES });
    rawBytes = null;
    return Response.json({
      bytes: extracted.bytes,
      pages: extracted.pages,
      characters: extracted.characters,
    });
  } catch (err) {
    const code = err?.code || 'PDF_UNREADABLE';
    const status = err?.status || 422;
    return fail(code, status);
  } finally {
    rawBytes = null;
  }
}
