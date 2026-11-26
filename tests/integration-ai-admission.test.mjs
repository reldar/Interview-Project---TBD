import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { handleInterviewAnswer } from '../app/api/interview/answer/route.js';
import { handleInterviewStart } from '../app/api/interview/start/route.js';
import { FIXTURES } from '../lib/contracts.js';
import { INTERVIEW_FIXTURES } from '../lib/interview-fixtures.js';
import { createMemoryStore, createStore, createUpstashStore, deriveIpHash, MAX_CV_ADMISSIONS_PER_IP_DAY } from '../lib/store.js';

const ats = FIXTURES.en;
const silent = () => {};
const budgetEnv = (minute, day = minute) => ({
  AI_UPSTREAM_REQUESTS_PER_MINUTE: String(minute), AI_UPSTREAM_REQUESTS_PER_DAY: String(day),
});
const hosted = { NODE_ENV: 'production', VERCEL: '1', QUOTA_HMAC_SECRET: 'test-only'.repeat(4) };

function request(path, payload, headers = {}) {
  return new Request(`http://localhost/api/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
  });
}

const cvBody = (requestId, cvText = ats.cvText) => ({
  cvText, jobDescription: ats.jobDescription, language: 'en', requestId,
});
const cvResult = { ...ats.response };
const jsonProvider = (payload) => Response.json({
  candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
});

function pdfRequest(id) {
  const form = new FormData();
  form.set('file', new Blob(['%PDF-1.4 synthetic test'], { type: 'application/pdf' }), 'fixture.pdf');
  form.set('jobDescription', ats.jobDescription);
  form.set('language', 'en');
  form.set('requestId', id);
  return new Request('http://localhost/api/analyze-cv', { method: 'POST', body: form });
}

test('an oversized Gemini HTTP body is cancelled before JSON parsing and cannot create an analysis', async () => {
  const store = createMemoryStore();
  let cancelled = false;
  let calls = 0;
  const response = await handleAnalyzeCv(request('analyze-cv', cvBody('oversized-http-response')), {
    store, logger: silent, env: budgetEnv(4), geminiOptions: {
      apiKey: 'test-only-key', models: ['stub'], fetchImpl() {
        calls += 1;
        return new Response(new ReadableStream({
          start(stream) { stream.enqueue(new Uint8Array(512 * 1024 + 1)); },
          cancel() { cancelled = true; },
        }));
      },
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'TEMPORARILY_UNAVAILABLE' } });
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  assert.equal((await store.reserveQuota({ action: 'analyze', ipHash: deriveIpHash('127.0.0.1') })).count, 1);
});

test('byte-identical CV requests share in-flight admission before PDF extraction even with different request IDs', async () => {
  const store = createMemoryStore();
  let parses = 0;
  let calls = 0;
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const deps = {
    store, logger: silent,
    extractPdfText: async () => {
      parses += 1;
      entered();
      await held;
      return { text: ats.cvText, pages: 1, bytes: 23 };
    },
    provider: async () => { calls += 1; return cvResult; },
  };
  const first = handleAnalyzeCv(pdfRequest('first'), deps);
  await started;
  assert.equal((await handleAnalyzeCv(pdfRequest('other'), deps)).status, 503);
  assert.equal(parses, 1);
  release();
  const response = await first;
  assert.equal(response.status, 200);
  const replay = await handleAnalyzeCv(pdfRequest('first'), { ...deps, env: budgetEnv(0) });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), await response.json());
  assert.equal(parses, 1);
  assert.equal(calls, 1);
});

test('failed CV generation consumes admissions and rejects further PDF extraction before successful quota is used', async () => {
  const store = createMemoryStore();
  let calls = 0;
  let parses = 0;
  const deps = {
    store, logger: silent,
    extractPdfText: async () => { parses += 1; return { text: ats.cvText, pages: 1, bytes: 23 }; },
    provider: async () => { calls += 1; throw new Error('stub failure'); },
  };
  for (let i = 0; i < MAX_CV_ADMISSIONS_PER_IP_DAY; i += 1) {
    assert.equal((await handleAnalyzeCv(pdfRequest(`failure-${i}`), deps)).status, 503);
  }
  const blocked = await handleAnalyzeCv(pdfRequest('over-limit'), deps);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.action, 'cvAdmission');
  assert.equal(calls, MAX_CV_ADMISSIONS_PER_IP_DAY);
  assert.equal(parses, MAX_CV_ADMISSIONS_PER_IP_DAY);
  const check = await store.reserveQuota({ action: 'analyze', ipHash: deriveIpHash('127.0.0.1') });
  assert.equal(check.count, 1);
});

test('a shared budget records each CV fallback HTTP attempt and blocks interview generation without hiding reports', async () => {
  const store = createMemoryStore();
  const saved = await store.createSession({ sanitizedCvText: ats.cvText, sanitizedJd: ats.jobDescription });
  const startBody = { sessionId: saved.sessionId, mode: 'hrd', language: 'en' };
  const startOpts = { store, logger: silent, provider: { generateStructuredResponse: async () => JSON.stringify(INTERVIEW_FIXTURES.hrd.en) } };
  assert.equal((await handleInterviewStart(request('interview/start', startBody), startOpts)).status, 200);
  const feedback = { clarityScore: 3, relevanceScore: 4, impactScore: 5, suggestion: 'Tell me how you verified the result.' };
  for (let i = 1; i <= 5; i += 1) {
    const response = await handleInterviewAnswer(request('interview/answer', {
      sessionId: saved.sessionId, questionNumber: i, userAnswer: 'Answer',
    }), { store, logger: silent, provider: { generateStructuredResponse: async () => JSON.stringify(feedback) } });
    assert.equal(response.status, 200);
  }

  let httpCalls = 0;
  const env = budgetEnv(2);
  const geminiOptions = {
    apiKey: 'test-only-key', models: ['stub-a', 'stub-b', 'stub-c'],
    async fetchImpl(_url, options) {
      assert.equal(options.redirect, 'error');
      httpCalls += 1;
      return new Response(null, { status: 503 });
    },
  };
  const cv = await handleAnalyzeCv(request('analyze-cv', cvBody('budget')), { store, logger: silent, env, geminiOptions });
  assert.equal(cv.status, 429);
  assert.equal((await cv.json()).error.action, 'aiBudget');
  assert.equal(httpCalls, 2);
  let parses = 0;
  const noParse = await handleAnalyzeCv(pdfRequest('budget-blocked'), {
    store, logger: silent, env, geminiOptions, extractPdfText: () => { parses += 1; },
  });
  assert.equal(noParse.status, 429);
  assert.equal(parses, 0);
  const fresh = await store.createSession({ sanitizedCvText: ats.cvText, sanitizedJd: ats.jobDescription });
  const blocked = await handleInterviewStart(request('interview/start', { ...startBody, sessionId: fresh.sessionId }), {
    store, logger: silent, env, geminiOptions,
  });
  assert.equal(blocked.status, 429);
  const report = await handleInterviewStart(request('interview/start', startBody), { store, logger: silent, env, geminiOptions });
  assert.equal(report.status, 409);
  assert.equal((await report.json()).error.report.transcript.length, 5);
  assert.equal(httpCalls, 2);
});

test('distinct quota identities share the same upstream budget atomically', async () => {
  const store = createMemoryStore();
  let httpCalls = 0;
  const deps = {
    store, logger: silent, env: { ...hosted, ...budgetEnv(1) },
    geminiOptions: {
      apiKey: 'test-only-key', models: ['stub-model'],
      fetchImpl: async () => { httpCalls += 1; return jsonProvider(cvResult); },
    },
  };
  const responses = await Promise.all(['192.0.2.1', '192.0.2.2'].map((ip, index) =>
    handleAnalyzeCv(request('analyze-cv', cvBody(`batch-${index}`), { 'x-vercel-forwarded-for': ip }), deps)));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 429]);
  assert.equal(httpCalls, 1);
});

test('a timed-out Gemini attempt and its fallback both spend budget, which is shared with answers', async () => {
  const store = createMemoryStore();
  const session = await store.createSession({ sanitizedCvText: ats.cvText, sanitizedJd: ats.jobDescription });
  const env = budgetEnv(2);
  let calls = 0;
  const geminiOptions = {
    apiKey: 'test-only-key', models: ['stub-a', 'stub-b'], perAttemptTimeoutMs: 15,
    async fetchImpl(_url, { signal }) {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve, reject) => {
          const guard = setTimeout(resolve, 200);
          signal.addEventListener('abort', () => { clearTimeout(guard); reject(signal.reason); }, { once: true });
        });
      }
      return jsonProvider(INTERVIEW_FIXTURES.hrd.en);
    },
  };
  const deps = { store, logger: silent, env, geminiOptions };
  const started = await handleInterviewStart(request('interview/start', {
    sessionId: session.sessionId, mode: 'hrd', language: 'en',
  }), deps);
  assert.equal(started.status, 200);
  assert.equal(calls, 2);
  const blocked = await handleInterviewAnswer(request('interview/answer', {
    sessionId: session.sessionId, questionNumber: 1, userAnswer: 'Test answer',
  }), deps);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.action, 'aiBudget');
  assert.equal(calls, 2);
});

test('oversized interview streams are rejected before the store or provider is reached', async () => {
  let calls = 0;
  for (const [route, handle, size] of [
    ['start', handleInterviewStart, 4_097], ['answer', handleInterviewAnswer, 32_769],
  ]) {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    } });
    const response = await handle(new Request(`http://localhost/api/interview/${route}`, {
      method: 'POST', body: stream, duplex: 'half',
    }), { store: { getSession() { calls += 1; } }, logger: silent });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'FILE_TOO_LARGE');
  }
  assert.equal(calls, 0);
});

