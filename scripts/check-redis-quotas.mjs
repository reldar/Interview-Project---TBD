// Opt-in integration verification. Starts and removes its own non-networked Redis.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { FIXTURES } from '../lib/contracts.js';
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
        const [requestId, ip, env] = args;
        let calls = 0;
        const fixture = FIXTURES.en;
        const response = await handleAnalyzeCv(new Request('http://localhost/api/analyze-cv', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip },
          body: JSON.stringify({
            cvText: fixture.cvText, jobDescription: fixture.jobDescription, requestId, language: 'en',
          }),
        }), {
          store, env, logger: () => {},
          geminiOptions: {
            apiKey: 'local-test-only', models: ['stub-primary', 'stub-fallback'],
            fetchImpl: async () => {
              calls += 1;
              if (requestId.startsWith('retry-') && calls === 1) return new Response(null, { status: 503 });
              return Response.json({
                candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.response) }] } }],
              });
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
