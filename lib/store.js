// Server-only session, quota, idempotency, and aggregate feedback store (guideline.md §§3, 5, 8, 11).
// Supports Upstash Redis REST (atomic Lua EVAL + PTTL preservation, fail-closed on errors)
// and an identical-semantics in-memory adapter with injectable clock for local dev and tests.

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  AppError,
  DAILY_LIMITS,
  ERROR_CODES,
  SESSION_TTL_SECONDS,
  SUPPORTED_LANGUAGES,
} from './contracts.js';
import { redactAnalysisOutput, redactPii } from './redact.js';

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is permanently UTC+7.
const DEFAULT_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 minutes.
const RESERVATION_HOLD_TTL_MS = 2 * 60 * 1000; // 2 minutes safety hold for in-flight requests.
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000; // Fixed 90 minutes (5,400,000 ms).

function extractClientIp(requestOrIp) {
  if (typeof requestOrIp === 'string' && requestOrIp.trim()) {
    return requestOrIp.trim();
  }
  const headers = requestOrIp?.headers;
  if (!headers) return '127.0.0.1';

  const getHeader = (name) => {
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  };

  const vercelIp = getHeader('x-vercel-forwarded-for');
  if (typeof vercelIp === 'string' && vercelIp.trim()) {
    return vercelIp.split(',')[0].trim();
  }

  const forwarded = getHeader('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = getHeader('x-real-ip');
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return '127.0.0.1';
}

export function deriveIpHash(request, secret) {
  const ip = extractClientIp(request).toLowerCase();
  const resolvedSecret =
    secret ||
    process.env.QUOTA_HMAC_SECRET ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    'latihkerja-local-quota-hmac-v1';
  return createHmac('sha256', String(resolvedSecret)).update(ip).digest('hex');
}

export function getJakartaDayWindow(nowMs = Date.now()) {
  const ts = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const shifted = new Date(ts + JAKARTA_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();

  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const resetAtMs = Date.UTC(year, month, day + 1, 0, 0, 0, 0) - JAKARTA_OFFSET_MS;
  const ttlMs = Math.max(1000, resetAtMs - ts);

  return {
    dateKey,
    resetAt: new Date(resetAtMs).toISOString(),
    resetAtMs,
    ttlMs,
    ttlSeconds: Math.ceil(ttlMs / 1000),
  };
}

function normalizeRequestId(requestId) {
  if (typeof requestId !== 'string') return '';
  const trimmed = requestId.trim();
  if (!trimmed || trimmed.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) return '';
  return trimmed;
}

function validateQuotaAction(action) {
  if (action !== 'analyze' && action !== 'interviewStart') {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'action' });
  }
}

function generateSessionId() {
  return `sess_${randomBytes(18).toString('base64url')}`;
}

function sanitizeSessionData(data, createdAtMs, expiresAtMs, sessionId) {
  return {
    sessionId,
    version: 1,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    language: SUPPORTED_LANGUAGES.includes(data?.language) ? data.language : 'id',
    sanitizedCvText: redactPii(data?.sanitizedCvText || ''),
    sanitizedJd: redactPii(data?.sanitizedJd || ''),
    analysis: redactAnalysisOutput(data?.analysis || {}),
    interview: data?.interview ?? null,
  };
}

function computeFeedbackSummary(counts) {
  const total = Number(counts.total) || 0;
  const positive = Number(counts.positive) || 0;
  const satisfactionRate = total > 0 ? Math.round((positive / total) * 1000) / 10 : null;
  return {
    positive,
    total,
    satisfactionRate,
    byLanguage: {
      id: {
        positive: Number(counts.idPositive) || 0,
        total: Number(counts.idTotal) || 0,
      },
      en: {
        positive: Number(counts.enPositive) || 0,
        total: Number(counts.enTotal) || 0,
      },
    },
  };
}

