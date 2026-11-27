// Server-only session, quota, idempotency, and aggregate feedback store (guideline.md §§3, 5, 8, 11).
// Supports Upstash Redis REST (atomic Lua EVAL + PTTL preservation, fail-closed on errors)
// and an identical-semantics in-memory adapter with injectable clock for local dev and tests.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import {
  AppError,
  DAILY_LIMITS,
  ERROR_CODES,
  SESSION_TTL_SECONDS,
  SUPPORTED_LANGUAGES,
  validateFeedbackRequest,
} from './contracts.js';
import { redactAnalysisOutput, redactPii } from './redact.js';

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is permanently UTC+7.
const DEFAULT_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 minutes.
const RESERVATION_HOLD_TTL_MS = 2 * 60 * 1000; // 2 minutes safety hold for in-flight requests.
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000; // Fixed 90 minutes (5,400,000 ms).
export const INTERVIEW_GENERATION_LEASE_MS = 25_000;
export const INTERVIEW_ATTEMPT_WINDOW_MS = 120_000;
export const MAX_INTERVIEW_ATTEMPTS_PER_STEP = 3;
export const MAX_INTERVIEW_ATTEMPTS_PER_IP_DAY = 24;
export const CV_ADMISSION_LEASE_MS = 60_000;
export const MAX_CV_ADMISSIONS_PER_IP_DAY = 12;
const MAX_ACTIVE_CV_PER_IP = 2;
export const MAX_CV_REQUESTS_PER_IP_MINUTE = 30;
const MAX_CV_REQUESTS_PER_WORKER_MINUTE = 360;
const MAX_FEEDBACK_ATTEMPTS = 10;
const FEEDBACK_WINDOW_MS = 60_000;

function productionRuntime(env) {
  return env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
}

function extractClientIp(requestOrIp, env) {
  if (typeof requestOrIp === 'string' && requestOrIp.trim()) {
    return requestOrIp.trim();
  }
  if (productionRuntime(env)) {
    const ip = env.VERCEL === '1' ? requestOrIp?.headers?.get('x-vercel-forwarded-for')?.trim() : null;
    if (!ip || !isIP(ip)) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    return ip;
  }
  return '127.0.0.1';
}

