import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { FIXTURES } from '../lib/contracts.js';
import {
  createMemoryStore,
  createUpstashStore,
  deriveIpHash,
  MAX_CV_REQUESTS_PER_IP_MINUTE,
} from '../lib/store.js';

const fixture = FIXTURES.en;
const limits = { perMinute: 1, perDay: 60 };
const env = { AI_UPSTREAM_REQUESTS_PER_MINUTE: '1', AI_UPSTREAM_REQUESTS_PER_DAY: '60' };
const quota = { action: 'analyze', ipHash: deriveIpHash('127.0.0.1') };
const silent = () => {};

function controlledStore(start = '2026-11-25T08:00:00Z') {
  let now = Date.parse(start);
  return { store: createMemoryStore({ now: () => now }), advance: (ms) => { now += ms; } };
}

function upload(requestId) {
  const form = new FormData();
  form.set('file', new Blob(['%PDF-1.4 synthetic fixture'], { type: 'application/pdf' }), 'cv.pdf');
  form.set('language', 'en');
  form.set('jobDescription', fixture.jobDescription);
  form.set('requestId', requestId);
  return new Request('http://localhost/api/analyze-cv', { method: 'POST', body: form });
}

function fakeGemini(onFetch) {
  return {
    apiKey: 'test-only-key',
    models: ['stub-primary', 'stub-fallback'],
    fetchImpl: async () => {
      onFetch();
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.response) }] } }],
      });
    },
  };
}

const extracted = { text: fixture.cvText, pages: 1, bytes: 25 };

test('five abandoned holds expire and a valid CV request can use the restored capacity', async () => {
  const { store, advance } = controlledStore();
  const abandoned = await Promise.all(Array.from({ length: 5 }, () => store.reserveQuota(quota)));
  assert.ok(abandoned.every(({ allowed }) => allowed));
  assert.equal((await store.reserveQuota(quota)).allowed, false);
  advance(120_000);
  const response = await handleAnalyzeCv(upload('after-expiry'), {
    store, logger: silent, extractPdfText: async () => extracted, provider: async () => fixture.response,
  });
  assert.equal(response.status, 200);
  for (const hold of abandoned) {
    assert.equal(await store.releaseQuota(hold), false);
    await assert.rejects(store.commitQuota({ ...quota, reservationId: hold.reservationId }), {
      code: 'TEMPORARILY_UNAVAILABLE',
    });
  }
  assert.equal((await store.reserveQuota(quota)).count, 2);
});

test('concurrent holds and commits cannot exceed five successes, and duplicate commits are fenced', async () => {
  const { store } = controlledStore();
  const reserved = await Promise.all(Array.from({ length: 12 }, () => store.reserveQuota(quota)));
  const holds = reserved.filter(({ allowed }) => allowed);
  assert.equal(holds.length, 5);
  const commits = await Promise.allSettled(holds.flatMap(({ reservationId }) => [
    store.commitQuota({ ...quota, reservationId }), store.commitQuota({ ...quota, reservationId }),
  ]));
  assert.equal(commits.filter(({ status }) => status === 'fulfilled').length, 5);
  assert.equal((await store.reserveQuota(quota)).allowed, false);
  assert.equal(await store.releaseQuota(holds[0]), false);
  assert.equal((await store.reserveQuota(quota)).count, 5);
});

test('an interrupted or stale release cannot free a replacement reservation', async () => {
  const { store, advance } = controlledStore();
  const stale = await store.reserveQuota({ ...quota, limit: 1 });
  advance(120_000);
  const replacement = await store.reserveQuota({ ...quota, limit: 1 });
  assert.equal(replacement.allowed, true);
  assert.equal(await store.releaseQuota(stale), false);
  await assert.rejects(store.commitQuota({ ...quota, reservationId: stale.reservationId }), {
    code: 'TEMPORARILY_UNAVAILABLE',
  });
  assert.equal((await store.reserveQuota({ ...quota, limit: 1 })).allowed, false);
  assert.equal(await store.commitQuota({ ...quota, reservationId: replacement.reservationId }), true);
  assert.equal((await store.reserveQuota({ ...quota, limit: 1 })).allowed, false);
});

