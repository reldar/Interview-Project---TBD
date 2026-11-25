// Server-only allowlisted structured logger (guideline.md §8).
// Never logs CV text, JD text, answers, headers, raw IPs, credentials, or raw sessionIds.

import { ERROR_CODES } from './contracts.js';

const VALID_CODES = new Set(['OK', ...Object.values(ERROR_CODES)]);

const NUMERIC_META_KEYS = new Set([
  'pages',
  'bytes',
  'atsScore',
  'matchedCount',
  'missingCount',
  'rewriteCount',
  'quotaRemaining',
  'totalFeedback',
  'positiveFeedback',
  'attemptCount',
]);

const BOOLEAN_META_KEYS = new Set(['cached', 'sparse', 'positive']);

const ENUM_META_ALLOWLIST = Object.freeze({
  transport: new Set(['multipart', 'json']),
  language: new Set(['id', 'en']),
  mode: new Set(['hrd', 'user']),
  action: new Set(['analyze', 'interviewStart']),
  field: new Set([
    'file',
    'cvText',
    'jobDescription',
    'language',
    'positive',
    'requestId',
    'body',
    'sessionId',
    'mode',
    'questionNumber',
    'userAnswer',
  ]),
  storeBackend: new Set(['memory', 'upstash']),
});

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const clean = {};
  let count = 0;

  for (const [key, val] of Object.entries(meta)) {
    if (NUMERIC_META_KEYS.has(key)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        clean[key] = Math.round(val * 100) / 100;
        count += 1;
      }
      continue;
    }
    if (BOOLEAN_META_KEYS.has(key)) {
      if (typeof val === 'boolean') {
        clean[key] = val;
        count += 1;
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(ENUM_META_ALLOWLIST, key)) {
      if (typeof val === 'string' && ENUM_META_ALLOWLIST[key].has(val)) {
        clean[key] = val;
        count += 1;
      }
    }
  }

  return count > 0 ? clean : undefined;
}

export function logRouteEvent({ route, status, code, elapsedMs, meta, sink } = {}) {
  const safeRoute = typeof route === 'string' && /^\/api\/[a-z0-9/_-]+$/i.test(route) ? route : '/api/unknown';
  const safeStatus =
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
  const safeCode = typeof code === 'string' && VALID_CODES.has(code) ? code : ERROR_CODES.TEMPORARILY_UNAVAILABLE;
  const safeElapsed =
    typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;

  const entry = {
    ts: new Date().toISOString(),
    route: safeRoute,
    status: safeStatus,
    code: safeCode,
    elapsedMs: safeElapsed,
  };

  const safeMeta = sanitizeMeta(meta);
  if (safeMeta) entry.meta = safeMeta;

  const line = JSON.stringify(entry);
  if (typeof sink === 'function') {
    sink(line);
  } else {
    console.info(line);
  }
  return line;
}