function cloneJson(val) {
  return JSON.parse(JSON.stringify(val));
}

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId -> { doc, expiresAtMs }
  const quotas = new Map(); // quotaKey -> { count, expiresAtMs }
  const reservations = new Map(); // reservationId -> { quotaKey, expiresAtMs }
  const idempotency = new Map(); // idemKey -> { value, expiresAtMs }
  const feedback = {
    total: 0,
    positive: 0,
    idTotal: 0,
    idPositive: 0,
    enTotal: 0,
    enPositive: 0,
  };

  function pruneIfExpired(map, key, ts) {
    const entry = map.get(key);
    if (!entry) return null;
    if (ts >= entry.expiresAtMs) {
      map.delete(key);
      return null;
    }
    return entry;
  }

  return {
    backend: 'memory',

    async getIdempotentResult({ action, ipHash, requestId }) {
      const reqId = normalizeRequestId(requestId);
      if (!reqId || !ipHash) return null;
      const ts = now();
      const idemKey = `idem:${action}:${ipHash}:${reqId}`;
      const entry = pruneIfExpired(idempotency, idemKey, ts);
      return entry ? cloneJson(entry.value) : null;
    },

    async reserveQuota({ action, ipHash, limit = DAILY_LIMITS[action], requestId }) {
      validateQuotaAction(action);
      const ts = now();
      const window = getJakartaDayWindow(ts);
      const reqId = normalizeRequestId(requestId);

      if (reqId && ipHash) {
        const idemKey = `idem:${action}:${ipHash}:${reqId}`;
        const cachedEntry = pruneIfExpired(idempotency, idemKey, ts);
        if (cachedEntry) {
          const quotaKey = `quota:${action}:${window.dateKey}:${ipHash}`;
          const curEntry = pruneIfExpired(quotas, quotaKey, ts);
          const used = curEntry ? curEntry.count : 0;
          return {
            allowed: true,
            cached: cloneJson(cachedEntry.value),
            reservationId: null,
            count: used,
            limit,
            remaining: Math.max(0, limit - used),
            resetAt: window.resetAt,
            dateKey: window.dateKey,
          };
        }
      }

      const quotaKey = `quota:${action}:${window.dateKey}:${ipHash}`;
      let entry = pruneIfExpired(quotas, quotaKey, ts);
      if (!entry) {
        entry = { count: 0, expiresAtMs: window.resetAtMs };
        quotas.set(quotaKey, entry);
      }

      if (entry.count >= limit) {
        return {
          allowed: false,
          cached: null,
          reservationId: null,
          count: entry.count,
          limit,
          remaining: 0,
          resetAt: window.resetAt,
          dateKey: window.dateKey,
        };
      }

      entry.count += 1;
      const reservationId = `resv_${randomUUID()}`;
      reservations.set(reservationId, {
        quotaKey,
        expiresAtMs: ts + RESERVATION_HOLD_TTL_MS,
      });

      return {
        allowed: true,
        cached: null,
        reservationId,
        count: entry.count,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: window.resetAt,
        dateKey: window.dateKey,
      };
    },

    async commitQuota({ reservationId, action, ipHash, requestId, result, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS }) {
      const ts = now();
      if (reservationId) {
        reservations.delete(reservationId);
      }
      const reqId = normalizeRequestId(requestId);
      if (reqId && ipHash && result !== undefined) {
        const idemKey = `idem:${action}:${ipHash}:${reqId}`;
        idempotency.set(idemKey, {
          value: cloneJson(result),
          expiresAtMs: ts + ttlMs,
        });
      }
      return true;
    },

    async releaseQuota(reservation) {
      const reservationId =
        typeof reservation === 'string' ? reservation : reservation?.reservationId;
      if (!reservationId) return false;
      const ts = now();
      const hold = pruneIfExpired(reservations, reservationId, ts);
      if (!hold) {
        reservations.delete(reservationId);
        return false;
      }
      reservations.delete(reservationId);

      const quotaEntry = pruneIfExpired(quotas, hold.quotaKey, ts);
      if (quotaEntry && quotaEntry.count > 0) {
        quotaEntry.count -= 1;
      }
      return true;
    },

    async createSession(data) {
      const ts = now();
      const sessionId = generateSessionId();
      const expiresAtMs = ts + SESSION_TTL_MS;
      const doc = sanitizeSessionData(data, ts, expiresAtMs, sessionId);
      sessions.set(sessionId, { doc: cloneJson(doc), expiresAtMs });
      return cloneJson(doc);
    },

    async getSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('sess_')) return null;
      const ts = now();
      const entry = pruneIfExpired(sessions, sessionId, ts);
      return entry ? cloneJson(entry.doc) : null;
    },

    async startInterview({ sessionId, ipHash, session, interview }) {
      const ts = now();
      const entry = pruneIfExpired(sessions, sessionId, ts);
      if (!entry) return { status: 'expired' };
      if (entry.doc.interview) {
        return { status: 'active', interview: cloneJson(entry.doc.interview) };
      }
      if (interview && entry.doc.version !== session.version) return { status: 'conflict' };

      const window = getJakartaDayWindow(ts);
      const key = `quota:interviewStart:${window.dateKey}:${ipHash}`;
      const used = pruneIfExpired(quotas, key, ts)?.count ?? 0;
      if (used >= DAILY_LIMITS.interviewStart) {
        return { status: 'limited', resetAt: window.resetAt };
      }
      if (!interview) return { status: 'ready', session: cloneJson(entry.doc) };

      entry.doc = { ...entry.doc, interview: cloneJson(interview), version: entry.doc.version + 1 };
      quotas.set(key, { count: used + 1, expiresAtMs: window.resetAtMs });
      return { status: 'active', interview: cloneJson(interview) };
    },

    async updateSession(sessionId, expectedVersion, patchOrUpdater) {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('sess_')) {
        return { ok: false, code: ERROR_CODES.SESSION_EXPIRED };
      }
      const ts = now();
      const entry = pruneIfExpired(sessions, sessionId, ts);
      if (!entry) {
        return { ok: false, code: ERROR_CODES.SESSION_EXPIRED };
      }
      if (
        expectedVersion !== undefined &&
        expectedVersion !== null &&
        entry.doc.version !== expectedVersion
      ) {
        return {
          ok: false,
          code: ERROR_CODES.QUESTION_CONFLICT,
          session: cloneJson(entry.doc),
        };
      }

      const patch =
        typeof patchOrUpdater === 'function' ? patchOrUpdater(cloneJson(entry.doc)) : patchOrUpdater;
      const nextDoc = {
        ...entry.doc,
        ...(patch && typeof patch === 'object' ? patch : {}),
        sessionId: entry.doc.sessionId,
        createdAt: entry.doc.createdAt,
        expiresAt: entry.doc.expiresAt,
        version: entry.doc.version + 1,
      };
      // Preserve exact original expiresAtMs (never extend TTL on updates).
      entry.doc = cloneJson(nextDoc);
      return { ok: true, session: cloneJson(nextDoc) };
    },

    async recordFeedback({ positive, language }) {
      if (typeof positive !== 'boolean') {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'positive' });
      }
      if (!SUPPORTED_LANGUAGES.includes(language)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'language' });
      }
      feedback.total += 1;
      if (positive) feedback.positive += 1;
      if (language === 'id') {
        feedback.idTotal += 1;
        if (positive) feedback.idPositive += 1;
      } else {
        feedback.enTotal += 1;
        if (positive) feedback.enPositive += 1;
      }
      return computeFeedbackSummary(feedback);
    },

    async getFeedbackSummary() {
      return computeFeedbackSummary(feedback);
    },
  };
}

