import {
  AppError,
  ERROR_CODES,
  validateLanguage,
} from '../../../lib/contracts.js';
import { logRouteEvent } from '../../../lib/logger.js';
import { getStore } from '../../../lib/store.js';

export const runtime = 'nodejs';

const MAX_FEEDBACK_BODY_BYTES = 4_096;

async function readSmallJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FEEDBACK_BODY_BYTES) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
  }
  if (!request.body) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
  }

  const chunks = [];
  let received = 0;
  try {
    for await (const chunk of request.body) {
      received += chunk.byteLength;
      if (received > MAX_FEEDBACK_BODY_BYTES) {
        chunks.length = 0;
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
      }
      chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
    }
    return parsed;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
  }
}

export async function handleFeedback(request, deps = {}) {
  const now = deps.now || (() => Date.now());
  const startedAt = now();
  const log = deps.logger || logRouteEvent;
  let activeStore;

  let language = undefined;

  try {
    activeStore = deps.store ?? getStore();
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
    }

    const body = await readSmallJson(request);

    if (typeof body.positive !== 'boolean') {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'positive' });
    }

    const langCheck = validateLanguage(body.language);
    if (!langCheck.ok) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'language' });
    }
    language = langCheck.value;

    const summary = await activeStore.recordFeedback({
      positive: body.positive,
      language,
    });

    log({
      route: '/api/feedback',
      status: 200,
      code: 'OK',
      elapsedMs: now() - startedAt,
      meta: {
        language,
        positive: body.positive,
        totalFeedback: summary.total,
        positiveFeedback: summary.positive,
        storeBackend: activeStore.backend,
      },
    });

    return Response.json(
      {
        positive: summary.positive,
        total: summary.total,
        satisfactionRate: summary.satisfactionRate,
      },
      { status: 200 }
    );
  } catch (err) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);

    const errorObj = { code: appErr.code };
    if (appErr.code === ERROR_CODES.INVALID_INPUT && appErr.meta?.field) {
      errorObj.field = appErr.meta.field;
    }

    log({
      route: '/api/feedback',
      status: appErr.status,
      code: appErr.code,
      elapsedMs: now() - startedAt,
      meta: {
        language,
        field: appErr.meta?.field,
        storeBackend: activeStore?.backend,
      },
    });

    return Response.json({ error: errorObj }, { status: appErr.status });
  }
}

export async function POST(request) {
  return handleFeedback(request);
}