export function deriveIpHash(request, secret, env = process.env) {
  const ip = extractClientIp(request, env).toLowerCase();
  const resolvedSecret = secret || env.QUOTA_HMAC_SECRET || 'latihkerja-local-quota-hmac-v1';
  if (productionRuntime(env) && (!env.QUOTA_HMAC_SECRET || env.QUOTA_HMAC_SECRET.trim().length < 32)) {
    throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
  }
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
    ...(data?.nameMaskVersion === 1 ? { nameMaskVersion: 1 } : {}),
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

function feedbackRateLimit(resetAtMs) {
  return new AppError(ERROR_CODES.QUOTA_REACHED, { resetAt: new Date(resetAtMs).toISOString() });
}

function cloneJson(val) {
  return JSON.parse(JSON.stringify(val));
}

function interviewClaim(session, ipHash, questionNumber, now) {
  const { sessionId, version } = session;
  const day = getJakartaDayWindow(now);
  const bucket = `${day.dateKey}:${ipHash}`;
  return {
    sessionId,
    version,
    token: randomUUID(),
    start: questionNumber === undefined,
    deadline: Date.parse(session.expiresAt),
    resetAtMs: day.resetAtMs,
    quotaKey: `quota:interviewStart:${bucket}`,
    holdsKey: `quota:interviewStart:${bucket}:holds`,
    dayKey: `interview:day-attempts:${bucket}`,
    stepKey: `interview:step-attempts:${sessionId}:${questionNumber ?? 'start'}`,
  };
}

function cvAdmission({ ipHash, fingerprint, requestId, logicalId }, ts) {
  const { dateKey, resetAtMs, resetAt } = getJakartaDayWindow(ts);
  const bucket = `${dateKey}:${ipHash}`;
  return {
    token: randomUUID(), resetAtMs, resetAt,
    ownerKey: `cv:owner:${ipHash}:${fingerprint}`,
    attemptsKey: `cv:attempts:${bucket}`,
    activeKey: `cv:active:${ipHash}`,
    intakeKey: `cv:intake:${Math.floor(ts / 60_000)}:${ipHash}`,
    quotaKey: `quota:analyze:${bucket}`,
    replayKey: requestId ? `cv:replay:${ipHash}:${requestId}` : '',
    logicalKey: logicalId ? `cv:logical:${ipHash}:${logicalId}` : '',
  };
}

function budgetWindows(ts, limits) {
  const minute = Math.floor(ts / 60_000);
  const day = getJakartaDayWindow(ts);
  return [
    { key: `ai:budget:minute:${minute}`, end: (minute + 1) * 60_000, limit: limits.perMinute },
    { key: `ai:budget:day:${day.dateKey}`, end: day.resetAtMs, limit: limits.perDay },
  ];
}

function redisReservationKeys(reservationId) {
  if (typeof reservationId !== 'string') return null;
  const separator = reservationId.indexOf('.');
  if (!(separator > 0)) return null;
  const quotaKey = reservationId.slice(separator + 1);
  return [`resv:${reservationId}`, quotaKey, `${quotaKey}:holds`];
}

function createCvIntakeLimiter() {
  let minute;
  let total = 0;
  const counts = new Map();
  return (ipHash, ts) => {
    const current = Math.floor(ts / 60_000);
    if (minute !== current) {
      minute = current;
      total = 0;
      counts.clear();
    }
    const count = counts.get(ipHash) ?? 0;
    if (count >= MAX_CV_REQUESTS_PER_IP_MINUTE || total >= MAX_CV_REQUESTS_PER_WORKER_MINUTE) {
      return { status: 'throttled', resetAt: new Date((current + 1) * 60_000).toISOString() };
    }
    counts.set(ipHash, count + 1);
    total += 1;
    return null;
  };
}

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId -> { doc, expiresAtMs }
  const quotas = new Map(); // Committed successes only. Active reservations live in quotaHolds.
  const reservations = new Map(); // reservationId -> { quotaKey, expiresAtMs }
  const canonicalOwners = new Map();
  const idempotency = new Map(); // idemKey -> { value, expiresAtMs }
  const interviewOwners = new Map();
  const quotaHolds = new Map();
  const interviewAttempts = new Map();
  const cvOwners = new Map();
  const cvActive = new Map();
  const cvAttempts = new Map();
  const aiBudget = new Map();
  const cvIntake = new Map();
  const checkCvIntake = createCvIntakeLimiter();
  let sweepInterviewStateAt = 0;
  let sweepCvStateAt = 0;
  const feedbackAttempts = new Map();
  let sweepFeedbackAttemptsAt = 0;
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

  function liveHolds(key, ts) {
    const holds = pruneIfExpired(quotaHolds, key, ts)?.holds ?? new Map();
    for (const [token, end] of holds) if (end <= ts) holds.delete(token);
    return holds;
  }

  function addHold(key, holds, token, end) {
    holds.set(token, end);
    quotaHolds.set(key, { holds, expiresAtMs: Math.max(end, quotaHolds.get(key)?.expiresAtMs ?? 0) });
  }

  function budgetDenial(windows, ts) {
    const blocked = windows.filter(({ key, limit }) => (pruneIfExpired(aiBudget, key, ts)?.count ?? 0) >= limit);
    return blocked.length ? new Date(Math.max(...blocked.map(({ end }) => end))).toISOString() : null;
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
      const quotaKey = `quota:${action}:${window.dateKey}:${ipHash}`;
      const holdsKey = `${quotaKey}:holds`;
      const holds = liveHolds(holdsKey, ts);
      let used = (pruneIfExpired(quotas, quotaKey, ts)?.count ?? 0) + holds.size;
      const reqId = normalizeRequestId(requestId);
      const cached = reqId && ipHash
        ? pruneIfExpired(idempotency, `idem:${action}:${ipHash}:${reqId}`, ts)
        : null;
      const allowed = Boolean(cached) || used < limit;
      const canonicalKey = reqId && `idem:${action}:${ipHash}:${reqId}`;
      const owner = canonicalKey && pruneIfExpired(canonicalOwners, canonicalKey, ts);
      if (!cached && owner && pruneIfExpired(reservations, owner.token, ts)) {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      let reservationId = null;
      if (allowed && !cached) {
        reservationId = `resv_${randomUUID()}`;
        const expiresAtMs = ts + RESERVATION_HOLD_TTL_MS;
        if (canonicalKey) canonicalOwners.set(canonicalKey, { token: reservationId, expiresAtMs });
        reservations.set(reservationId, { quotaKey, holdsKey, expiresAtMs, resetAtMs: window.resetAtMs });
        addHold(holdsKey, holds, reservationId, expiresAtMs);
        used += 1;
      }
      return {
        allowed, reservationId, cached: cached ? cloneJson(cached.value) : null,
        count: used, limit, remaining: Math.max(0, limit - used), resetAt: window.resetAt, dateKey: window.dateKey,
      };
    },

    async commitQuota({ reservationId, action, ipHash, requestId, result, admission, session, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS }) {
      const ts = now();
      if (admission && pruneIfExpired(cvOwners, admission.ownerKey, ts)?.token !== admission.token) {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      const hold = pruneIfExpired(reservations, reservationId, ts);
      if (!hold || !liveHolds(hold.holdsKey, ts).has(reservationId)) {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      reservations.delete(reservationId);
      if (session) sessions.set(session.sessionId, { doc: cloneJson(session), expiresAtMs: Date.parse(session.expiresAt) });
      quotaHolds.get(hold.holdsKey).holds.delete(reservationId);
      if (ts < hold.resetAtMs) {
        const count = pruneIfExpired(quotas, hold.quotaKey, ts)?.count ?? 0;
        quotas.set(hold.quotaKey, { count: count + 1, expiresAtMs: hold.resetAtMs });
      }
      const reqId = normalizeRequestId(requestId);
      if (reqId && ipHash && result !== undefined) {
        const idemKey = `idem:${action}:${ipHash}:${reqId}`;
        idempotency.set(idemKey, { value: cloneJson(result), expiresAtMs: ts + ttlMs });
      }
      if (admission?.replayKey && result !== undefined) {
        idempotency.set(admission.replayKey, { value: cloneJson(result), expiresAtMs: ts + ttlMs });
      }
      if (admission?.logicalKey && reqId && result !== undefined) {
        idempotency.set(admission.logicalKey, { expiresAtMs: ts + ttlMs });
      }
      return true;
    },

    async releaseQuota(reservation) {
      const token = typeof reservation === 'string' ? reservation : reservation?.reservationId;
      if (!token) return false;
      const hold = pruneIfExpired(reservations, token, now());
      if (!hold) return false;
      reservations.delete(token);
      return quotaHolds.get(hold.holdsKey)?.holds.delete(token) ?? false;
    },

    async createSession(data, { deferUntilCommit = false } = {}) {
      const ts = now();
      const sessionId = generateSessionId();
      const expiresAtMs = ts + SESSION_TTL_MS;
      const doc = sanitizeSessionData(data, ts, expiresAtMs, sessionId);
      if (!deferUntilCommit) sessions.set(sessionId, { doc: cloneJson(doc), expiresAtMs });
      return cloneJson(doc);
    },

    async getSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('sess_')) return null;
      const ts = now();
      const entry = pruneIfExpired(sessions, sessionId, ts);
      return entry ? cloneJson(entry.doc) : null;
    },

    async claimCvAdmission(input) {
      const ts = now();
      const throttled = checkCvIntake(input.ipHash, ts);
      if (throttled) return throttled;
      const admission = cvAdmission(input, ts);
      if (ts >= sweepCvStateAt) {
        for (const map of [canonicalOwners, cvOwners, cvActive, cvAttempts, cvIntake, idempotency, reservations, quotaHolds, quotas]) {
          for (const key of map.keys()) pruneIfExpired(map, key, ts);
        }
        sweepCvStateAt = ts + CV_ADMISSION_LEASE_MS;
      }
      const cached = pruneIfExpired(idempotency, admission.replayKey, ts);
      if (cached) return { status: 'cached', result: cloneJson(cached.value) };
      if (pruneIfExpired(cvOwners, admission.ownerKey, ts)) return { status: 'busy' };
      const committed = pruneIfExpired(quotas, admission.quotaKey, ts)?.count ?? 0;
      let denial = committed >= DAILY_LIMITS.analyze ? { status: 'limited', resetAt: admission.resetAt } : null;
      const mayReplay = Boolean(pruneIfExpired(idempotency, admission.logicalKey, ts));
      if (denial && !mayReplay) return denial;
      if (!denial && committed + liveHolds(`${admission.quotaKey}:holds`, ts).size >= DAILY_LIMITS.analyze) return { status: 'busy' };
      const count = pruneIfExpired(cvAttempts, admission.attemptsKey, ts)?.count ?? 0;
      if (count >= MAX_CV_ADMISSIONS_PER_IP_DAY) return denial ?? { status: 'attempts', resetAt: admission.resetAt };
      const active = pruneIfExpired(cvActive, admission.activeKey, ts)?.holds ?? new Map();
      for (const [token, end] of active) if (end <= ts) active.delete(token);
      if (active.size >= MAX_ACTIVE_CV_PER_IP || count + active.size >= MAX_CV_ADMISSIONS_PER_IP_DAY) return { status: 'busy' };
      const windows = budgetWindows(ts, input.limits);
      const resetAt = budgetDenial(windows, ts);
      if (!denial && resetAt) denial = { status: 'budget', resetAt };
      if (denial && !mayReplay) return denial;
      const minute = pruneIfExpired(cvIntake, admission.intakeKey, ts)?.count ?? 0;
      if (minute >= MAX_CV_REQUESTS_PER_IP_MINUTE) {
        return { status: 'throttled', resetAt: new Date(windows[0].end).toISOString() };
      }
      cvIntake.set(admission.intakeKey, { count: minute + 1, expiresAtMs: windows[0].end });
      const expiresAtMs = ts + CV_ADMISSION_LEASE_MS;
      active.set(admission.token, expiresAtMs);
      cvActive.set(admission.activeKey, { holds: active, expiresAtMs });
      cvOwners.set(admission.ownerKey, { token: admission.token, expiresAtMs });
      return { status: 'claimed', admission, denial };
    },

    async releaseCvAdmission(admission, charge = true) {
      const ts = now();
      if (pruneIfExpired(cvOwners, admission.ownerKey, ts)?.token !== admission.token) return;
      cvOwners.delete(admission.ownerKey);
      cvActive.get(admission.activeKey)?.holds.delete(admission.token);
      if (charge && ts < admission.resetAtMs) {
        const count = pruneIfExpired(cvAttempts, admission.attemptsKey, ts)?.count ?? 0;
        cvAttempts.set(admission.attemptsKey, { count: count + 1, expiresAtMs: admission.resetAtMs });
      }
    },

    async useAiBudget(limits, consume, ownership) {
      const ts = now();
      if (ownership) {
        const owner = ownership.sessionId
          ? pruneIfExpired(interviewOwners, ownership.sessionId, ts)
          : pruneIfExpired(cvOwners, ownership.ownerKey, ts);
        if (owner?.token !== ownership.token) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      const windows = budgetWindows(ts, limits);
      for (const key of aiBudget.keys()) pruneIfExpired(aiBudget, key, ts);
      const resetAt = budgetDenial(windows, ts);
      if (resetAt) return { allowed: false, resetAt };
      if (consume) for (const { key, end } of windows) {
        aiBudget.set(key, { count: (aiBudget.get(key)?.count ?? 0) + 1, expiresAtMs: end });
      }
      return { allowed: true };
    },

    async claimInterviewGeneration({ session, ipHash, questionNumber }) {
      const ts = now();
      if (ts >= sweepInterviewStateAt) {
        for (const map of [interviewOwners, quotaHolds, interviewAttempts, reservations, quotas]) {
          for (const key of map.keys()) pruneIfExpired(map, key, ts);
        }
        sweepInterviewStateAt = ts + INTERVIEW_ATTEMPT_WINDOW_MS;
      }
      const claim = interviewClaim(session, ipHash, questionNumber, ts);
      const entry = pruneIfExpired(sessions, claim.sessionId, ts);
      if (!entry) return { status: 'expired' };
      if (entry.doc.version !== claim.version) return { status: 'conflict', session: cloneJson(entry.doc) };
      if (pruneIfExpired(interviewOwners, claim.sessionId, ts)) return { status: 'busy' };
      let holds;
      if (claim.start) {
        holds = liveHolds(claim.holdsKey, ts);
        const used = pruneIfExpired(quotas, claim.quotaKey, ts)?.count ?? 0;
        if (used >= DAILY_LIMITS.interviewStart) {
          return { status: 'limited', resetAt: new Date(claim.resetAtMs).toISOString() };
        }
        if (used + holds.size >= DAILY_LIMITS.interviewStart) return { status: 'busy' };
      }
      const day = pruneIfExpired(interviewAttempts, claim.dayKey, ts);
      const step = pruneIfExpired(interviewAttempts, claim.stepKey, ts);
      if (day?.count >= MAX_INTERVIEW_ATTEMPTS_PER_IP_DAY) {
        return { status: 'attempts', resetAt: new Date(day.expiresAtMs).toISOString() };
      }
      if (step?.count >= MAX_INTERVIEW_ATTEMPTS_PER_STEP) {
        return { status: 'attempts', resetAt: new Date(step.expiresAtMs).toISOString() };
      }
      const expiresAtMs = Math.min(entry.expiresAtMs, ts + INTERVIEW_GENERATION_LEASE_MS);
      interviewOwners.set(claim.sessionId, { token: claim.token, expiresAtMs });
      if (holds) {
        addHold(claim.holdsKey, holds, claim.token, expiresAtMs);
      }
      interviewAttempts.set(claim.dayKey, { count: (day?.count ?? 0) + 1, expiresAtMs: claim.resetAtMs });
      interviewAttempts.set(claim.stepKey, {
        count: (step?.count ?? 0) + 1,
        expiresAtMs: step?.expiresAtMs ?? Math.min(entry.expiresAtMs, ts + INTERVIEW_ATTEMPT_WINDOW_MS),
      });
      return { status: 'claimed', claim };
    },

    async finishInterviewGeneration(claim, _session, interview) {
      const ts = now();
      const entry = pruneIfExpired(sessions, claim.sessionId, ts);
      if (!entry) return { status: 'expired' };
      if (entry.doc.version !== claim.version) return { status: 'conflict', session: cloneJson(entry.doc) };
      const owner = pruneIfExpired(interviewOwners, claim.sessionId, ts);
      if (owner?.token !== claim.token) return { status: 'busy' };
      entry.doc = { ...entry.doc, interview: cloneJson(interview), version: entry.doc.version + 1 };
      if (claim.start && ts < claim.resetAtMs) {
        const count = pruneIfExpired(quotas, claim.quotaKey, ts)?.count ?? 0;
        quotas.set(claim.quotaKey, { count: count + 1, expiresAtMs: claim.resetAtMs });
      }
      interviewOwners.delete(claim.sessionId);
      quotaHolds.get(claim.holdsKey)?.holds.delete(claim.token);
      return { status: 'committed' };
    },

    async releaseInterviewGeneration(claim) {
      const owner = pruneIfExpired(interviewOwners, claim.sessionId, now());
      if (owner?.token !== claim.token) return;
      interviewOwners.delete(claim.sessionId);
      quotaHolds.get(claim.holdsKey)?.holds.delete(claim.token);
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

    async recordFeedback(input) {
      const { sessionId, positive, language } = validateFeedbackRequest(input);
      const ts = now();
      if (ts >= sweepFeedbackAttemptsAt) {
        for (const key of feedbackAttempts.keys()) pruneIfExpired(feedbackAttempts, key, ts);
        sweepFeedbackAttemptsAt = ts + FEEDBACK_WINDOW_MS;
      }
      const attempts = pruneIfExpired(feedbackAttempts, input.ipHash, ts)
        ?? { count: 0, expiresAtMs: ts + FEEDBACK_WINDOW_MS };
      if (attempts.count >= MAX_FEEDBACK_ATTEMPTS) throw feedbackRateLimit(attempts.expiresAtMs);
      attempts.count += 1;
      feedbackAttempts.set(input.ipHash, attempts);

      const session = pruneIfExpired(sessions, sessionId, ts);
      if (!session) throw new AppError(ERROR_CODES.SESSION_EXPIRED);
      if (session.feedbackRecorded) return computeFeedbackSummary(feedback);
      session.feedbackRecorded = true;
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
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local holds = KEYS[4]
redis.call('ZREMRANGEBYSCORE', holds, '-inf', now)
local used = tonumber(redis.call('GET', KEYS[1]) or '0') + redis.call('ZCARD', holds)
if KEYS[3] ~= '' then
  local cached = redis.call('GET', KEYS[3])
  if cached then
    return {'CACHED', tostring(used), cached}
  end
  local owner = redis.call('GET', KEYS[3] .. ':owner')
  if owner and redis.call('EXISTS', owner) == 1 then return {'BUSY', tostring(used)} end
end
local resetAt = tonumber(ARGV[2])
if resetAt <= now or resetAt - now > 86400000 then return {'STALE', '0'} end
local limit = tonumber(ARGV[1])
if used >= limit then return {'DENIED', tostring(used)} end
local lease = tonumber(ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'PX', lease)
if KEYS[3] ~= '' then redis.call('SET', KEYS[3] .. ':owner', KEYS[2], 'PX', lease) end
redis.call('ZADD', holds, now + lease, KEYS[2])
if redis.call('PTTL', holds) < lease then redis.call('PEXPIRE', holds, lease) end
return {'ALLOWED', tostring(used + 1)}
`;

const COMMIT_QUOTA_LUA = `
if KEYS[3] ~= '' and redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
local resetAt = tonumber(redis.call('GET', KEYS[1]) or '0')
if resetAt <= 0 then return 0 end
local holds = KEYS[6]
local score = tonumber(redis.call('ZSCORE', holds, KEYS[1]) or '0')
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
if score <= now then return 0 end
if KEYS[8] then
  local ttl = tonumber(ARGV[5]) - now
  if ttl <= 0 then return 0 end
  redis.call('SET', KEYS[8], ARGV[4], 'PX', ttl)
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', holds, KEYS[1])
local dayTtl = resetAt - now
if dayTtl > 0 and redis.call('INCR', KEYS[5]) == 1 then
  redis.call('PEXPIRE', KEYS[5], dayTtl)
end
if KEYS[2] ~= '' and ARGV[1] ~= '' then
  redis.call('SET', KEYS[2], ARGV[1], 'PX', tonumber(ARGV[2]))
end
if KEYS[4] and KEYS[4] ~= '' and ARGV[1] ~= '' then
  redis.call('SET', KEYS[4], ARGV[1], 'PX', tonumber(ARGV[2]))
end
if KEYS[7] ~= '' and KEYS[2] ~= '' and ARGV[1] ~= '' then
  redis.call('SET', KEYS[7], '1', 'PX', tonumber(ARGV[2]))
end
return 1
`;

const READ_AI_BUDGET_LUA = `
local function budgetReset(now, firstKey, firstArg)
  local latest = 0
  for i = 0, 1 do
    local ending = tonumber(ARGV[firstArg + 2 * i])
    local duration = i == 0 and 60000 or 86400000
    if now >= ending or ending - now > duration + 5000 then return nil end
    if tonumber(redis.call('GET', KEYS[firstKey + i]) or '0') >= tonumber(ARGV[firstArg + 2 * i + 1]) then
      latest = math.max(latest, ending)
    end
  end
  return latest
end
`;

const CV_ADMISSION_LUA = `
${READ_AI_BUDGET_LUA}
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local dayTtl = tonumber(ARGV[2]) - now
if KEYS[4] ~= '' then
  local cached = redis.call('GET', KEYS[4])
  if cached then return {'cached', cached} end
end
if dayTtl <= 0 or redis.call('EXISTS', KEYS[1]) == 1 then return {'busy'} end
local committed = tonumber(redis.call('GET', KEYS[3]) or '0')
local mayReplay = KEYS[10] ~= '' and redis.call('EXISTS', KEYS[10]) == 1
local denial = ''
local resetAt = ''
if committed >= tonumber(ARGV[3]) then
  if not mayReplay then return {'limited'} end
  denial = 'limited'
  resetAt = ARGV[2]
end
local quotaHolds = KEYS[9]
redis.call('ZREMRANGEBYSCORE', quotaHolds, '-inf', now)
if denial == '' and committed + redis.call('ZCARD', quotaHolds) >= tonumber(ARGV[3]) then return {'busy'} end
local attempts = tonumber(redis.call('GET', KEYS[2]) or '0')
if attempts >= tonumber(ARGV[4]) then return {denial ~= '' and denial or 'attempts'} end
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
local active = redis.call('ZCARD', KEYS[5])
if active >= tonumber(ARGV[5]) or attempts + active >= tonumber(ARGV[4]) then return {'busy'} end
local reset = budgetReset(now, 6, 7)
if not reset then return {'busy'} end
if denial == '' and reset > 0 then
  if not mayReplay then return {'budget', tostring(reset)} end
  denial = 'budget'
  resetAt = tostring(reset)
end
if tonumber(redis.call('GET', KEYS[8]) or '0') >= tonumber(ARGV[11]) then
  return {'throttled', ARGV[7]}
end
if redis.call('INCR', KEYS[8]) == 1 then redis.call('PEXPIRE', KEYS[8], tonumber(ARGV[7]) - now) end
local lease = tonumber(ARGV[6])
redis.call('SET', KEYS[1], ARGV[1], 'PX', lease)
redis.call('ZADD', KEYS[5], now + lease, ARGV[1])
redis.call('PEXPIRE', KEYS[5], lease)
return {'claimed', tostring(now + lease), denial, resetAt}
`;

const RELEASE_CV_ADMISSION_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  if ARGV[3] == '1' then
    local t = redis.call('TIME')
    local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    local ttl = tonumber(ARGV[2]) - now
    if ttl > 0 and redis.call('INCR', KEYS[3]) == 1 then redis.call('PEXPIRE', KEYS[3], ttl) end
  end
end
return 1
`;

const AI_BUDGET_LUA = `
${READ_AI_BUDGET_LUA}
if KEYS[3] and redis.call('GET', KEYS[3]) ~= ARGV[6] then return {'stale'} end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local latest = budgetReset(now, 1, 2)
if not latest then return {'stale'} end
if latest > 0 then return {'denied', tostring(latest)} end
if ARGV[1] == '1' then
  for i = 1, 2 do
    if redis.call('INCR', KEYS[i]) == 1 then redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[2 * i]) - now) end
  end
end
return {'allowed'}
`;

const RELEASE_QUOTA_LUA = `
if redis.call('DEL', KEYS[1]) == 0 then return 0 end
return redis.call('ZREM', KEYS[2], KEYS[1])
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

// One Redis transaction claims provider work, or fences a commit/release by token.
const INTERVIEW_GENERATION_LUA = `
local operation = ARGV[1]
local token = ARGV[2]
local start = ARGV[5] == '1'
local owner = redis.call('GET', KEYS[2])
local function release()
  redis.call('DEL', KEYS[2])
  if start then redis.call('ZREM', KEYS[4], token) end
end
if operation == 'release' then
  if owner == token then release() end
  return {'released'}
end
local raw = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if (not raw) or ttl <= 0 then return {'expired'} end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local remaining = math.min(ttl, tonumber(ARGV[4]) - now)
if remaining <= 0 then return {'expired'} end
local doc = cjson.decode(raw)
if tostring(doc.version) ~= ARGV[3] then return {'conflict', raw} end
local dayTtl = tonumber(ARGV[6]) - now
if operation == 'finish' then
  if owner ~= token or redis.call('PTTL', KEYS[2]) <= 0 then return {'busy'} end
  redis.call('SET', KEYS[1], ARGV[12], 'KEEPTTL')
  if start and dayTtl > 0 and redis.call('INCR', KEYS[3]) == 1 then
    redis.call('PEXPIRE', KEYS[3], dayTtl)
  end
  release()
  return {'committed'}
end
if owner or dayTtl <= 0 then return {'busy'} end
if start then
  local used = tonumber(redis.call('GET', KEYS[3]) or '0')
  if used >= tonumber(ARGV[7]) then return {'limited', ARGV[6]} end
  redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
  if used + redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[7]) then return {'busy'} end
end
if tonumber(redis.call('GET', KEYS[5]) or '0') >= tonumber(ARGV[8]) then
  return {'attempts', ARGV[6]}
end
if tonumber(redis.call('GET', KEYS[6]) or '0') >= tonumber(ARGV[9]) then
  return {'attempts', tostring(now + math.max(1, redis.call('PTTL', KEYS[6])))}
end
local lease = math.min(remaining, tonumber(ARGV[10]))
redis.call('SET', KEYS[2], token, 'PX', lease)
if start then
  redis.call('ZADD', KEYS[4], now + lease, token)
  if redis.call('PTTL', KEYS[4]) < lease then redis.call('PEXPIRE', KEYS[4], lease) end
end
if redis.call('INCR', KEYS[5]) == 1 then redis.call('PEXPIRE', KEYS[5], dayTtl) end
if redis.call('INCR', KEYS[6]) == 1 then
  redis.call('PEXPIRE', KEYS[6], math.min(remaining, tonumber(ARGV[11])))
end
return {'claimed', tostring(now + lease)}
`;

const RECORD_FEEDBACK_LUA = `
local attempts = tonumber(redis.call('GET', KEYS[4]) or '0')
if attempts >= tonumber(ARGV[3]) then
  return {'limited', redis.call('PTTL', KEYS[4])}
end
if redis.call('INCR', KEYS[4]) == 1 then
  redis.call('PEXPIRE', KEYS[4], ARGV[4])
end

local remaining = redis.call('PTTL', KEYS[2])
if remaining <= 0 then return {'expired'} end
if redis.call('SET', KEYS[3], '1', 'PX', remaining, 'NX') then
  redis.call('HINCRBY', KEYS[1], 'total', 1)
  redis.call('HINCRBY', KEYS[1], ARGV[2] .. 'Total', 1)
  if ARGV[1] == '1' then
    redis.call('HINCRBY', KEYS[1], 'positive', 1)
    redis.call('HINCRBY', KEYS[1], ARGV[2] .. 'Positive', 1)
  end
end
return {'ok', redis.call('HMGET', KEYS[1], 'total', 'positive', 'idTotal', 'idPositive', 'enTotal', 'enPositive')}
`;

export function createUpstashStore({
  url,
  token,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 5000,
} = {}) {
  const checkCvIntake = createCvIntakeLimiter();
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
        redirect: 'error',
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

  async function runInterviewGeneration(operation, claim, nextDoc) {
    const result = await execCommand([
      'EVAL', INTERVIEW_GENERATION_LUA, 6,
      `sess:${claim.sessionId}`, `interview:owner:${claim.sessionId}`,
      claim.quotaKey, claim.holdsKey, claim.dayKey, claim.stepKey,
      operation, claim.token, String(claim.version), String(claim.deadline),
      claim.start ? '1' : '0', String(claim.resetAtMs), String(DAILY_LIMITS.interviewStart),
      String(MAX_INTERVIEW_ATTEMPTS_PER_IP_DAY), String(MAX_INTERVIEW_ATTEMPTS_PER_STEP),
      String(INTERVIEW_GENERATION_LEASE_MS), String(INTERVIEW_ATTEMPT_WINDOW_MS),
      nextDoc ? JSON.stringify(nextDoc) : '',
    ]);
    if (Array.isArray(result)) {
      const [status, payload] = result;
      if (status === 'claimed' && operation === 'claim') {
        const expiresAt = Number(payload);
        if (Number.isFinite(expiresAt)) return now() < expiresAt ? { status, claim } : { status: 'busy' };
      }
      if (status === 'committed' || status === 'released' || status === 'busy' || status === 'expired') return { status };
      if (status === 'limited' || status === 'attempts') {
        const resetAt = new Date(Number(payload));
        if (Number.isFinite(resetAt.getTime())) return { status, resetAt: resetAt.toISOString() };
      }
      if (status === 'conflict' && typeof payload === 'string') {
        try {
          return { status, session: JSON.parse(payload) };
        } catch {
          // Invalid store data is reported as an outage.
        }
      }
    }
    throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
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
      const reservationId = `resv_${randomUUID()}.${quotaKey}`;
      const [resvKey, , holdsKey] = redisReservationKeys(reservationId);
      const idemKey = reqId && ipHash ? `idem:${action}:${ipHash}:${reqId}` : '';

      const res = await execCommand([
        'EVAL',
        RESERVE_QUOTA_LUA,
        4,
        quotaKey,
        resvKey,
        idemKey,
        holdsKey,
        String(limit),
        String(window.resetAtMs),
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

      if (status !== 'ALLOWED') throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
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

    async commitQuota({ reservationId, action, ipHash, requestId, result, admission, session, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS }) {
      const reservationKeys = redisReservationKeys(reservationId);
      if (!reservationKeys) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      const [resvKey, quotaKey, holdsKey] = reservationKeys;
      const reqId = normalizeRequestId(requestId);
      const idemKey = reqId && ipHash && result !== undefined ? `idem:${action}:${ipHash}:${reqId}` : '';
      const replayKey = admission?.replayKey && result !== undefined ? admission.replayKey : '';
      const serialized = result !== undefined && (idemKey || replayKey) ? JSON.stringify(result) : '';

      const keys = [resvKey, idemKey, admission?.ownerKey ?? '', replayKey, quotaKey, holdsKey, admission?.logicalKey ?? ''];
      const args = [serialized, String(ttlMs), admission?.token ?? ''];
      if (session) {
        keys.push(`sess:${session.sessionId}`);
        args.push(JSON.stringify(session), String(Date.parse(session.expiresAt)));
      }
      const committed = await execCommand(['EVAL', COMMIT_QUOTA_LUA, keys.length, ...keys, ...args]);
      if (Number(committed) !== 1) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      return true;
    },

    async releaseQuota(reservation) {
      const reservationId =
        typeof reservation === 'string' ? reservation : reservation?.reservationId;
      const reservationKeys = redisReservationKeys(reservationId);
      if (!reservationKeys) return false;
      const [resvKey, , holdsKey] = reservationKeys;
      const released = await execCommand(['EVAL', RELEASE_QUOTA_LUA, 2, resvKey, holdsKey]);
      return Number(released) === 1;
    },

    async createSession(data, { deferUntilCommit = false } = {}) {
      const ts = now();
      const sessionId = generateSessionId();
      const expiresAtMs = ts + SESSION_TTL_MS;
      const doc = sanitizeSessionData(data, ts, expiresAtMs, sessionId);
      if (!deferUntilCommit) await execCommand(['SET', `sess:${sessionId}`, JSON.stringify(doc), 'PX', String(SESSION_TTL_MS)]);
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

    async claimCvAdmission(input) {
      const ts = now();
      const throttled = checkCvIntake(input.ipHash, ts);
      if (throttled) return throttled;
      const admission = cvAdmission(input, ts);
      const windows = budgetWindows(ts, input.limits);
      const result = await execCommand([
        'EVAL', CV_ADMISSION_LUA, 10,
        admission.ownerKey, admission.attemptsKey, admission.quotaKey, admission.replayKey, admission.activeKey,
        ...windows.map(({ key }) => key), admission.intakeKey, `${admission.quotaKey}:holds`, admission.logicalKey,
        admission.token, String(admission.resetAtMs), String(DAILY_LIMITS.analyze),
        String(MAX_CV_ADMISSIONS_PER_IP_DAY), String(MAX_ACTIVE_CV_PER_IP), String(CV_ADMISSION_LEASE_MS),
        ...windows.flatMap(({ end, limit }) => [String(end), String(limit)]), String(MAX_CV_REQUESTS_PER_IP_MINUTE),
      ]);
      if (Array.isArray(result)) {
        const [status, payload, denialStatus, resetAtMs] = result;
        if (status === 'claimed') {
          if (now() >= Number(payload)) return { status: 'busy' };
          const denial = denialStatus ? { status: denialStatus, resetAt: new Date(Number(resetAtMs)).toISOString() } : null;
          return { status, admission, denial };
        }
        if (status === 'busy' || status === 'limited' || status === 'attempts') return { status, resetAt: admission.resetAt };
        if ((status === 'budget' || status === 'throttled') && Number.isFinite(Number(payload))) {
          return { status, resetAt: new Date(Number(payload)).toISOString() };
        }
        if (status === 'cached') {
          try { return { status, result: JSON.parse(payload) }; } catch { /* Invalid store response. */ }
        }
      }
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    },

    async releaseCvAdmission(admission, charge = true) {
      await execCommand([
        'EVAL', RELEASE_CV_ADMISSION_LUA, 3, admission.ownerKey, admission.activeKey, admission.attemptsKey,
        admission.token, String(admission.resetAtMs), charge ? '1' : '0',
      ]);
    },

    async useAiBudget(limits, consume, ownership) {
      const windows = budgetWindows(now(), limits);
      const keys = windows.map(({ key }) => key);
      if (ownership) keys.push(ownership.ownerKey ?? `interview:owner:${ownership.sessionId}`);
      const result = await execCommand([
        'EVAL', AI_BUDGET_LUA, keys.length, ...keys,
        consume ? '1' : '0', ...windows.flatMap(({ end, limit }) => [String(end), String(limit)]),
        ...(ownership ? [ownership.token] : []),
      ]);
      if (Array.isArray(result)) {
        if (result[0] === 'allowed') return { allowed: true };
        if (result[0] === 'denied' && Number.isFinite(Number(result[1]))) {
          return { allowed: false, resetAt: new Date(Number(result[1])).toISOString() };
        }
      }
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    },

    async claimInterviewGeneration({ session, ipHash, questionNumber }) {
      const ts = now();
      const claim = interviewClaim(session, ipHash, questionNumber, ts);
      if (!Number.isFinite(claim.deadline) || ts >= claim.deadline) return { status: 'expired' };
      return runInterviewGeneration('claim', claim);
    },

    async finishInterviewGeneration(claim, session, interview) {
      if (now() >= claim.deadline) return { status: 'expired' };
      const nextDoc = { ...session, interview, version: claim.version + 1 };
      return runInterviewGeneration('finish', claim, nextDoc);
    },

    async releaseInterviewGeneration(claim) {
      await runInterviewGeneration('release', claim);
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

    async recordFeedback(input) {
      const { sessionId, positive, language } = validateFeedbackRequest(input);
      const arr = await execCommand([
        'EVAL',
        RECORD_FEEDBACK_LUA,
        4,
        'stats:feedback',
        `sess:${sessionId}`,
        `feedback:voted:${sessionId}`,
        `feedback:attempts:${input.ipHash}`,
        positive ? '1' : '0',
        language,
        String(MAX_FEEDBACK_ATTEMPTS),
        String(FEEDBACK_WINDOW_MS),
      ]);
      if (arr?.[0] === 'expired') throw new AppError(ERROR_CODES.SESSION_EXPIRED);
      if (arr?.[0] === 'limited' && Number.isFinite(arr[1]) && arr[1] >= 0) {
        throw feedbackRateLimit(now() + arr[1]);
      }
      if (arr?.[0] !== 'ok' || !Array.isArray(arr[1]) || arr[1].length !== 6) {
        throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      const [, vals] = arr;
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
  const env = opts.env ?? process.env;
  const hasExplicitOpts = 'url' in opts || 'token' in opts;
  const url = hasExplicitOpts ? opts.url : env.UPSTASH_REDIS_REST_URL;
  const token = hasExplicitOpts ? opts.token : env.UPSTASH_REDIS_REST_TOKEN;

  const hasUrl = typeof url === 'string' && url.trim().length > 0;
  const hasToken = typeof token === 'string' && token.trim().length > 0;

  if (productionRuntime(env)) {
    let endpoint;
    try { endpoint = new URL(url); } catch { /* Invalid endpoint. */ }
    if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash || !hasToken || (env.QUOTA_HMAC_SECRET?.trim().length ?? 0) < 32
      || env.VERCEL !== '1') {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    }
  }
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
  const configSignature = createHash('sha256').update(JSON.stringify([
    productionRuntime(process.env), process.env.VERCEL, url, token, process.env.QUOTA_HMAC_SECRET,
  ])).digest('hex');

  if (
    !globalThis.__latihKerjaStore ||
    globalThis.__latihKerjaStoreSig !== configSignature
  ) {
    globalThis.__latihKerjaStore = createStore();
    globalThis.__latihKerjaStoreSig = configSignature;
  }

  return globalThis.__latihKerjaStore;
}
