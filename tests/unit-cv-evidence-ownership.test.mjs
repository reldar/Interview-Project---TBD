import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/store.js';
import { validateAnalysisPayload } from '../lib/contracts.js';

test('canonical reservation has one owner, supports independent requests and recovers after expiry', async () => {
  let now = Date.now();
  const store = createMemoryStore({ now: () => now });
  const input = { action: 'analyze', ipHash: 'example', requestId: 'same' };
  const first = await store.reserveQuota(input);
  await assert.rejects(store.reserveQuota(input));
  assert.ok((await store.reserveQuota({ ...input, requestId: 'different' })).allowed);
  assert.ok((await store.reserveQuota({ ...input, ipHash: 'another' })).allowed);
  now += 121000;
  const replacement = await store.reserveQuota(input);
  const session = await store.createSession({}, { deferUntilCommit: true });
  await assert.rejects(store.commitQuota({ ...input, reservationId: first.reservationId, session }));
  assert.equal(await store.getSession(session.sessionId), null);
  assert.equal(await store.releaseQuota(first), false);
  await assert.rejects(store.reserveQuota(input));
  await store.commitQuota({ ...input, reservationId: replacement.reservationId, result: { sessionId: 'fixture' } });
  assert.deepEqual((await store.reserveQuota(input)).cached, { sessionId: 'fixture' });
});

test('valid Indonesian paraphrase and a recognized bilingual vacancy alias retain evidence', () => {
  const original = 'Membantu membuat laporan dengan Excel.';
  const cv = original + '\nKemampuan komunikasi';
  const payload = { atsScore: 75, matchedKeywords: ['Excel', 'communication'], missingKeywords: [],
    rewrites: [{ original, improved: 'Berkontribusi dalam penyusunan laporan menggunakan Excel.', reason: 'Perjelas kontribusi.' }] };
  assert.equal(validateAnalysisPayload(payload, cv, { sanitizedJd: 'Excel dan komunikasi.' }).ok, true);
  payload.rewrites[0].improved = 'Manajer senior bersertifikat.';
  assert.equal(validateAnalysisPayload(payload, cv, { sanitizedJd: 'Excel dan komunikasi.' }).ok, false);
});

test('ATS rejects unsupported facts independently of the source graduation year', () => {
  const original = 'Built a Python dashboard.';
  const cv = 'Graduated in 2024.\n' + original;
  const options = { sanitizedJd: 'Python and SQL required.' };
  const check = (improved, matchedKeywords = ['Python'], atsScore = 65) =>
    validateAnalysisPayload({ atsScore, matchedKeywords, missingKeywords: ['SQL'],
      rewrites: [{ original, improved, reason: 'Clarify contribution.' }] }, cv, options).ok;
  for (const claim of ['Led 2024 engineers.', 'Built a Kubernetes dashboard.', 'Certified engineer.', 'Senior engineering manager.']) {
    assert.equal(check(claim), false, claim);
  }
  assert.equal(check(original, ['Kubernetes']), false);
  assert.equal(check(original, ['dashboard']), false);
  assert.equal(check(original, ['Python'], 100), false);
  assert.equal(check('Created a dashboard using Python.'), true);
});
