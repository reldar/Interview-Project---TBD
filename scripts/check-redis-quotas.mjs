// Opt-in integration verification. Starts and removes its own non-networked Redis.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { handleInterviewAnswer } from '../app/api/interview/answer/route.js';
import { FIXTURES } from '../lib/contracts.js';
import { INTERVIEW_FIXTURES } from '../lib/interview-fixtures.js';
import { createUpstashStore, deriveIpHash, getJakartaDayWindow } from '../lib/store.js';

const exec = promisify(execFile);
const bridgePath = fileURLToPath(new URL('./redis-quota-bridge.py', import.meta.url));
const windows = process.platform === 'win32';
const distro = process.env.LATIH_REDIS_WSL_DISTRO || 'Ubuntu';
const runLinux = (bin, args) => windows
  ? exec('wsl.exe', ['-d', distro, '--exec', bin, ...args], { timeout: 35_000 })
  : exec(bin, args, { timeout: 35_000 });

async function bridge(path, ...args) {
  return JSON.parse((await runLinux('python3', [path, ...args])).stdout.trim());
}

function redisClient(path, socket) {
  const send = (command) => bridge(path, 'command', socket, Buffer.from(JSON.stringify(command)).toString('base64'));
  const store = createUpstashStore({
    url: 'https://redis.invalid',
    token: 'local-test-only',
    timeoutMs: 25_000,
    fetchImpl: async (_url, options) => Response.json(await send(JSON.parse(options.body))),
  });
  const redis = async (...command) => {
    const reply = await send(command);
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  };
  return { store, redis };
}