// Atomic Redis Lua scripts for Upstash REST EVAL.
const RESERVE_QUOTA_LUA = `
if KEYS[3] ~= '' then
  local cached = redis.call('GET', KEYS[3])
  if cached then
    local used = tonumber(redis.call('GET', KEYS[1]) or '0')
    return {'CACHED', tostring(used), cached}
  end
end
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if cur >= limit then
  return {'DENIED', tostring(cur)}
end
local nextVal = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if nextVal == 1 or pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
redis.call('SET', KEYS[2], KEYS[1], 'PX', tonumber(ARGV[3]))
return {'ALLOWED', tostring(nextVal)}
`;

const COMMIT_QUOTA_LUA = `
if KEYS[1] ~= '' then
  redis.call('DEL', KEYS[1])
end
if KEYS[2] ~= '' and ARGV[1] ~= '' then
  redis.call('SET', KEYS[2], ARGV[1], 'PX', tonumber(ARGV[2]))
end
return 1
`;

const RELEASE_QUOTA_LUA = `
local quotaKey = redis.call('GET', KEYS[1])
if not quotaKey then
  return 0
end
redis.call('DEL', KEYS[1])
local cur = tonumber(redis.call('GET', quotaKey) or '0')
if cur > 0 then
  local pttl = redis.call('PTTL', quotaKey)
  local nextVal = redis.call('DECR', quotaKey)
  if nextVal < 0 then
    redis.call('SET', quotaKey, '0')
  end
  if pttl > 0 then
    redis.call('PEXPIRE', quotaKey, pttl)
  end
end
return 1
`;