test('an in-flight reservation crossing Jakarta midnight does not affect the new day', async () => {
  const { store, advance } = controlledStore('2026-11-25T16:59:59Z');
  const prior = await store.reserveQuota({ ...quota, limit: 1 });
  assert.equal(prior.dateKey, '2026-11-25');
  advance(1000);
  const next = await store.reserveQuota({ ...quota, limit: 1 });
  assert.equal(next.dateKey, '2026-11-26');
  assert.equal(next.count, 1);
  assert.equal(await store.releaseQuota(next), true);
  assert.equal(await store.commitQuota({ ...quota, reservationId: prior.reservationId }), true);
  assert.equal((await store.reserveQuota({ ...quota, limit: 1 })).allowed, true);
});

test('repeated shared-budget denials spend no CV admissions or parser work, and recovery permits a request', async () => {
  const { store, advance } = controlledStore();
  assert.equal((await store.useAiBudget(limits, true)).allowed, true);
  let parses = 0;
  let calls = 0;
  const deps = {
    store, env, logger: silent,
    extractPdfText: async () => { parses += 1; return extracted; },
    geminiOptions: fakeGemini(() => { calls += 1; }),
  };
  for (let i = 0; i < MAX_CV_REQUESTS_PER_IP_MINUTE; i += 1) {
    const response = await handleAnalyzeCv(upload(`budget-${i}`), deps);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.action, 'aiBudget');
  }
  const throttled = await handleAnalyzeCv(upload('rate-limit'), deps);
  assert.equal((await throttled.json()).error.action, 'cvIntake');
  assert.equal(parses, 0);
  assert.equal(calls, 0);
  advance(60_000);
  const success = await handleAnalyzeCv(upload('recovery'), deps);
  assert.equal(success.status, 200);
  assert.equal(parses, 1);
  assert.equal(calls, 1);
  const deniedAgain = await handleAnalyzeCv(upload('new-generation'), deps);
  assert.equal((await deniedAgain.json()).error.action, 'aiBudget');
  assert.equal(parses, 1);
  assert.equal(calls, 1);
});

test('budget lost after parsing but before the first HTTP debit does not consume CV admissions', async () => {
  const { store, advance } = controlledStore();
  let permitOtherWorker = true;
  let calls = 0;
  const raced = {
    ...store,
    async useAiBudget(budget, consume, owner) {
      if (consume && owner && permitOtherWorker) await store.useAiBudget(budget, true);
      return store.useAiBudget(budget, consume, owner);
    },
  };
  const deps = {
    store: raced, env, logger: silent, extractPdfText: async () => extracted,
    geminiOptions: fakeGemini(() => { calls += 1; }),
  };
  for (let i = 0; i < 13; i += 1) {
    const rejected = await handleAnalyzeCv(upload(`race-${i}`), deps);
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error.action, 'aiBudget');
    advance(60_000);
  }
  assert.equal(calls, 0);
  permitOtherWorker = false;
  assert.equal((await handleAnalyzeCv(upload('no-race'), deps)).status, 200);
  assert.equal(calls, 1);
});

test('per-worker intake throttling stops repeated denials before the Redis transport', async () => {
  let commands = 0;
  const now = Date.parse('2026-11-25T08:00:00Z');
  const store = createUpstashStore({
    url: 'https://redis.invalid', token: 'test-only', now: () => now,
    async fetchImpl() {
      commands += 1;
      return Response.json({ result: ['budget', String(now + 60_000)] });
    },
  });
  const statuses = await Promise.all(Array.from({ length: 40 }, () =>
    store.claimCvAdmission({ ipHash: 'fixture', requestId: '', fingerprint: 'same', limits })));
  assert.equal(commands, MAX_CV_REQUESTS_PER_IP_MINUTE);
  assert.equal(statuses.filter(({ status }) => status === 'throttled').length, 10);
});
