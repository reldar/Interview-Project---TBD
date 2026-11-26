import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ERROR_CODES, MAX_PDF_BYTES } from '../lib/contracts.js';
import { extractPdfText } from '../lib/pdf.js';

// Pad before the cross-reference table so each exact-size fixture remains a valid PDF.
function pdf(size) {
  const stream = 'BT /F1 12 Tf 50 700 Td (Fictional CV Python) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (const [i, obj] of objects.entries()) {
    table += String(body.length).padStart(10, '0') + ' 00000 n \n';
    body += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  }
  table += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n';
  const end = '\n%%EOF\n';
  const offset = size - table.length - 7 - end.length;
  const bytes = body.padEnd(offset, ' ') + table + offset + end;
  assert.equal(bytes.length, size);
  return bytes;
}

for (const size of [MAX_PDF_BYTES - 1, MAX_PDF_BYTES, MAX_PDF_BYTES + 1]) {
  const filename = 'fictional-' + size + '.pdf';
  const data = Buffer.from(pdf(size), 'latin1');
  if (process.argv[2]) await writeFile(process.argv[2] + '/' + filename, data);
  if (size > MAX_PDF_BYTES) {
    await assert.rejects(extractPdfText(data), { code: ERROR_CODES.FILE_TOO_LARGE, status: 413 });
    console.log(size, 'rejected as oversized');
    continue;
  }
  const result = await extractPdfText(data);
  assert.equal(result.pages, 1);
  assert.equal(result.bytes, size);
  assert.equal(result.text, 'Fictional CV Python');
  console.log(size, 'parsed in memory');
}
