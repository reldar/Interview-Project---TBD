import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleInterviewStart } from '../app/api/interview/start/route.js';
import { INTERVIEW_FIXTURES } from '../lib/interview-fixtures.js';
import { logRouteEvent } from '../lib/logger.js';
import { createMemoryStore, createUpstashStore, deriveIpHash } from '../lib/store.js';

const url = 'http://localhost/api/interview/start';
const ipHash = deriveIpHash(new Request(url));
const mode = 'hrd';
const language = 'en';

function submit(store, provider, body, logger = () => {}) {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify({ mode, language, ...body }),
  });
  return handleInterviewStart(request, { store, provider, logger });
}

const createSession = (store) => store.createSession(INTERVIEW_FIXTURES);
const stub = (fixture = INTERVIEW_FIXTURES.hrd.en) => ({
  async generateStructuredResponse() {
    return JSON.stringify(fixture);
  },
});

for (const interviewMode of ['hrd', 'user']) {
  for (const interviewLanguage of ['id', 'en']) {
    test(`starts ${interviewMode}/${interviewLanguage}, returns Q1 only and stores five questions`, async () => {
      const store = createMemoryStore();
      const session = await createSession(store);
      const fixture = INTERVIEW_FIXTURES[interviewMode][interviewLanguage];
      const response = await submit(store, stub(fixture), {
        sessionId: session.sessionId,
        mode: interviewMode,
        language: interviewLanguage,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), fixture.questions[0]);
      const saved = await store.getSession(session.sessionId);
      assert.deepEqual(saved.interview, {
        mode: interviewMode,
        language: interviewLanguage,
        currentQuestion: 1,
        questions: fixture.questions,
      });
      assert.equal(saved.expiresAt, session.expiresAt);
      assert.equal(saved.version, session.version + 1);
    });
  }
}

test('competing modes and retries converge on the committed question and charge once', async () => {
  const store = createMemoryStore();
  const { sessionId } = await createSession(store);
  let beginSlow;
  let finishSlow;
  const slowStarted = new Promise((resolve) => { beginSlow = resolve; });
  const slowResult = new Promise((resolve) => { finishSlow = resolve; });
  const slow = submit(store, {
    generateStructuredResponse() {
      beginSlow();
      return slowResult;
    },
  }, { sessionId });
  await slowStarted;
  const winner = await submit(store, stub(INTERVIEW_FIXTURES.user.id), {
    sessionId, mode: 'user', language: 'id',
  });
  finishSlow(JSON.stringify(INTERVIEW_FIXTURES.hrd.en));
  const loser = await slow;
  const retry = await submit(store, {
    generateStructuredResponse() { assert.fail('a replay must skip generation'); },
  }, { sessionId });
  const question = INTERVIEW_FIXTURES.user.id.questions[0];
  for (const response of [winner, loser, retry]) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), question);
  }
  assert.equal((await store.getSession(sessionId)).interview.mode, 'user');
  const hold = await store.reserveQuota({ action: 'interviewStart', ipHash });
  assert.equal(hold.count, 2);
});

test('invalid JSON, invalid settings and missing sessions fail before generation', async () => {
  const store = createMemoryStore();
  const provider = { generateStructuredResponse() { assert.fail('unexpected model call'); } };
  const cases = [
    ['{invalid', 400, { code: 'INVALID_INPUT', field: 'body' }],
    [{ sessionId: 'invalid' }, 400, { code: 'INVALID_INPUT', field: 'sessionId' }],
    [{ sessionId: 'sess_example', mode: 'invalid' }, 400, { code: 'INVALID_INPUT', field: 'mode' }],
    [{ sessionId: 'sess_example' }, 410, { code: 'SESSION_EXPIRED' }],
  ];
  for (const [body, status, error] of cases) {
    const response = await submit(store, provider, body);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
});

test('invalid model output and provider failures leave the session and quota available for retry', async () => {
  const store = createMemoryStore();
  const session = await createSession(store);
  const { sessionId } = session;
  for (const generateStructuredResponse of [
    () => '{invalid',
    () => '{"questions":[]}',
    () => { throw new Error('internal provider key: test-secret'); },
  ]) {
    const response = await submit(store, { generateStructuredResponse }, { sessionId });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'TEMPORARILY_UNAVAILABLE' } });
    assert.deepEqual(await store.getSession(sessionId), session);
  }
  const retry = await submit(store, stub(), { sessionId });
  assert.equal(retry.status, 200);
  assert.equal((await store.reserveQuota({ action: 'interviewStart', ipHash })).count, 2);
});

test('the separate interview quota blocks new generation, while a replay at the limit still returns Q1', async () => {
  const store = createMemoryStore();
  const sessions = await Promise.all(Array.from({ length: 4 }, () => createSession(store)));
  for (const { sessionId } of sessions.slice(0, 3)) {
    assert.equal((await submit(store, stub(), { sessionId })).status, 200);
  }
  let calls = 0;
  const provider = { generateStructuredResponse() { calls += 1; return '{}'; } };
  const denied = await submit(store, provider, { sessionId: sessions[3].sessionId });
  assert.equal(denied.status, 429);
  const { error } = await denied.json();
  assert.equal(error.code, 'QUOTA_REACHED');
  assert.equal(error.action, 'interviewStart');
  assert.ok(Number.isFinite(Date.parse(error.resetAt)));
  assert.equal((await submit(store, provider, { sessionId: sessions[0].sessionId })).status, 200);
  assert.equal(calls, 0);
  assert.equal((await store.reserveQuota({ action: 'analyze', ipHash })).count, 1);
});

