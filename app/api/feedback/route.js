import {
  AppError,
  ERROR_CODES,
  validateFeedbackRequest,
} from '../../../lib/contracts.js';
import { logRouteEvent } from '../../../lib/logger.js';
import { readBoundedJson } from '../../../lib/request-body.js';
import { deriveIpHash, getStore } from '../../../lib/store.js';

export const runtime = 'nodejs';

const MAX_FEEDBACK_BODY_BYTES = 4_096;

export async function handleFeedback(request, deps = {}) {
  const now = deps.now || (() => Date.now());
  const startedAt = now();
  const log = deps.logger || logRouteEvent;
  let activeStore;

  let language = undefined;

  try {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
    }

    const vote = validateFeedbackRequest(await readBoundedJson(request, MAX_FEEDBACK_BODY_BYTES));
    language = vote.language;
    const ipHash = deriveIpHash(request, deps.ipSecret, deps.env);
    activeStore = deps.store ?? getStore();
    const summary = await activeStore.recordFeedback({ ...vote, ipHash });

    log({
      route: '/api/feedback',
      status: 200,
      code: 'OK',
      elapsedMs: now() - startedAt,
      meta: {
        language,
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
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (err) {
    let appErr =
      err instanceof AppError
        ? err
        : new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    if (appErr.code === ERROR_CODES.FILE_TOO_LARGE) {
      appErr = new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
    }

    const errorObj = { code: appErr.code };
    if (appErr.code === ERROR_CODES.INVALID_INPUT && appErr.meta?.field) {
      errorObj.field = appErr.meta.field;
    }
    const headers = { 'cache-control': 'no-store' };
    if (appErr.code === ERROR_CODES.QUOTA_REACHED && appErr.meta?.resetAt) {
      errorObj.resetAt = appErr.meta.resetAt;
      headers['retry-after'] = String(Math.max(1, Math.ceil((Date.parse(errorObj.resetAt) - now()) / 1000)));
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

    return Response.json({ error: errorObj }, { status: appErr.status, headers });
  }
}

export async function POST(request) {
  return handleFeedback(request);
}
