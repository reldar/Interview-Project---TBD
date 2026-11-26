import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, DAILY_LIMITS, ERROR_CODES, SESSION_TTL_SECONDS } from '../lib/contracts.js';
import {
  createMemoryStore,
  createStore,
  createUpstashStore,
  deriveIpHash,
  getJakartaDayWindow,
} from '../lib/store.js';

describe('Session TTL, Isolation & Update Invariants — createMemoryStore', () => {
  it('enforces fixed 90-minute session TTL (5400s): readable at +89m, expired at +90m', async () => {
    assert.equal(SESSION_TTL_SECONDS, 5400);

    let nowMs = Date.parse('2026-11-25T03:00:00.000Z'); // 10:00 WIB
    const store = createMemoryStore({ now: () => nowMs });

    const created = await store.createSession({
      language: 'en',
      sanitizedCvText: 'Built Python scripts. Contact sample@example.com',
      sanitizedJd: 'Python required. Call 0812-3456-7890',
      analysis: { atsScore: 70, matchedKeywords: ['Python'], missingKeywords: [], rewrites: [] },
    });

    assert.ok(created.sessionId.startsWith('sess_'));
    assert.equal(created.version, 1);
    assert.equal(Date.parse(created.expiresAt), nowMs + 90 * 60 * 1000);
    assert.ok(!created.sanitizedCvText.includes('sample@example.com'));
    assert.ok(!created.sanitizedJd.includes('0812-3456-7890'));

    // At t0 + 89 minutes -> still readable
    nowMs += 89 * 60 * 1000;
    const at89 = await store.getSession(created.sessionId);
    assert.ok(at89);
    assert.equal(at89.sessionId, created.sessionId);
    assert.equal(at89.expiresAt, created.expiresAt);

    // At t0 + 90 minutes -> expired
    nowMs += 60 * 1000;
    const at90 = await store.getSession(created.sessionId);
    assert.equal(at90, null);
  });

  it('isolates two concurrent sessions completely', async () => {
    let nowMs = Date.parse('2026-11-25T03:00:00.000Z');
    const store = createMemoryStore({ now: () => nowMs });

    const sessA = await store.createSession({
      language: 'en',
      sanitizedCvText: 'Candidate A Python CV',
      sanitizedJd: 'Role A',
      analysis: { atsScore: 65, matchedKeywords: ['Python'], missingKeywords: ['SQL'], rewrites: [] },
    });
    nowMs += 20 * 60 * 1000;
    const sessB = await store.createSession({
      language: 'id',
      sanitizedCvText: 'Candidate B Excel CV',
      sanitizedJd: 'Role B',
      analysis: { atsScore: 80, matchedKeywords: ['Excel'], missingKeywords: [], rewrites: [] },
    });

    assert.notEqual(sessA.sessionId, sessB.sessionId);

    // Advance so sessA expires (+95m from t0), while sessB still has 15m left
    nowMs = Date.parse('2026-11-25T03:00:00.000Z') + 95 * 60 * 1000;
    assert.equal(await store.getSession(sessA.sessionId), null);
    const liveB = await store.getSession(sessB.sessionId);
    assert.ok(liveB);
    assert.equal(liveB.language, 'id');
    assert.equal(liveB.analysis.atsScore, 80);
  });

  it('updateSession preserves original expiresAt, rejects version conflicts, and refuses to recreate expired sessions', async () => {
    const t0 = Date.parse('2026-11-25T03:00:00.000Z');
    let nowMs = t0;
    const store = createMemoryStore({ now: () => nowMs });

    const created = await store.createSession({
      language: 'en',
      sanitizedCvText: 'Built Python scripts.',
      sanitizedJd: 'Python intern.',
      analysis: { atsScore: 70, matchedKeywords: ['Python'], missingKeywords: [], rewrites: [] },
    });

    // Update at t0 + 40m -> expiresAt MUST stay t0 + 90m (not extended!)
    nowMs = t0 + 40 * 60 * 1000;
    const updated = await store.updateSession(created.sessionId, 1, {
      interview: { mode: 'hrd', currentQuestion: 1 },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.session.version, 2);
    assert.equal(updated.session.expiresAt, created.expiresAt);

    // Stale version -> QUESTION_CONFLICT
    const conflict = await store.updateSession(created.sessionId, 1, {
      interview: { mode: 'user', currentQuestion: 2 },
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, ERROR_CODES.QUESTION_CONFLICT);
    assert.equal(conflict.session.version, 2);
    assert.equal(conflict.session.interview.mode, 'hrd');

    // Advance to t0 + 90m -> expired despite update at +40m; updateSession must NOT recreate
    nowMs = t0 + 90 * 60 * 1000;
    const expiredUpdate = await store.updateSession(created.sessionId, 2, {
      interview: { mode: 'hrd', currentQuestion: 2 },
    });
    assert.equal(expiredUpdate.ok, false);
    assert.equal(expiredUpdate.code, ERROR_CODES.SESSION_EXPIRED);
    assert.equal(await store.getSession(created.sessionId), null);
  });
});

describe('Daily Quotas, Concurrency, Idempotency & Jakarta Reset — createMemoryStore', () => {
  it('enforces independent daily caps (analyze=5, interviewStart=3) and session expiry does not replenish them', async () => {
    assert.equal(DAILY_LIMITS.analyze, 5);
    assert.equal(DAILY_LIMITS.interviewStart, 3);

    const t0 = Date.parse('2026-11-25T03:00:00.000Z'); // 10:00 WIB
    let nowMs = t0;
    const store = createMemoryStore({ now: () => nowMs });
    const ipHash = deriveIpHash('203.0.113.10', 'unit-test-secret');
    assert.match(ipHash, /^[a-f0-9]{64}$/);
    assert.ok(!ipHash.includes('203.0.113.10'));

    const sess = await store.createSession({
      language: 'en',
      sanitizedCvText: 'Python CV',
      sanitizedJd: 'Python JD',
      analysis: { atsScore: 70, matchedKeywords: ['Python'], missingKeywords: [], rewrites: [] },
    });

    // Exhaust 5 analyses
    for (let i = 1; i <= 5; i += 1) {
      const r = await store.reserveQuota({ action: 'analyze', ipHash });
      assert.equal(r.allowed, true);
      assert.equal(r.count, i);
      assert.equal(r.remaining, 5 - i);
      await store.commitQuota({ reservationId: r.reservationId, action: 'analyze', ipHash });
    }
    const sixthAnalyze = await store.reserveQuota({ action: 'analyze', ipHash });
    assert.equal(sixthAnalyze.allowed, false);
    assert.equal(sixthAnalyze.count, 5);
    assert.equal(sixthAnalyze.remaining, 0);

    // All 3 interview starts are still available!
    for (let i = 1; i <= 3; i += 1) {
      const r = await store.reserveQuota({ action: 'interviewStart', ipHash });
      assert.equal(r.allowed, true);
      assert.equal(r.count, i);
      await store.commitQuota({ reservationId: r.reservationId, action: 'interviewStart', ipHash });
    }
    const fourthStart = await store.reserveQuota({ action: 'interviewStart', ipHash });
    assert.equal(fourthStart.allowed, false);

    // Expire session (+91 minutes, still same Jakarta calendar day 11:31 WIB)
    nowMs = t0 + 91 * 60 * 1000;
    assert.equal(await store.getSession(sess.sessionId), null);

    // Neither daily allowance is replenished by session expiry
    assert.equal((await store.reserveQuota({ action: 'analyze', ipHash })).allowed, false);
    assert.equal((await store.reserveQuota({ action: 'interviewStart', ipHash })).allowed, false);
  });

  it('handles 8 simultaneous reserveQuota calls when 3 of 5 slots are used (exactly 2 succeed, 6 denied)', async () => {
    const store = createMemoryStore({ now: () => Date.parse('2026-11-25T05:00:00.000Z') });
    const ipHash = deriveIpHash('203.0.113.20', 'unit-test-secret');

    for (let i = 0; i < 3; i += 1) {
      const r = await store.reserveQuota({ action: 'analyze', ipHash });
      assert.equal(r.allowed, true);
      await store.commitQuota({ reservationId: r.reservationId, action: 'analyze', ipHash });
    }

    const burst = await Promise.all(
      Array.from({ length: 8 }, () => store.reserveQuota({ action: 'analyze', ipHash }))
    );

    const allowed = burst.filter((r) => r.allowed);
    const denied = burst.filter((r) => !r.allowed);
    assert.equal(allowed.length, 2);
    assert.equal(denied.length, 6);
    assert.deepEqual(
      allowed.map((r) => r.count).sort((a, b) => a - b),
      [4, 5]
    );
  });

  it('releases reserved slots on failure and replays cached commitQuota results without incrementing count', async () => {
    const store = createMemoryStore({ now: () => Date.parse('2026-11-25T05:00:00.000Z') });
    const ipHash = deriveIpHash('203.0.113.30', 'unit-test-secret');

    // Reserve and release on failure
    const r1 = await store.reserveQuota({ action: 'analyze', ipHash, requestId: 'req-fail-1' });
    assert.equal(r1.allowed, true);
    assert.equal(r1.count, 1);
    assert.equal(await store.releaseQuota(r1), true);
    assert.equal(await store.releaseQuota(r1), false); // double release is no-op

    // Next reservation reuses slot 1
    const r2 = await store.reserveQuota({ action: 'analyze', ipHash, requestId: 'req-ok-1' });
    assert.equal(r2.allowed, true);
    assert.equal(r2.count, 1);

    const cachedPayload = { sessionId: 'sess_replay_1', atsScore: 77, matchedKeywords: ['SQL'], missingKeywords: [], rewrites: [] };
    await store.commitQuota({
      reservationId: r2.reservationId,
      action: 'analyze',
      ipHash,
      requestId: 'req-ok-1',
      result: cachedPayload,
    });

    // Replay same requestId -> returns cached payload without incrementing count
    const replay = await store.reserveQuota({ action: 'analyze', ipHash, requestId: 'req-ok-1' });
    assert.equal(replay.allowed, true);
    assert.equal(replay.reservationId, null);
    assert.equal(replay.count, 1);
    assert.deepEqual(replay.cached, cachedPayload);
  });

  it('resets daily counter across Asia/Jakarta midnight (23:59:30 WIB -> 00:00:05 WIB)', async () => {
    let nowMs = Date.parse('2026-11-25T16:59:30.000Z'); // 2026-11-25 23:59:30 WIB
    const store = createMemoryStore({ now: () => nowMs });
    const ipHash = deriveIpHash('203.0.113.40', 'unit-test-secret');

    const wBefore = getJakartaDayWindow(nowMs);
    assert.equal(wBefore.dateKey, '2026-11-25');
    assert.equal(wBefore.resetAt, '2026-11-25T17:00:00.000Z');

    for (let i = 0; i < 5; i += 1) {
      const r = await store.reserveQuota({ action: 'analyze', ipHash });
      assert.equal(r.allowed, true);
      await store.commitQuota({ reservationId: r.reservationId, action: 'analyze', ipHash });
    }
    const deniedBeforeMidnight = await store.reserveQuota({ action: 'analyze', ipHash });
    assert.equal(deniedBeforeMidnight.allowed, false);
    assert.equal(deniedBeforeMidnight.resetAt, '2026-11-25T17:00:00.000Z');

    // Advance 35 seconds to 2026-11-26 00:00:05 WIB (17:00:05Z)
    nowMs = Date.parse('2026-11-25T17:00:05.000Z');
    const afterMidnight = await store.reserveQuota({ action: 'analyze', ipHash });
    assert.equal(afterMidnight.allowed, true);
    assert.equal(afterMidnight.count, 1);
    assert.equal(afterMidnight.remaining, 4);
    assert.equal(afterMidnight.dateKey, '2026-11-26');
    assert.equal(afterMidnight.resetAt, '2026-11-26T17:00:00.000Z');
  });

  it('records aggregate feedback counts only (positive, total, byLanguage, satisfactionRate)', async () => {
    const store = createMemoryStore();
    const initial = await store.getFeedbackSummary();
    assert.deepEqual(initial, {
      positive: 0,
      total: 0,
      satisfactionRate: null,
      byLanguage: {
        id: { positive: 0, total: 0 },
        en: { positive: 0, total: 0 },
      },
    });

    await store.recordFeedback({ positive: true, language: 'id' });
    await store.recordFeedback({ positive: true, language: 'en' });
    const summary = await store.recordFeedback({ positive: false, language: 'id' });

    assert.deepEqual(summary, {
      positive: 2,
      total: 3,
      satisfactionRate: 66.7,
      byLanguage: {
        id: { positive: 1, total: 2 },
        en: { positive: 1, total: 1 },
      },
    });
    assert.deepEqual(await store.getFeedbackSummary(), summary);

    await assert.rejects(
      () => store.recordFeedback({ positive: 'yes', language: 'id' }),
      (err) => err instanceof AppError && err.code === ERROR_CODES.INVALID_INPUT && err.status === 400
    );
  });
});

describe('Upstash REST Adapter — createUpstashStore', () => {
  it('sends Bearer auth, issues atomic EVAL Lua commands, and handles CACHED/ALLOWED/DENIED/CAS responses', async () => {
    const calls = [];
    const responses = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, method: init.method, headers: init.headers, command: body });
      const next = responses.shift();
      return {
        ok: true,
        status: 200,
        async json() {
          return next;
        },
      };
    };

    const nowMs = Date.parse('2026-11-25T05:00:00.000Z');
    const store = createUpstashStore({
      url: 'https://fake.upstash.io/',
      token: 'secret-upstash-token',
      fetchImpl,
      now: () => nowMs,
    });
    assert.equal(store.backend, 'upstash');

    // 1. reserveQuota -> ALLOWED
    responses.push({ result: ['ALLOWED', '1'] });
    const allowed = await store.reserveQuota({ action: 'analyze', ipHash: 'hash1', requestId: 'req-1' });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.count, 1);
    assert.ok(allowed.reservationId.startsWith('resv_'));
    assert.equal(calls[0].url, 'https://fake.upstash.io');
    assert.equal(calls[0].headers.authorization, 'Bearer secret-upstash-token');
    assert.equal(calls[0].command[0], 'EVAL');

    // 2. reserveQuota -> CACHED
    const cachedObj = { sessionId: 'sess_upstash_1', atsScore: 81 };
    responses.push({ result: ['CACHED', '1', JSON.stringify(cachedObj)] });
    const cached = await store.reserveQuota({ action: 'analyze', ipHash: 'hash1', requestId: 'req-1' });
    assert.equal(cached.allowed, true);
    assert.equal(cached.reservationId, null);
    assert.deepEqual(cached.cached, cachedObj);

    // 3. reserveQuota -> DENIED
    responses.push({ result: ['DENIED', '5'] });
    const denied = await store.reserveQuota({ action: 'analyze', ipHash: 'hash1' });
    assert.equal(denied.allowed, false);
    assert.equal(denied.remaining, 0);

    // 4. commitQuota + releaseQuota -> EVAL
    responses.push({ result: 1 });
    assert.equal(
      await store.commitQuota({ reservationId: allowed.reservationId, action: 'analyze', ipHash: 'hash1', requestId: 'req-1', result: cachedObj }),
      true
    );
    assert.equal(calls[3].command[0], 'EVAL');

    responses.push({ result: 0 });
    assert.equal(await store.releaseQuota(allowed.reservationId), false);
    assert.equal(calls[4].command[0], 'EVAL');

    // 5. updateSession -> GET + EVAL CAS (OK, QUESTION_CONFLICT, SESSION_EXPIRED)
    const sessionDoc = {
      sessionId: 'sess_u1',
      version: 1,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString(),
      language: 'en',
      sanitizedCvText: 'CV',
      sanitizedJd: 'JD',
      analysis: {},
      interview: null,
    };

    // OK
    responses.push({ result: JSON.stringify(sessionDoc) });
    responses.push({ result: ['OK', '5000000'] });
    const okUpd = await store.updateSession('sess_u1', 1, { interview: { q: 1 } });
    assert.equal(okUpd.ok, true);
    assert.equal(okUpd.session.version, 2);
    assert.equal(okUpd.session.expiresAt, sessionDoc.expiresAt);
    assert.equal(calls[calls.length - 1].command[0], 'EVAL');

    // QUESTION_CONFLICT from CAS Lua
    const newerDoc = { ...sessionDoc, version: 2 };
    responses.push({ result: JSON.stringify(sessionDoc) });
    responses.push({ result: ['ERR', 'QUESTION_CONFLICT', JSON.stringify(newerDoc)] });
    const conflictUpd = await store.updateSession('sess_u1', 1, { interview: { q: 2 } });
    assert.equal(conflictUpd.ok, false);
    assert.equal(conflictUpd.code, ERROR_CODES.QUESTION_CONFLICT);
    assert.equal(conflictUpd.session.version, 2);

    // SESSION_EXPIRED from CAS Lua
    responses.push({ result: JSON.stringify(sessionDoc) });
    responses.push({ result: ['ERR', 'SESSION_EXPIRED'] });
    const expiredUpd = await store.updateSession('sess_u1', 1, { interview: { q: 2 } });
    assert.equal(expiredUpd.ok, false);
    assert.equal(expiredUpd.code, ERROR_CODES.SESSION_EXPIRED);

    // 6. recordFeedback -> EVAL
    responses.push({ result: ['4', '3', '2', '2', '2', '1'] });
    const fb = await store.recordFeedback({ positive: true, language: 'id' });
    assert.equal(calls[calls.length - 1].command[0], 'EVAL');
    assert.deepEqual(fb, {
      positive: 3,
      total: 4,
      satisfactionRate: 75,
      byLanguage: {
        id: { positive: 2, total: 2 },
        en: { positive: 1, total: 2 },
      },
    });
  });

  it('fails closed with 503 TEMPORARILY_UNAVAILABLE on network error, HTTP 500, Redis error payload, or partial config', async () => {
    const assert503 = async (fn) => {
      await assert.rejects(
        fn,
        (err) => err instanceof AppError && err.status === 503 && err.code === ERROR_CODES.TEMPORARILY_UNAVAILABLE
      );
    };

    const throwingStore = createUpstashStore({
      url: 'https://fake.upstash.io',
      token: 'tok',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await assert503(() => throwingStore.reserveQuota({ action: 'analyze', ipHash: 'h1' }));

    const http500Store = createUpstashStore({
      url: 'https://fake.upstash.io',
      token: 'tok',
      fetchImpl: async () => ({ ok: false, status: 500, async json() { return {}; } }),
    });
    await assert503(() => http500Store.getSession('sess_abc'));

    const redisErrStore = createUpstashStore({
      url: 'https://fake.upstash.io',
      token: 'tok',
      fetchImpl: async () => ({ ok: true, status: 200, async json() { return { error: 'ERR NOSCRIPT' }; } }),
    });
    await assert503(() => redisErrStore.reserveQuota({ action: 'analyze', ipHash: 'h1' }));

    const partialStore = createStore({ url: 'https://fake.upstash.io', token: '' });
    assert.equal(partialStore.backend, 'upstash');
    await assert503(() => partialStore.getFeedbackSummary());
  });
});