test('overlapping new sessions cannot both use the last interview allowance', async () => {
  const store = createMemoryStore();
  const sessions = await Promise.all(Array.from({ length: 4 }, () => createSession(store)));
  for (const { sessionId } of sessions.slice(0, 2)) {
    assert.equal((await submit(store, stub(), { sessionId })).status, 200);
  }
  const responses = await Promise.all(
    sessions.slice(2).map(({ sessionId }) => submit(store, stub(), { sessionId })),
  );
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 429]);
  const saved = await Promise.all(sessions.slice(2).map(({ sessionId }) => store.getSession(sessionId)));
  assert.equal(saved.filter(({ interview }) => interview).length, 1);
});

test('generation crossing the original session expiry cannot commit or charge quota', async () => {
  let now = Date.parse('2026-11-25T08:00:00Z');
  const store = createMemoryStore({ now: () => now });
  const session = await createSession(store);
  now = Date.parse(session.expiresAt) - 1;
  const response = await submit(store, {
    generateStructuredResponse() {
      now += 1;
      return JSON.stringify(INTERVIEW_FIXTURES.hrd.en);
    },
  }, { sessionId: session.sessionId });
  assert.equal(response.status, 410);
  assert.equal(await store.getSession(session.sessionId), null);
  assert.equal((await store.reserveQuota({ action: 'interviewStart', ipHash })).count, 1);
});

test('synthetic identifiers are masked before generation and before data reaches storage or HTTP', async () => {
  const store = createMemoryStore();
  const email = 'candidate@example.org';
  const phone = '+62 812-3456-7890';
  const nik = '3174012345678901';
  const address = 'Jl. Melati No. 10';
  const session = await store.createSession({
    sanitizedCvText: `Python reports\nEmail: ${email}\nPhone: ${phone}`,
    sanitizedJd: `SQL internship\nNIK: ${nik}\nAddress: ${address}`,
  });
  const traces = [];
  const { questions } = INTERVIEW_FIXTURES.hrd.en;
  const provider = {
    generateStructuredResponse({ userPrompt }) {
      traces.push(userPrompt);
      return JSON.stringify({
        questions: [
          { ...questions[0], questionText: `How did you share reports with ${email}?`, focusArea: `Phone: ${phone}` },
          { ...questions[1], focusArea: `NIK: ${nik}` },
          { ...questions[2], focusArea: `Address: ${address}` },
          ...questions.slice(3),
        ],
      });
    },
  };
  const response = await submit(store, provider, { sessionId: session.sessionId }, (entry) => {
    logRouteEvent({ ...entry, sink: (line) => traces.push(line) });
  });
  assert.equal(response.status, 200);
  traces.push(await response.text(), JSON.stringify((await store.getSession(session.sessionId)).interview));
  const trace = traces.join('\n');
  for (const secret of [email, phone, nik, address, session.sessionId]) {
    assert.ok(!trace.includes(secret), `unexpected raw value: ${secret}`);
  }
  for (const type of ['EMAIL', 'PHONE', 'IDENTITY', 'ADDRESS']) {
    assert.ok(trace.includes(`[${type}_REDACTED]`));
  }
});

test('Upstash commits through one conditional operation and a lost response can be retried', async () => {
  let now = Date.parse('2026-11-25T08:00:00Z');
  const baseline = await createSession(createMemoryStore({ now: () => now }));
  const { sessionId } = baseline;
  let committed = null;
  let attempts = 0;
  const store = createUpstashStore({
    url: 'https://redis.invalid',
    token: 'test-only-token',
    now: () => now,
    fetchImpl: async (_url, options) => {
      const [command, script, keyCount, sessionKey, quotaKey, version, nextDoc, limit, quotaTtl, deadline] = JSON.parse(options.body);
      assert.equal(command, 'EVAL');
      assert.equal(keyCount, 2);
      assert.equal(sessionKey, `sess:${sessionId}`);
      assert.match(quotaKey, /^quota:interviewStart:/);
      assert.equal(limit, '3');
      assert.ok(Number(quotaTtl) > 0);
      assert.match(script, /PTTL/);
      assert.match(script, /KEEPTTL/);
      if (committed) return Response.json({ result: ['active', committed] });
      if (!nextDoc) return Response.json({ result: ['ready', JSON.stringify(baseline)] });
      attempts += 1;
      assert.equal(version, String(baseline.version));
      assert.equal(deadline, String(Date.parse(baseline.expiresAt)));
      assert.equal(JSON.parse(nextDoc).expiresAt, baseline.expiresAt);
      committed = nextDoc;
      throw new Error('response lost after commit');
    },
  });
  assert.equal((await submit(store, stub(), { sessionId })).status, 503);
  const retry = await submit(store, {
    generateStructuredResponse() { assert.fail('a replay must skip generation'); },
  }, { sessionId });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), INTERVIEW_FIXTURES.hrd.en.questions[0]);
  assert.equal(attempts, 1);
  now = Date.parse(baseline.expiresAt);
  assert.equal((await submit(store, stub(), { sessionId })).status, 410);
});