if (!isMainThread) {
  const { store } = redisClient(workerData.path, workerData.socket);
  parentPort.on('message', async ({ id, method, args }) => {
    try {
      let result;
      if (method === 'analyze') {
        const [requestId, ip, env, pdfVariant, barrier] = args;
        let calls = 0;
        const fixture = FIXTURES.en;
        const headers = { 'x-vercel-forwarded-for': ip };
        let body;
        if (pdfVariant) {
          body = new FormData();
          body.set('file', new Blob([pdfVariant], { type: 'application/pdf' }), 'example.pdf');
          body.set('language', 'en');
          body.set('jobDescription', fixture.jobDescription);
          body.set('requestId', requestId);
        } else {
          headers['content-type'] = 'application/json';
          body = JSON.stringify({ cvText: fixture.cvText, jobDescription: fixture.jobDescription, requestId, language: 'en' });
        }
        const response = await handleAnalyzeCv(new Request('http://localhost/api/analyze-cv', {
          method: 'POST', headers, body,
        }), {
          store, env, logger: () => {},
          extractPdfText: async () => ({
            text: pdfVariant === 'changed evidence' ? `Different CV\n${fixture.cvText}` : fixture.cvText,
            pages: 1, bytes: pdfVariant.length,
          }),
          geminiOptions: {
            apiKey: 'local-test-only', models: ['stub-primary', 'stub-fallback'],
            fetchImpl: async () => {
              calls += 1;
              if (barrier) {
                const state = new Int32Array(barrier);
                Atomics.store(state, 0, 1);
                Atomics.notify(state, 0);
                Atomics.wait(state, 1, 0, 15000);
              }
              if (requestId.startsWith('retry-') && calls === 1) return new Response(null, { status: 503 });
              return Response.json({
                candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.response) }] } }],
              });
            },
          },
        });
        result = { status: response.status, body: await response.json(), calls };
      } else if (method === 'answer') {
        const [body, ip, env] = args;
        let calls = 0;
        const response = await handleInterviewAnswer(new Request('http://localhost/api/interview/answer', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip }, body,
        }), {
          store, env, logger: () => {}, geminiOptions: {
            apiKey: 'local-test-only', models: ['stub'], fetchImpl: async () => {
              calls += 1;
              const feedback = { clarityScore: 4, relevanceScore: 5, impactScore: 3, suggestion: 'Explain the result.' };
              return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(feedback) }] } }] });
            },
          },
        });
        result = { status: response.status, body: await response.json(), calls };
      } else {
        result = await store[method](...args);
      }
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id, error: { message: error.message, code: error.code } });
    }
  });
} else {
  const path = windows ? (await runLinux('wslpath', ['-a', bridgePath])).stdout.trim() : bridgePath;
  const socket = await bridge(path, 'start');
  const workers = [];
  const { redis, store } = redisClient(path, socket);
  const run = (index, method, ...args) => workers[index % workers.length](method, ...args);
  try {
    for (let i = 0; i < 4; i += 1) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { path, socket } });
      let sequence = 0;
      const pending = new Map();
      worker.on('error', (error) => {
        for (const { reject } of pending.values()) reject(error);
        pending.clear();
      });
      worker.on('message', ({ id, result, error }) => {
        const { resolve, reject } = pending.get(id);
        pending.delete(id);
        if (error) reject(Object.assign(new Error(error.message), { code: error.code }));
        else resolve(result);
      });
      const request = (method, ...args) => new Promise((resolve, reject) => {
        const id = sequence++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, args });
      });
      request.stop = () => worker.terminate();
      workers.push(request);
    }
    assert.deepEqual(await redis('CONFIG', 'GET', 'port'), { port: '0' });
    assert.deepEqual(await redis('CONFIG', 'GET', 'protected-mode'), { 'protected-mode': 'yes' });
    assert.equal(await redis('PING'), 'PONG');
    console.log('Verified private Redis socket, protected mode and TCP port disabled.');

    const feedbackSession = await store.createSession({});
    const vote = { sessionId: feedbackSession.sessionId, ipHash: 'feedback-fixture', language: 'id', positive: true };
    const castVotes = await Promise.all(workers.map((_, i) => run(i, 'recordFeedback', vote)));
    assert.ok(castVotes.every(({ total, positive }) => total === 1 && positive === 1));
    const sessionKey = `sess:${vote.sessionId}`;
    const markerKey = `feedback:voted:${vote.sessionId}`;
    assert.equal(await redis('PEXPIRETIME', markerKey), await redis('PEXPIRETIME', sessionKey));
    const conflictingRetry = await run(0, 'recordFeedback', { ...vote, positive: false, language: 'en' });
    assert.deepEqual(conflictingRetry.byLanguage, { id: { total: 1, positive: 1 }, en: { total: 0, positive: 0 } });
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => run(i, 'recordFeedback', vote)));
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 5);
    assert.equal(attempts.filter(({ reason }) => reason?.code === 'QUOTA_REACHED').length, 3);
    await redis('PEXPIRE', 'feedback:attempts:feedback-fixture', 0);
    await redis('PEXPIRE', sessionKey, 0);
    await assert.rejects(run(3, 'recordFeedback', vote), { code: 'SESSION_EXPIRED' });
    assert.equal((await store.getFeedbackSummary()).total, 1);
    console.log('Feedback counted once, admission capped across four workers and expired sessions rejected.');

    const quota = { action: 'analyze', ipHash: 'cv-quota-fixture' };
    const reserve = () => Promise.all(Array.from({ length: 12 }, (_, i) => run(i, 'reserveQuota', quota)));
    const holds = (await reserve()).filter(({ allowed }) => allowed);
    assert.equal(holds.length, 5);
    assert.ok(holds.every(({ reservationId }) => reservationId));
    const expired = Date.now() - 1000;
    for (const hold of holds) {
      const key = `resv:${hold.reservationId}`;
      const quotaKey = hold.reservationId.slice(hold.reservationId.indexOf('.') + 1);
      await redis('PEXPIREAT', key, expired);
      await redis('ZADD', `${quotaKey}:holds`, expired, key);
    }
    const replacements = (await reserve()).filter(({ allowed }) => allowed);
    assert.equal(replacements.length, 5);
    assert.equal(await run(0, 'releaseQuota', holds[0]), false);
    await assert.rejects(run(1, 'commitQuota', { ...quota, reservationId: holds[0].reservationId }), {
      code: 'TEMPORARILY_UNAVAILABLE',
    });
    const commits = await Promise.allSettled(replacements.flatMap(({ reservationId }, i) => [
      run(i, 'commitQuota', { ...quota, reservationId }),
      run(i + 1, 'commitQuota', { ...quota, reservationId }),
    ]));
    assert.equal(commits.filter(({ status }) => status === 'fulfilled').length, 5);
    assert.ok((await reserve()).every(({ allowed, count }) => !allowed && count === 5));
    console.log('CV quota held at five across four workers. Expired, stale and duplicate reservations fenced.');

    const session = await store.createSession({ sanitizedCvText: 'Fixture CV', sanitizedJd: 'Fixture vacancy' });
    const input = { session, ipHash: 'interview-fixture' };
    const claims = await Promise.all(workers.map((_, i) => run(i, 'claimInterviewGeneration', input)));
    const owners = claims.filter(({ status }) => status === 'claimed');
    assert.equal(owners.length, 1);
    const { claim: old } = owners[0];
    await redis('PEXPIREAT', `interview:owner:${session.sessionId}`, expired);
    const { claim: next } = await run(1, 'claimInterviewGeneration', input);
    assert.ok(next && next.token !== old.token);
    await run(0, 'releaseInterviewGeneration', old);
    assert.equal((await run(2, 'finishInterviewGeneration', old, session, {})).status, 'busy');
    assert.equal((await run(3, 'claimInterviewGeneration', input)).status, 'busy');
    assert.equal((await run(1, 'finishInterviewGeneration', next, session, { currentQuestion: 1 })).status, 'committed');
    assert.equal((await store.getSession(session.sessionId)).expiresAt, session.expiresAt);
    console.log('Interview ownership replay, stale release and original session deadline verified in Lua.');

    const env = {
      NODE_ENV: 'production', VERCEL: '1', QUOTA_HMAC_SECRET: 'local-fixture-key-'.repeat(3),
      AI_UPSTREAM_REQUESTS_PER_MINUTE: '2', AI_UPSTREAM_REQUESTS_PER_DAY: '2',
    };
    const retry = await run(0, 'analyze', 'retry-first', '192.0.2.1', env);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(retry.calls, 2);
    for (const blocked of await Promise.all(workers.slice(1).map((_, i) =>
      run(i + 1, 'analyze', `blocked-${i}`, `192.0.2.${i + 2}`, env)))) {
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error.action, 'aiBudget');
      assert.equal(blocked.calls, 0);
    }
    const replay = await run(2, 'analyze', 'retry-first', '192.0.2.1', env);
    assert.equal(replay.status, 200);
    assert.equal(replay.calls, 0);
    assert.deepEqual(replay.body, retry.body);
    console.log('Exactly two mock HTTP dispatches, including fallback, charged to shared Redis budget. Cached replay survived exhaustion.');

    const deniedIp = '192.0.2.2';
    const denied = await Promise.all(Array.from({ length: 13 }, (_, i) =>
      run(i, 'analyze', `outage-${i}`, deniedIp, env)));
    assert.ok(denied.every(({ status, calls, body }) => status === 429 && calls === 0 && body.error.action === 'aiBudget'));
    const hashed = deriveIpHash(deniedIp, undefined, env);
    assert.deepEqual(await redis('KEYS', `cv:attempts:*:${hashed}`), []);
    for (const key of await redis('KEYS', 'ai:budget:*')) await redis('PEXPIREAT', key, expired);
    const recovered = await run(1, 'analyze', 'recovered', deniedIp, env);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.calls, 1);
    const finalSlot = await Promise.all(workers.map((_, i) =>
      run(i, 'analyze', `race-${i}`, `192.0.2.${i + 10}`, env)));
    assert.equal(finalSlot.filter(({ status }) => status === 200).length, 1);
    assert.equal(finalSlot.filter(({ status, body }) => status === 429 && body.error.action === 'aiBudget').length, 3);
    assert.equal(finalSlot.reduce((sum, { calls }) => sum + calls, 0), 1);
    console.log('Repeated outage denials preserved daily CV admissions. Recovery and concurrent dispatch stayed within budget.');

    const before = getJakartaDayWindow(Date.parse('2026-11-25T16:59:59.000Z'));
    const canonicalEnv = { ...env, AI_UPSTREAM_REQUESTS_PER_MINUTE: '20', AI_UPSTREAM_REQUESTS_PER_DAY: '20' };
    const shared = new SharedArrayBuffer(8);
    const state = new Int32Array(shared);
    const analyzePdf = (worker, bytes, barrier) => run(worker, 'analyze', 'same-pdf', '192.0.2.71', canonicalEnv, bytes, barrier);
    const firstPdf = analyzePdf(0, 'variant A', shared);
    let contender;
    try {
      assert.notEqual(await Atomics.waitAsync(state, 0, 0, 12000).value, 'timed-out');
      contender = await analyzePdf(1, 'variant B');
    } finally {
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
    }
    const winner = await firstPdf;
    assert.equal(winner.status, 200);
    assert.equal(winner.calls, 1);
    assert.equal(contender.status, 503);
    assert.equal(contender.calls, 0);
    const canonicalReplay = await analyzePdf(2, 'variant B');
    assert.deepEqual(canonicalReplay.body, winner.body);
    assert.equal(canonicalReplay.calls, 0);
    const quotaKeys = await redis('KEYS', `quota:analyze:*:${deriveIpHash('192.0.2.71', undefined, canonicalEnv)}`);
    assert.equal(quotaKeys.length, 1);
    assert.equal(Number(await redis('GET', quotaKeys[0])), 1);
    assert.equal((await store.getSession(winner.body.sessionId)).sessionId, winner.body.sessionId);
    console.log('Equivalent PDFs across workers generated one result and replayed the same session.');

    const lastQuota = { action: 'analyze', ipHash: deriveIpHash('192.0.2.70', undefined, canonicalEnv) };
    for (let i = 0; i < 4; i += 1) {
      const next = await run(i, 'reserveQuota', lastQuota);
      assert.ok(next.allowed);
      await run(i, 'commitQuota', { ...lastQuota, reservationId: next.reservationId });
    }
    const quotaPdf = (worker, bytes) => run(worker, 'analyze', 'final-success-pdf', '192.0.2.70', canonicalEnv, bytes);
    const finalSuccess = await quotaPdf(0, 'variant A');
    assert.equal(finalSuccess.status, 200);
    assert.equal(finalSuccess.calls, 1);
    const quotaReplays = await Promise.all([quotaPdf(1, 'variant C'), quotaPdf(2, 'variant D')]);
    for (const replay of quotaReplays) assert.deepEqual(replay, { status: 200, body: finalSuccess.body, calls: 0 });
    const changedQuota = await quotaPdf(3, 'changed evidence');
    assert.equal(changedQuota.status, 429);
    assert.equal(changedQuota.body.error.action, 'analyze');
    assert.equal(changedQuota.calls, 0);
    const [lastQuotaKey] = await redis('KEYS', `quota:analyze:*:${lastQuota.ipHash}`);
    assert.equal(Number(await redis('GET', lastQuotaKey)), 5);

    for (const key of await redis('KEYS', 'ai:budget:*')) await redis('PEXPIREAT', key, expired);
    const budgetEnv = { ...env, AI_UPSTREAM_REQUESTS_PER_MINUTE: '1', AI_UPSTREAM_REQUESTS_PER_DAY: '1' };
    const budgetPdf = (worker, bytes, ip = '192.0.2.72') => run(worker, 'analyze', 'budget-pdf', ip, budgetEnv, bytes);
    const finalBudget = await budgetPdf(0, 'variant A');
    assert.equal(finalBudget.status, 200);
    assert.equal(finalBudget.calls, 1);
    const budgetResults = await Promise.all([budgetPdf(1, 'variant B'), budgetPdf(2, 'variant C'), budgetPdf(3, 'variant B', '192.0.2.73')]);
    for (const replay of budgetResults.slice(0, 2)) assert.deepEqual(replay, { status: 200, body: finalBudget.body, calls: 0 });
    assert.equal(budgetResults[2].status, 429);
    assert.equal(budgetResults[2].body.error.action, 'aiBudget');
    assert.equal(budgetResults[2].calls, 0);
    const changedBudget = await budgetPdf(3, 'changed evidence');
    assert.equal(changedBudget.status, 429);
    assert.equal(changedBudget.body.error.action, 'aiBudget');
    assert.equal(changedBudget.calls, 0);
    for (const key of await redis('KEYS', 'ai:budget:*')) assert.equal(Number(await redis('GET', key)), 1);
    console.log('Equivalent retries survived the last success and dispatch slots across workers. Changed inputs and other clients stayed denied.');

    const interview = { mode: 'hrd', language: 'en', currentQuestion: 1, questions: INTERVIEW_FIXTURES.hrd.en.questions };
    const firstSession = await store.createSession({ interview });
    const otherSession = await store.createSession({ interview });
    let nextWorker = 0;
    let lost;
    const server = createServer(async (request, response) => {
      const worker = nextWorker++;
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await run(worker, 'answer', Buffer.concat(chunks).toString('utf8'), '192.0.2.74', canonicalEnv);
        if (request.headers['x-test-disconnect'] === 'after-commit') {
          lost = result;
          response.destroy();
          return;
        }
        response.writeHead(result.status, { 'content-type': 'application/json', 'x-test-dispatches': result.calls });
        response.end(JSON.stringify(result.body));
      } catch (error) {
        response.writeHead(500);
        response.end(error.message);
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const send = (sessionId, userAnswer, disconnect = false) => fetch(`http://127.0.0.1:${server.address().port}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(disconnect ? { 'x-test-disconnect': 'after-commit' } : {}) },
        body: JSON.stringify({ sessionId, questionNumber: 1, userAnswer }),
      });
      const answer = 'Name: Nadia Kartika. During my internship, I built a Python dashboard.';
      const other = 'Name: Nadia Kartika. During my internship, I reviewed payroll records.';
      const [reset, independent] = await Promise.allSettled([send(firstSession.sessionId, answer, true), send(otherSession.sessionId, other)]);
      assert.equal(reset.status, 'rejected');
      assert.equal(lost.status, 200);
      assert.equal(lost.calls, 1);
      assert.equal(independent.value.status, 200);
      assert.equal(independent.value.headers.get('x-test-dispatches'), '1');
      const [replay, conflict] = await Promise.all([send(firstSession.sessionId, answer), send(firstSession.sessionId, other)]);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), lost.body);
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).error.currentQuestion.questionNumber, 2);
      assert.equal(replay.headers.get('x-test-dispatches'), '0');
      assert.equal(conflict.headers.get('x-test-dispatches'), '0');
      const record = (await store.getSession(firstSession.sessionId)).interview.answers[0];
      assert.match(record.userAnswer, /built a Python dashboard/);
      assert.doesNotMatch(record.userAnswer, /Nadia Kartika|payroll/);
      assert.match((await store.getSession(otherSession.sessionId)).interview.answers[0].userAnswer, /reviewed payroll/);
      assert.equal((await store.getSession(firstSession.sessionId)).expiresAt, firstSession.expiresAt);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    console.log('Real HTTP disconnect after Redis commit recovered across workers without a second dispatch; a separate simultaneous session stayed isolated.');

    const after = getJakartaDayWindow(Date.parse('2026-11-25T17:00:00.000Z'));
    assert.equal(before.resetAtMs, Date.parse('2026-11-25T17:00:00.000Z'));
    assert.notEqual(before.dateKey, after.dateKey);
    // Move the old bucket's deadline near the Redis clock without changing the Lua or host clock.
    let command;
    const clock = (virtualNow, delay) => createUpstashStore({
      url: 'https://redis.invalid', token: 'local-test-only', now: () => virtualNow,
      async fetchImpl(_url, options) {
        command = JSON.parse(options.body);
        const [seconds, microseconds] = await redis('TIME');
        command[8] = String(Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000) + delay);
        return Response.json({ result: await redis(...command) });
      },
    });
    const midnight = { action: 'analyze', ipHash: 'midnight-fixture' };
    const oldDay = await clock(before.resetAtMs - 1000, 4000).reserveQuota(midnight);
    assert.equal(oldDay.dateKey, before.dateKey);
    const oldQuotaKey = command[3];
    assert.ok(oldQuotaKey.includes(before.dateKey));
    while (true) {
      const [seconds, microseconds] = await redis('TIME');
      if (Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000) >= Number(command[8])) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(await store.commitQuota({ ...midnight, reservationId: oldDay.reservationId }), true);
    assert.equal(await redis('GET', oldQuotaKey), null);
    const newDay = await clock(before.resetAtMs, 60_000).reserveQuota(midnight);
    assert.equal(newDay.dateKey, after.dateKey);
    assert.ok(command[3].includes(after.dateKey));
    assert.notEqual(command[3], oldQuotaKey);
    assert.equal(newDay.count, 1);
    console.log('Jakarta bucket selection and accelerated old-bucket rollover verified without changing the host clock.');
  } finally {
    try {
      await Promise.allSettled(workers.map((worker) => worker.stop()));
    } finally {
      await bridge(path, 'stop', socket);
      console.log('Disposable Redis stopped and its private directory removed.');
    }
  }
}
