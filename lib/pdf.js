// Server-only in-memory PDF text extractor via pdf-parse (guideline.md §§3, 4, 8).
// Processes bytes strictly in RAM, never writes to disk/tmp/Redis, and destroys parser in finally.

import { PDFParse } from 'pdf-parse';
import { AppError, ERROR_CODES, MAX_PDF_BYTES } from './contracts.js';

function hasPdfMagicHeader(bytes) {
  const limit = Math.min(bytes.byteLength, 1024);
  if (limit < 5) return false;
  // Look for ASCII "%PDF-" (0x25 0x50 0x44 0x46 0x2d) within the first 1024 bytes.
  for (let i = 0; i <= limit - 5; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

export async function extractPdfText(bufferOrUint8, { maxBytes = MAX_PDF_BYTES } = {}) {
  let bytes = null;
  let parser = null;

  try {
    if (bufferOrUint8 instanceof Uint8Array) {
      bytes = bufferOrUint8;
    } else if (bufferOrUint8 instanceof ArrayBuffer) {
      bytes = new Uint8Array(bufferOrUint8);
    } else {
      throw new AppError(ERROR_CODES.PDF_UNREADABLE, 422);
    }

    const byteCount = bytes.byteLength;
    if (byteCount > maxBytes) {
      throw new AppError(ERROR_CODES.FILE_TOO_LARGE, 413);
    }
    if (byteCount === 0 || !hasPdfMagicHeader(bytes)) {
      throw new AppError(ERROR_CODES.PDF_UNREADABLE, 422);
    }

    // Copy into an isolated Uint8Array so worker transfer releases our working buffer cleanly.
    const workingCopy = new Uint8Array(bytes);
    bytes = null;

    parser = new PDFParse({ data: workingCopy });
    const result = await parser.getText({ parseHyperlinks: false, pageJoiner: '', first: 30 });

    const pages = Array.isArray(result?.pages) ? result.pages : [];
    const characters = pages.reduce((sum, page) => sum + (page?.text ? page.text.trim().length : 0), 0);
    const nonWhitespace = pages.reduce(
      (sum, page) => sum + (page?.text ? page.text.replace(/\s+/g, '').length : 0),
      0
    );

    if (!characters || !nonWhitespace) {
      throw new AppError(ERROR_CODES.PDF_UNREADABLE, 422);
    }

    const text = pages
      .map((page) => (page?.text ? page.text.replace(/\r\n?/g, '\n').trim() : ''))
      .filter(Boolean)
      .join('\n\n');

    return {
      text,
      pages: typeof result.total === 'number' ? result.total : pages.length,
      bytes: byteCount,
      characters,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.PDF_UNREADABLE, 422);
  } finally {
    bytes = null;
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors during parser teardown.
      }
      parser = null;
    }
  }
}