test('production storage fails closed and quota identity ignores untrusted forwarding headers', () => {
  const error = { code: 'TEMPORARILY_UNAVAILABLE' };
  assert.throws(() => createStore({ env: hosted }), error);
  assert.throws(() => createStore({ env: hosted, url: 'http://redis.invalid', token: 'test-only-token' }), error);
  assert.throws(() => createStore({
    env: { ...hosted, QUOTA_HMAC_SECRET: '' }, url: 'https://redis.invalid', token: 'test-only-token',
  }), error);
  assert.equal(createStore({ env: hosted, url: 'https://redis.invalid', token: 'test-only-token' }).backend, 'upstash');
  const untrusted = (ip) => request('analyze-cv', {}, { 'x-forwarded-for': ip, 'x-real-ip': ip });
  assert.throws(() => deriveIpHash(untrusted('192.0.2.1'), undefined, hosted), error);
  assert.equal(deriveIpHash(untrusted('192.0.2.1'), undefined, {}), deriveIpHash(untrusted('192.0.2.2'), undefined, {}));
  const trusted = (forwarded) => request('analyze-cv', {}, {
    'x-vercel-forwarded-for': '192.0.2.3', 'x-forwarded-for': forwarded,
  });
  assert.equal(deriveIpHash(trusted('192.0.2.1'), undefined, hosted), deriveIpHash(trusted('192.0.2.2'), undefined, hosted));
  assert.throws(() => deriveIpHash(request('analyze-cv', {}, { 'x-vercel-forwarded-for': '192.0.2.3, 192.0.2.4' }), undefined, hosted), error);
});

test('Upstash budget adapter uses a single fenced Lua operation for the two budget windows', async () => {
  let calls = 0;
  const store = createUpstashStore({
    url: 'https://redis.invalid', token: 'test-only-token', now: () => 0,
    async fetchImpl(_url, options) {
      calls += 1;
      const [command, script, count, minute, day, owner, consume, , , , , token] = JSON.parse(options.body);
      assert.equal(command, 'EVAL');
      assert.match(script, /redis\.call\('INCR'/);
      assert.equal(count, 3);
      assert.match(minute, /^ai:budget:minute:/);
      assert.match(day, /^ai:budget:day:/);
      assert.equal(owner, 'interview:owner:sess_fixture');
      assert.equal(consume, '1');
      assert.equal(token, 'fixture-token');
      return Response.json({ result: ['denied', '60000'] });
    },
  });
  const result = await store.useAiBudget({ perMinute: 1, perDay: 5 }, true, { sessionId: 'sess_fixture', token: 'fixture-token' });
  assert.deepEqual(result, { allowed: false, resetAt: '1970-01-01T00:01:00.000Z' });
  assert.equal(calls, 1);
});