const CAS_SESSION_LUA = `
local raw = redis.call('GET', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if (not raw) or (pttl <= 0) then
  return {'ERR', 'SESSION_EXPIRED'}
end
local time = redis.call('TIME')
local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if nowMs >= tonumber(ARGV[3]) then return {'ERR', 'SESSION_EXPIRED'} end
local doc = cjson.decode(raw)
if tostring(doc.version) ~= ARGV[1] then
  return {'ERR', 'QUESTION_CONFLICT', raw}
end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return {'OK', tostring(pttl)}
`;

// Preflight is read-only. The final call commits the session and charges quota together.
const START_INTERVIEW_LUA = `
local raw = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if (not raw) or ttl <= 0 then return {'expired'} end
local doc = cjson.decode(raw)
if ARGV[2] ~= '' then
  local time = redis.call('TIME')
  local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  if nowMs >= tonumber(ARGV[5]) then return {'expired'} end
end
if doc.interview and doc.interview ~= cjson.null then
  return {'active', raw}
end
if ARGV[2] ~= '' and tostring(doc.version) ~= ARGV[1] then return {'conflict'} end
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
if used >= tonumber(ARGV[3]) then return {'limited'} end
if ARGV[2] == '' then return {'ready', raw} end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
if redis.call('INCR', KEYS[2]) == 1 then
  redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[4]))
end
return {'active', ARGV[2]}
`;

const RECORD_FEEDBACK_LUA = `
redis.call('HINCRBY', KEYS[1], 'total', 1)
if ARGV[1] == '1' then
  redis.call('HINCRBY', KEYS[1], 'positive', 1)
end
if ARGV[2] == 'id' then
  redis.call('HINCRBY', KEYS[1], 'idTotal', 1)
  if ARGV[1] == '1' then
    redis.call('HINCRBY', KEYS[1], 'idPositive', 1)
  end
else
  redis.call('HINCRBY', KEYS[1], 'enTotal', 1)
  if ARGV[1] == '1' then
    redis.call('HINCRBY', KEYS[1], 'enPositive', 1)
  end
end
return redis.call('HMGET', KEYS[1], 'total', 'positive', 'idTotal', 'idPositive', 'enTotal', 'enPositive')
`;

