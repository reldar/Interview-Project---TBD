import { AppError, ERROR_CODES } from './contracts.js';

export async function readBoundedBytes(request, ceiling) {
  if (Number(request.headers.get('content-length')) > ceiling) {
    throw new AppError(ERROR_CODES.FILE_TOO_LARGE);
  }
  if (!request.body) throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  const chunks = [];
  let received = 0;
  try {
    for await (const chunk of request.body) {
      received += chunk.byteLength;
      if (received > ceiling) throw new AppError(ERROR_CODES.FILE_TOO_LARGE);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  }
}

export async function readBoundedJson(request, ceiling) {
  const bytes = await readBoundedBytes(request, ceiling);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  }
}