export function createUpstashStore({
  url,
  token,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 5000,
} = {}) {
  const cleanUrl = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  const cleanToken = typeof token === 'string' ? token.trim() : '';

  async function execCommand(commandArray) {
    if (!cleanUrl || !cleanToken) {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    }
    let response;
    try {
      response = await fetchImpl(cleanUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cleanToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(commandArray),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    }

    if (!response || !response.ok) {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    }

    if (!payload || typeof payload !== 'object' || payload.error) {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    }

    return payload.result;
  }

  return {
    backend: 'upstash',

    async getIdempotentResult({ action, ipHash, requestId }) {
      const reqId = normalizeRequestId(requestId);
      if (!reqId || !ipHash) return null;
      const raw = await execCommand(['GET', `idem:${action}:${ipHash}:${reqId}`]);
      if (typeof raw !== 'string' || !raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
      }
    },

    async reserveQuota({ action, ipHash, limit = DAILY_LIMITS[action], requestId }) {
      validateQuotaAction(action);
      const ts = now();
      const window = getJakartaDayWindow(ts);
      const reqId = normalizeRequestId(requestId);
      const quotaKey = `quota:${action}:${window.dateKey}:${ipHash}`;
      const reservationId = `resv_${randomUUID()}`;
      const resvKey = `resv:${reservationId}`;
      const idemKey = reqId && ipHash ? `idem:${action}:${ipHash}:${reqId}` : '';

      const res = await execCommand([
        'EVAL',
        RESERVE_QUOTA_LUA,
        3,
        quotaKey,
        resvKey,
        idemKey,
        String(limit),
        String(window.ttlMs),
        String(RESERVATION_HOLD_TTL_MS),
      ]);

      if (!Array.isArray(res) || res.length < 2) {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
      }

      const status = res[0];
      const count = Number(res[1]) || 0;

      if (status === 'CACHED') {
        let cached;
        try {
          cached = JSON.parse(res[2]);
        } catch {
          throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
        }
        return {
          allowed: true,
          cached,
          reservationId: null,
          count,
          limit,
          remaining: Math.max(0, limit - count),
          resetAt: window.resetAt,
          dateKey: window.dateKey,
        };
      }

      if (status === 'DENIED') {
        return {
          allowed: false,
          cached: null,
          reservationId: null,
          count,
          limit,
          remaining: 0,
          resetAt: window.resetAt,
          dateKey: window.dateKey,
        };
      }

      return {
        allowed: true,
        cached: null,
        reservationId,
        count,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt: window.resetAt,
        dateKey: window.dateKey,
      };
    },

    async commitQuota({ reservationId, action, ipHash, requestId, result, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS }) {
      const resvKey = reservationId ? `resv:${reservationId}` : '';
      const reqId = normalizeRequestId(requestId);
      const idemKey = reqId && ipHash && result !== undefined ? `idem:${action}:${ipHash}:${reqId}` : '';
      const serialized = idemKey ? JSON.stringify(result) : '';

      await execCommand(['EVAL', COMMIT_QUOTA_LUA, 2, resvKey, idemKey, serialized, String(ttlMs)]);
      return true;
    },

    async releaseQuota(reservation) {
      const reservationId =
        typeof reservation === 'string' ? reservation : reservation?.reservationId;
      if (!reservationId) return false;
      const released = await execCommand(['EVAL', RELEASE_QUOTA_LUA, 1, `resv:${reservationId}`]);
      return Number(released) === 1;
    },

    async createSession(data) {
      const ts = now();
      const sessionId = generateSessionId();
      const expiresAtMs = ts + SESSION_TTL_MS;
      const doc = sanitizeSessionData(data, ts, expiresAtMs, sessionId);
      await execCommand(['SET', `sess:${sessionId}`, JSON.stringify(doc), 'PX', String(SESSION_TTL_MS)]);
      return doc;
    },

    async getSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('sess_')) return null;
      const raw = await execCommand(['GET', `sess:${sessionId}`]);
      if (typeof raw !== 'string' || !raw) return null;
      try {
        const doc = JSON.parse(raw);
        if (doc?.expiresAt && now() >= Date.parse(doc.expiresAt)) return null;
        return doc;
      } catch {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
      }
    },

    async startInterview({ sessionId, ipHash, session, interview }) {
      const ts = now();
      const deadline = interview ? Date.parse(session.expiresAt) : null;
      if (interview && (!Number.isFinite(deadline) || ts >= deadline)) return { status: 'expired' };
      const window = getJakartaDayWindow(ts);
      const nextDoc = interview && { ...session, interview, version: session.version + 1 };
      const result = await execCommand([
        'EVAL',
        START_INTERVIEW_LUA,
        2,
        `sess:${sessionId}`,
        `quota:interviewStart:${window.dateKey}:${ipHash}`,
        String(session?.version ?? ''),
        nextDoc ? JSON.stringify(nextDoc) : '',
        String(DAILY_LIMITS.interviewStart),
        String(window.ttlMs),
        String(deadline ?? ''),
      ]);
      try {
        const [status, payload] = result;
        if (status === 'ready' || status === 'active') {
          const current = JSON.parse(payload);
          const expiresAt = Date.parse(current.expiresAt);
          if (!Number.isFinite(expiresAt)) throw new Error('Invalid session expiry');
          if (now() >= expiresAt) return { status: 'expired' };
          return status === 'ready' ? { status, session: current } : { status, interview: current.interview };
        }
        if (status === 'limited') return { status, resetAt: window.resetAt };
        if (status === 'expired' || status === 'conflict') return { status };
      } catch {
        // Malformed store responses use the same recovery as an unavailable store.
      }
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    },

    async updateSession(sessionId, expectedVersion, patchOrUpdater) {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('sess_')) {
        return { ok: false, code: ERROR_CODES.SESSION_EXPIRED };
      }

      const current = await this.getSession(sessionId);
      if (!current) {
        return { ok: false, code: ERROR_CODES.SESSION_EXPIRED };
      }

      if (
        expectedVersion !== undefined &&
        expectedVersion !== null &&
        current.version !== expectedVersion
      ) {
        return { ok: false, code: ERROR_CODES.QUESTION_CONFLICT, session: current };
      }

      const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(cloneJson(current)) : patchOrUpdater;
      const nextDoc = {
        ...current,
        ...(patch && typeof patch === 'object' ? patch : {}),
        sessionId: current.sessionId,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
        version: current.version + 1,
      };

      const cas = await execCommand([
        'EVAL',
        CAS_SESSION_LUA,
        1,
        `sess:${sessionId}`,
        String(current.version),
        JSON.stringify(nextDoc),
        String(Date.parse(current.expiresAt)),
      ]);

      if (!Array.isArray(cas) || cas[0] !== 'OK') {
        if (Array.isArray(cas) && cas[1] === 'QUESTION_CONFLICT') {
          let latest = null;
          try {
            latest = cas[2] ? JSON.parse(cas[2]) : null;
          } catch {
            latest = null;
          }
          return { ok: false, code: ERROR_CODES.QUESTION_CONFLICT, session: latest };
        }
        if (Array.isArray(cas) && cas[1] === 'SESSION_EXPIRED') {
          return { ok: false, code: ERROR_CODES.SESSION_EXPIRED };
        }
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }

      return { ok: true, session: nextDoc };
    },

    async recordFeedback({ positive, language }) {
      if (typeof positive !== 'boolean') {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'positive' });
      }
      if (!SUPPORTED_LANGUAGES.includes(language)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'language' });
      }
      const arr = await execCommand([
        'EVAL',
        RECORD_FEEDBACK_LUA,
        1,
        'stats:feedback',
        positive ? '1' : '0',
        language,
      ]);
      const vals = Array.isArray(arr) ? arr : [];
      return computeFeedbackSummary({
        total: vals[0],
        positive: vals[1],
        idTotal: vals[2],
        idPositive: vals[3],
        enTotal: vals[4],
        enPositive: vals[5],
      });
    },

    async getFeedbackSummary() {
      const arr = await execCommand([
        'HMGET',
        'stats:feedback',
        'total',
        'positive',
        'idTotal',
        'idPositive',
        'enTotal',
        'enPositive',
      ]);
      const vals = Array.isArray(arr) ? arr : [];
      return computeFeedbackSummary({
        total: vals[0],
        positive: vals[1],
        idTotal: vals[2],
        idPositive: vals[3],
        enTotal: vals[4],
        enPositive: vals[5],
      });
    },
  };
}

export function createStore(opts = {}) {
  const hasExplicitOpts = 'url' in opts || 'token' in opts;
  const url = hasExplicitOpts ? opts.url : process.env.UPSTASH_REDIS_REST_URL;
  const token = hasExplicitOpts ? opts.token : process.env.UPSTASH_REDIS_REST_TOKEN;

  const hasUrl = typeof url === 'string' && url.trim().length > 0;
  const hasToken = typeof token === 'string' && token.trim().length > 0;

  if (hasUrl || hasToken) {
    // If Upstash is partially configured, createUpstashStore fails closed with 503 TEMPORARILY_UNAVAILABLE.
    return createUpstashStore({
      url,
      token,
      fetchImpl: opts.fetchImpl,
      now: opts.now,
      timeoutMs: opts.timeoutMs,
    });
  }

  return createMemoryStore({ now: opts.now });
}

export function getStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  const configSignature = url || token ? `upstash:${url}` : 'memory';

  if (
    !globalThis.__latihKerjaStore ||
    globalThis.__latihKerjaStoreSig !== configSignature
  ) {
    globalThis.__latihKerjaStore = createStore();
    globalThis.__latihKerjaStoreSig = configSignature;
  }

  return globalThis.__latihKerjaStore;
}
