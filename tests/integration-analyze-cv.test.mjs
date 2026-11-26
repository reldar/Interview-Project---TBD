import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { handleFeedback } from '../app/api/feedback/route.js';
import {
  ERROR_CODES,
  FIXTURES,
  MAX_PDF_BYTES,
  buildCvReportText,
} from '../lib/contracts.js';
import { logRouteEvent } from '../lib/logger.js';
import { REDACTION_PLACEHOLDERS } from '../lib/redact.js';
import { createMemoryStore } from '../lib/store.js';
import { generateFixtures } from '../scripts/generate-layout-pdfs.mjs';

function escapePdfText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  let y = 740;
  const streamLines = lines.map((line) => {
    const cmd = `BT /F1 10 Tf 1 0 0 1 54 ${y} Tm (${escapePdfText(line)}) Tj ET`;
    y -= 15;
    return cmd;
  });
  const stream = streamLines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i += 1) {
    xref += `${String(Buffer.byteLength(out, 'utf8')).padStart(10, '0')} 00000 n \n`;
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(out, 'utf8');
  out += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, 'utf8');
}

function buildExactSizePdf(size) {
  const lines = [
    'Nadia Putri - Data Analyst Intern',
    'SKILLS: Python, Excel',
    '- Built a Python script to clean duplicate rows.',
    '- Helped make weekly reports in Excel.',
    '- Wrote instructions for the reports.',
  ];
  let y = 740;
  const stream = lines
    .map((line) => {
      const cmd = `BT /F1 10 Tf 1 0 0 1 54 ${y} Tm (${escapePdfText(line)}) Tj ET`;
      y -= 15;
      return cmd;
    })
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 0; i < objects.length; i += 1) {
    table += `${String(body.length).padStart(10, '0')} 00000 n \n`;
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  table += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n';
  const end = '\n%%EOF\n';
  const offset = size - table.length - 7 - end.length;
  assert.equal(String(offset).length, 7);
  const bytes = Buffer.from(body.padEnd(offset, ' ') + table + offset + end, 'utf8');
  assert.equal(bytes.byteLength, size);
  return bytes;
}

function makeMultipartRequest({
  bytes,
  filename = 'cv.pdf',
  mimeType = 'application/pdf',
  includeFile = true,
  jobDescription = FIXTURES.en.jobDescription,
  language = 'en',
  requestId,
  ip = '198.51.100.1',
  headerRequestId,
}) {
  const form = new FormData();
  if (includeFile) {
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
  }
  if (jobDescription !== undefined) form.append('jobDescription', jobDescription);
  if (language !== undefined) form.append('language', language);
  if (requestId !== undefined) form.append('requestId', requestId);

  const headers = { 'x-forwarded-for': ip };
  if (headerRequestId) headers['x-request-id'] = headerRequestId;
  return new Request('http://localhost:3000/api/analyze-cv', {
    method: 'POST',
    headers,
    body: form,
  });
}

function makeJsonRequest({
  payload,
  ip = '198.51.100.1',
  headerRequestId,
  contentType = 'application/json',
  url = 'http://localhost:3000/api/analyze-cv',
}) {
  const headers = { 'content-type': contentType, 'x-forwarded-for': ip };
  if (headerRequestId) headers['x-request-id'] = headerRequestId;
  return new Request(url, {
    method: 'POST',
    headers,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function createTrackedStore(opts = {}) {
  const inner = createMemoryStore(opts);
  const stats = {
    reserveCalls: 0,
    commitCalls: 0,
    releaseCalls: 0,
    createSessionCalls: 0,
    sessionIds: [],
  };
  return {
    stats,
    store: {
      ...inner,
      backend: inner.backend,
      getIdempotentResult: (...args) => inner.getIdempotentResult(...args),
      async reserveQuota(...args) {
        stats.reserveCalls += 1;
        return inner.reserveQuota(...args);
      },
      async commitQuota(...args) {
        stats.commitCalls += 1;
        return inner.commitQuota(...args);
      },
      async releaseQuota(...args) {
        stats.releaseCalls += 1;
        return inner.releaseQuota(...args);
      },
      async createSession(...args) {
        stats.createSessionCalls += 1;
        const doc = await inner.createSession(...args);
        stats.sessionIds.push(doc.sessionId);
        return doc;
      },
      getSession: (...args) => inner.getSession(...args),
      updateSession: (...args) => inner.updateSession(...args),
      recordFeedback: (...args) => inner.recordFeedback(...args),
      getFeedbackSummary: (...args) => inner.getFeedbackSummary(...args),
    },
  };
}

function makeStandardStubProvider(counter = { calls: 0 }) {
  return async () => {
    counter.calls += 1;
    return JSON.stringify({
      atsScore: 68,
      matchedKeywords: ['Python', 'Excel'],
      missingKeywords: ['SQL'],
      rewrites: FIXTURES.en.response.rewrites,
    });
  };
}

describe('Integration — POST /api/analyze-cv & POST /api/feedback', () => {
  let fixtureDir;
  let manifest;

  before(async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'latihkerja-int-'));
    manifest = await generateFixtures(fixtureDir);
  });

  after(async () => {
    if (fixtureDir) {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('maintains parity between multipart PDF upload and JSON text submission', async () => {
    const { store, stats } = createTrackedStore();
    const providerCounter = { calls: 0 };
    const provider = makeStandardStubProvider(providerCounter);
    const logs = [];
    const logger = (event) => logRouteEvent({ ...event, sink: (line) => logs.push(line) });

    const pdfBytes = buildSimplePdf([
      'Built a Python script to clean duplicate rows.',
      'Helped make weekly reports in Excel.',
      'Wrote instructions for the reports.',
    ]);

    const multipartRes = await handleAnalyzeCv(
      makeMultipartRequest({ bytes: pdfBytes, ip: '198.51.100.11' }),
      { store, provider, logger }
    );
    assert.equal(multipartRes.status, 200);
    const multipartBody = await multipartRes.json();

    const jsonRes = await handleAnalyzeCv(
      makeJsonRequest({
        payload: {
          cvText: FIXTURES.en.cvText,
          jobDescription: FIXTURES.en.jobDescription,
          language: 'en',
        },
        ip: '198.51.100.11',
      }),
      { store, provider, logger }
    );
    assert.equal(jsonRes.status, 200);
    const jsonBody = await jsonRes.json();

    const expectedKeys = ['atsScore', 'matchedKeywords', 'missingKeywords', 'rewrites', 'sessionId'];
    assert.deepEqual(Object.keys(multipartBody).sort(), expectedKeys);
    assert.deepEqual(Object.keys(jsonBody).sort(), expectedKeys);
    assert.notEqual(multipartBody.sessionId, jsonBody.sessionId);
    assert.equal(multipartBody.atsScore, jsonBody.atsScore);
    assert.deepEqual(multipartBody.matchedKeywords, jsonBody.matchedKeywords);
    assert.deepEqual(multipartBody.missingKeywords, jsonBody.missingKeywords);
    assert.deepEqual(multipartBody.rewrites, jsonBody.rewrites);
    assert.equal(providerCounter.calls, 2);
    assert.equal(stats.createSessionCalls, 2);
    assert.ok(await store.getSession(multipartBody.sessionId));
    assert.ok(await store.getSession(jsonBody.sessionId));
  });

  it('enforces exact upload byte boundaries (4,999,999 -> 200, 5,000,000 -> 200, 5,000,001 -> 413 FILE_TOO_LARGE)', async () => {
    const { store, stats } = createTrackedStore();
    const providerCounter = { calls: 0 };
    const provider = makeStandardStubProvider(providerCounter);
    const logger = () => {};

    const belowRes = await handleAnalyzeCv(
      makeMultipartRequest({ bytes: buildExactSizePdf(MAX_PDF_BYTES - 1), ip: '198.51.100.12' }),
      { store, provider, logger }
    );
    assert.equal(belowRes.status, 200);

    const exactRes = await handleAnalyzeCv(
      makeMultipartRequest({ bytes: buildExactSizePdf(MAX_PDF_BYTES), ip: '198.51.100.12' }),
      { store, provider, logger }
    );
    assert.equal(exactRes.status, 200);

    const overRes = await handleAnalyzeCv(
      makeMultipartRequest({ bytes: buildExactSizePdf(MAX_PDF_BYTES + 1), ip: '198.51.100.12' }),
      { store, provider, logger }
    );
    assert.equal(overRes.status, 413);
    const overBody = await overRes.json();
    assert.deepEqual(overBody, { error: { code: ERROR_CODES.FILE_TOO_LARGE } });
    assert.equal(providerCounter.calls, 2);
    assert.equal(stats.reserveCalls, 2);
    assert.equal(stats.createSessionCalls, 2);
  });

  it('rejects all invalid inputs & unreadable PDFs with 0 provider calls, 0 quota used, and 0 sessions created', async () => {
    const validPdf = await readFile(path.join(fixtureDir, manifest.readable[0].filename));
    const mislabeledPdf = await readFile(path.join(fixtureDir, 'invalid-mislabeled.pdf'));
    const corruptPdf = await readFile(path.join(fixtureDir, 'invalid-corrupt.pdf'));
    const protectedPdf = await readFile(path.join(fixtureDir, 'invalid-protected.pdf'));
    const imageOnlyPdf = await readFile(path.join(fixtureDir, 'invalid-image-only.pdf'));

    const cases = [
      {
        name: 'blank JD (multipart)',
        req: makeMultipartRequest({ bytes: validPdf, jobDescription: '   \n\t  ' }),
        status: 400,
        code: ERROR_CODES.INVALID_INPUT,
        field: 'jobDescription',
      },
      {
        name: 'invalid language',
        req: makeMultipartRequest({ bytes: validPdf, language: 'de' }),
        status: 400,
        code: ERROR_CODES.INVALID_INPUT,
        field: 'language',
      },
      {
        name: 'missing file',
        req: makeMultipartRequest({ includeFile: false }),
        status: 400,
        code: ERROR_CODES.INVALID_INPUT,
        field: 'file',
      },
      {
        name: 'wrong MIME text/plain',
        req: makeMultipartRequest({ bytes: validPdf, mimeType: 'text/plain', filename: 'cv.txt' }),
        status: 415,
        code: ERROR_CODES.UNSUPPORTED_FILE,
      },
      {
        name: 'mislabeled PDF',
        req: makeMultipartRequest({ bytes: mislabeledPdf, filename: 'invalid-mislabeled.pdf' }),
        status: 422,
        code: ERROR_CODES.PDF_UNREADABLE,
      },
      {
        name: 'corrupt PDF',
        req: makeMultipartRequest({ bytes: corruptPdf, filename: 'invalid-corrupt.pdf' }),
        status: 422,
        code: ERROR_CODES.PDF_UNREADABLE,
      },
      {
        name: 'password-protected PDF',
        req: makeMultipartRequest({ bytes: protectedPdf, filename: 'invalid-protected.pdf' }),
        status: 422,
        code: ERROR_CODES.PDF_UNREADABLE,
      },
      {
        name: 'image-only PDF',
        req: makeMultipartRequest({ bytes: imageOnlyPdf, filename: 'invalid-image-only.pdf' }),
        status: 422,
        code: ERROR_CODES.PDF_UNREADABLE,
      },
    ];

    for (const tc of cases) {
      const { store, stats } = createTrackedStore();
      const providerCounter = { calls: 0 };
      const res = await handleAnalyzeCv(tc.req, {
        store,
        provider: makeStandardStubProvider(providerCounter),
        logger: () => {},
      });
      assert.equal(res.status, tc.status, `Case "${tc.name}": unexpected HTTP status`);
      const body = await res.json();
      assert.equal(body.error?.code, tc.code, `Case "${tc.name}": unexpected error code`);
      if (tc.field) {
        assert.equal(body.error?.field, tc.field, `Case "${tc.name}": unexpected field`);
      }
      assert.equal(providerCounter.calls, 0, `Case "${tc.name}": provider must not be called`);
      assert.equal(stats.reserveCalls, 0, `Case "${tc.name}": quota must not be reserved`);
      assert.equal(stats.createSessionCalls, 0, `Case "${tc.name}": session must not be created`);
    }
  });

  it('fault injection returns 503 TEMPORARILY_UNAVAILABLE, releases quota, creates no session, and hides raw error details', async () => {
    const faults = [
      {
        name: 'malformed JSON',
        provider: async () => '{"atsScore": 68, "broken":',
      },
      {
        name: 'missing rewrites field',
        provider: async () => JSON.stringify({ atsScore: 68, matchedKeywords: ['Python'], missingKeywords: ['SQL'] }),
      },
      {
        name: 'out-of-range atsScore 105',
        provider: async () => JSON.stringify({ ...FIXTURES.en.response, atsScore: 105 }),
      },
      {
        name: 'float atsScore 68.5',
        provider: async () => JSON.stringify({ ...FIXTURES.en.response, atsScore: 68.5 }),
      },
      {
        name: 'overlapping alias keywords JS / JavaScript',
        provider: async () =>
          JSON.stringify({
            ...FIXTURES.en.response,
            matchedKeywords: ['JS', 'Excel'],
            missingKeywords: ['JavaScript'],
          }),
      },
      {
        name: 'fabricated metric in improved',
        provider: async () =>
          JSON.stringify({
            ...FIXTURES.en.response,
            rewrites: [
              {
                original: 'Built a Python script to clean duplicate rows.',
                improved: 'Built a Python script reducing duplicate rows by 40%.',
                reason: 'Invented percentage.',
              },
              FIXTURES.en.response.rewrites[1],
              FIXTURES.en.response.rewrites[2],
            ],
          }),
      },
      {
        name: 'provider timeout',
        provider: async () => {
          const err = new Error('SECRET_PROVIDER_STACK_TIMEOUT_12345');
          err.name = 'TimeoutError';
          throw err;
        },
      },
    ];

    for (const fault of faults) {
      const { store, stats } = createTrackedStore();
      const ip = '198.51.100.55';
      const res = await handleAnalyzeCv(
        makeJsonRequest({
          payload: {
            cvText: FIXTURES.en.cvText,
            jobDescription: FIXTURES.en.jobDescription,
            language: 'en',
          },
          ip,
        }),
        { store, provider: fault.provider, logger: () => {} }
      );

      assert.equal(res.status, 503, `Fault "${fault.name}": expected 503`);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: { code: ERROR_CODES.TEMPORARILY_UNAVAILABLE } });
      assert.ok(!text.includes('SECRET_PROVIDER_STACK'), `Fault "${fault.name}": leaked raw error`);
      assert.equal(stats.createSessionCalls, 0, `Fault "${fault.name}": must not create session`);
      assert.equal(stats.commitCalls, 0, `Fault "${fault.name}": must not commit quota`);
      assert.equal(stats.releaseCalls, 1, `Fault "${fault.name}": must release reserved quota`);

      // Verify quota count really returned to 0 (all 5 slots still usable)
      const checkRes = await handleAnalyzeCv(
        makeJsonRequest({
          payload: {
            cvText: FIXTURES.en.cvText,
            jobDescription: FIXTURES.en.jobDescription,
            language: 'en',
          },
          ip,
        }),
        { store, provider: makeStandardStubProvider(), logger: () => {} }
      );
      assert.equal(checkRes.status, 200, `Fault "${fault.name}": follow-up call after quota release should succeed`);
      // Check that the successful call used slot 1 (so 4 more still succeed)
      for (let k = 0; k < 4; k += 1) {
        const extra = await handleAnalyzeCv(
          makeJsonRequest({
            payload: {
              cvText: FIXTURES.en.cvText,
              jobDescription: FIXTURES.en.jobDescription,
              language: 'en',
            },
            ip,
          }),
          { store, provider: makeStandardStubProvider(), logger: () => {} }
        );
        assert.equal(extra.status, 200);
      }
    }
  });

  it('end-to-end synthetic PII trace (§8): zero PII in provider input, session record, logs, or exported report', async () => {
    const cvSecrets = {
      email: 'cv.trace.alpha@example.com',
      phone: '+62 812-1111-2222',
      nik: '3171011205019001',
      birth: '15 Mei 2001',
      street: 'Jl. Cempaka No. 77',
      postal: '12160',
    };
    const jdSecrets = {
      email: 'recruiter.beta@example.org',
      phone: '0813-3333-4444',
      street: 'Jl. Thamrin No. 99',
      postal: '10230',
    };
    const modelSecrets = {
      email: 'model.gamma@example.net',
      phone: '+62 815-5555-6666',
      nik: '3273011205019002',
      street: 'Jl. Diponegoro No. 55',
      postal: '40115',
    };
    const rawIp = '203.0.113.42';

    const cvPdf = buildSimplePdf([
      'Nadia Putri - Data Analyst Intern',
      `Email: ${cvSecrets.email} | HP: ${cvSecrets.phone}`,
      `NIK: ${cvSecrets.nik} | Tanggal Lahir: ${cvSecrets.birth}`,
      `Alamat: ${cvSecrets.street}, Jakarta Selatan ${cvSecrets.postal}`,
      'SKILLS: Python, Excel',
      '- Built a Python script to clean duplicate rows.',
      '- Helped make weekly reports in Excel.',
      '- Wrote instructions for the reports.',
      'EDUCATION: Universitas Nusantara (Graduated 2024)',
    ]);

    const jdText = [
      'Data Analyst Intern. Required: Python, Excel, SQL.',
      `Send queries to ${jdSecrets.email} or WA: ${jdSecrets.phone}.`,
      `Address: ${jdSecrets.street}, Jakarta Pusat ${jdSecrets.postal}`,
    ].join('\n');

    const capturedProviderCalls = [];
    const capturedLogs = [];
    const logger = (event) => logRouteEvent({ ...event, sink: (line) => capturedLogs.push(line) });
    const { store } = createTrackedStore();

    const provider = async (arg) => {
      capturedProviderCalls.push(arg);
      return JSON.stringify({
        atsScore: 70,
        matchedKeywords: ['Python', `Excel (${modelSecrets.email})`],
        missingKeywords: ['SQL', `Contact ${modelSecrets.phone}`],
        rewrites: [
          {
            original: 'Built a Python script to clean duplicate rows.',
            improved: 'Wrote a Python script to remove duplicate rows cleanly.',
            reason: `Mention row volume. Do not email ${modelSecrets.email} or NIK: ${modelSecrets.nik} at ${modelSecrets.street}, Bandung ${modelSecrets.postal}.`,
          },
          FIXTURES.en.response.rewrites[1],
          FIXTURES.en.response.rewrites[2],
        ],
      });
    };

    const res = await handleAnalyzeCv(
      makeMultipartRequest({
        bytes: cvPdf,
        jobDescription: jdText,
        language: 'en',
        ip: rawIp,
      }),
      { store, provider, logger }
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    // Also trigger failure logs (corrupt PDF + provider error) with synthetic PII to inspect failure logs!
    await handleAnalyzeCv(
      makeMultipartRequest({
        bytes: Buffer.from(`%PDF-1.4\ncorrupt ${cvSecrets.email} ${cvSecrets.nik}`),
        jobDescription: jdText,
        language: 'en',
        ip: rawIp,
      }),
      { store, provider, logger }
    );
    await handleAnalyzeCv(
      makeMultipartRequest({
        bytes: cvPdf,
        jobDescription: jdText,
        language: 'en',
        ip: rawIp,
      }),
      {
        store,
        provider: async () => {
          throw new Error(`Provider failure with ${cvSecrets.email}`);
        },
        logger,
      }
    );

    // 1. Provider received ONLY redacted text (zero CV/JD secrets)
    assert.equal(capturedProviderCalls.length, 1);
    const providerPayloadStr = JSON.stringify(capturedProviderCalls[0]);
    for (const secret of [...Object.values(cvSecrets), ...Object.values(jdSecrets)]) {
      assert.ok(!providerPayloadStr.includes(secret), `Secret "${secret}" reached provider!`);
    }
    for (const placeholder of Object.values(REDACTION_PLACEHOLDERS)) {
      assert.ok(providerPayloadStr.includes(placeholder), `Expected placeholder ${placeholder} in provider prompt`);
    }

    // 2. Stored session record contains ONLY redacted text (zero PII, zero raw PDF bytes)
    const sessionRecord = await store.getSession(body.sessionId);
    assert.ok(sessionRecord);
    const sessionStr = JSON.stringify(sessionRecord);
    for (const secret of [
      ...Object.values(cvSecrets),
      ...Object.values(jdSecrets),
      ...Object.values(modelSecrets),
      '%PDF-',
    ]) {
      assert.ok(!sessionStr.includes(secret), `Secret "${secret}" stored in session record!`);
    }

    // 3. Captured logRouteEvent lines contain zero CV/JD text, zero PII, zero sessionId, zero raw IP, zero API keys
    assert.equal(capturedLogs.length, 3);
    const allLogs = capturedLogs.join('\n');
    for (const forbidden of [
      ...Object.values(cvSecrets),
      ...Object.values(jdSecrets),
      ...Object.values(modelSecrets),
      body.sessionId,
      rawIp,
      'Nadia Putri',
      'Built a Python script',
      'Data Analyst Intern',
      'GEMINI_API_KEY',
      'AIza',
    ]) {
      assert.ok(!allLogs.includes(forbidden), `Forbidden token "${forbidden}" appeared in logs:\n${allLogs}`);
    }
    for (const line of capturedLogs) {
      const parsedLog = JSON.parse(line);
      assert.equal(parsedLog.route, '/api/analyze-cv');
      assert.equal(typeof parsedLog.status, 'number');
      assert.equal(typeof parsedLog.elapsedMs, 'number');
    }

    // 4. Exported buildCvReportText contains zero sessionId and zero synthetic PII
    for (const lang of ['en', 'id']) {
      const exported = buildCvReportText(body, lang);
      for (const secret of [
        body.sessionId,
        ...Object.values(cvSecrets),
        ...Object.values(jdSecrets),
        ...Object.values(modelSecrets),
      ]) {
        assert.ok(!exported.includes(secret), `Secret "${secret}" leaked in ${lang} exported report`);
      }
    }
  });

  it('returns 429 QUOTA_REACHED after 5 analyses and replays cached session on requestId retry without extra charge', async () => {
    const { store } = createTrackedStore({ now: () => Date.parse('2026-11-25T05:00:00.000Z') });
    const providerCounter = { calls: 0 };
    const provider = makeStandardStubProvider(providerCounter);
    const ip = '198.51.100.77';

    let fifthPayload;
    for (let i = 1; i <= 5; i += 1) {
      const res = await handleAnalyzeCv(
        makeJsonRequest({
          payload: {
            cvText: FIXTURES.en.cvText,
            jobDescription: FIXTURES.en.jobDescription,
            language: 'en',
            requestId: `req-quota-${i}`,
          },
          ip,
        }),
        { store, provider, logger: () => {} }
      );
      assert.equal(res.status, 200);
      const json = await res.json();
      if (i === 5) fifthPayload = json;
    }
    assert.equal(providerCounter.calls, 5);

    // 6th new request -> 429 QUOTA_REACHED with action & resetAt
    const sixth = await handleAnalyzeCv(
      makeJsonRequest({
        payload: {
          cvText: FIXTURES.en.cvText,
          jobDescription: FIXTURES.en.jobDescription,
          language: 'en',
          requestId: 'req-quota-6',
        },
        ip,
      }),
      { store, provider, logger: () => {} }
    );
    assert.equal(sixth.status, 429);
    const sixthBody = await sixth.json();
    assert.equal(sixthBody.error?.code, ERROR_CODES.QUOTA_REACHED);
    assert.equal(sixthBody.error?.action, 'analyze');
    assert.equal(typeof sixthBody.error?.resetAt, 'string');
    assert.equal(providerCounter.calls, 5);

    // Retry request 5 via x-request-id header after simulated lost response -> identical sessionId & payload!
    const retry = await handleAnalyzeCv(
      makeJsonRequest({
        payload: {
          cvText: FIXTURES.en.cvText,
          jobDescription: FIXTURES.en.jobDescription,
          language: 'en',
        },
        ip,
        headerRequestId: 'req-quota-5',
      }),
      { store, provider, logger: () => {} }
    );
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.deepEqual(retryBody, fifthPayload);
    assert.equal(providerCounter.calls, 5);
  });

  it('SPEC-MED-02: requestId idempotency cache is bound to CV/JD/language payload digest on shared NAT IPs', async () => {
    const { store } = createTrackedStore();
    const providerCounter = { calls: 0 };
    const sharedIp = '198.51.100.88';
    const logger = () => {};

    const firstRes = await handleAnalyzeCv(
      makeJsonRequest({
        payload: {
          cvText: FIXTURES.en.cvText,
          jobDescription: FIXTURES.en.jobDescription,
          language: 'en',
          requestId: 'req-shared-collision-1',
        },
        ip: sharedIp,
      }),
      { store, provider: makeStandardStubProvider(providerCounter), logger }
    );
    assert.equal(firstRes.status, 200);
    const firstBody = await firstRes.json();

    // Different CV with the exact same requestId on the same IP must NOT replay firstBody!
    const secondCvText =
      'Built a Python script to clean duplicate rows. Helped make weekly reports in Excel. Wrote instructions for the reports. Created dashboard charts.';
    const secondRes = await handleAnalyzeCv(
      makeJsonRequest({
        payload: {
          cvText: secondCvText,
          jobDescription: 'Analytics intern requiring Python, Excel, and SQL.',
          language: 'en',
          requestId: 'req-shared-collision-1',
        },
        ip: sharedIp,
      }),
      { store, provider: makeStandardStubProvider(providerCounter), logger }
    );
    assert.equal(secondRes.status, 200);
    const secondBody = await secondRes.json();

    assert.notEqual(secondBody.sessionId, firstBody.sessionId);
    assert.equal(providerCounter.calls, 2);
  });

  it('handleFeedback accepts valid ID/EN submissions and rejects invalid payloads with 400', async () => {
    const { store } = createTrackedStore();
    const logger = () => {};
    const fbUrl = 'http://localhost:3000/api/feedback';
    const [first, second, third] = await Promise.all(Array.from({ length: 3 }, () => store.createSession({})));

    const r1 = await handleFeedback(
      makeJsonRequest({ url: fbUrl, payload: { sessionId: first.sessionId, positive: true, language: 'id' } }),
      { store, logger }
    );
    assert.equal(r1.status, 200);
    assert.deepEqual(await r1.json(), { positive: 1, total: 1, satisfactionRate: 100 });

    const r2 = await handleFeedback(
      makeJsonRequest({ url: fbUrl, payload: { sessionId: second.sessionId, positive: false, language: 'en' } }),
      { store, logger }
    );
    assert.equal(r2.status, 200);
    assert.deepEqual(await r2.json(), { positive: 1, total: 2, satisfactionRate: 50 });

    const r3 = await handleFeedback(
      makeJsonRequest({ url: fbUrl, payload: { sessionId: third.sessionId, positive: true, language: 'en' } }),
      { store, logger }
    );
    assert.equal(r3.status, 200);
    assert.deepEqual(await r3.json(), { positive: 2, total: 3, satisfactionRate: 66.7 });

    const invalidCases = [
      makeJsonRequest({ url: fbUrl, payload: { positive: true, language: 'id' } }),
      makeJsonRequest({ url: fbUrl, payload: { sessionId: first.sessionId, positive: 'yes', language: 'id' } }),
      makeJsonRequest({ url: fbUrl, payload: { sessionId: first.sessionId, positive: true, language: 'es' } }),
      makeJsonRequest({ url: fbUrl, payload: { sessionId: first.sessionId, positive: true, language: 'id', extra: 'a'.repeat(4096) } }),
      makeJsonRequest({ url: fbUrl, payload: '{invalid-json' }),
      makeJsonRequest({ url: fbUrl, payload: { positive: true, language: 'id' }, contentType: 'text/plain' }),
    ];
    for (const req of invalidCases) {
      const bad = await handleFeedback(req, { store, logger });
      assert.equal(bad.status, 400);
      const body = await bad.json();
      assert.equal(body.error?.code, ERROR_CODES.INVALID_INPUT);
    }
  });

  it('counts the first response once, throttles retries and rejects expired sessions', async () => {
    let timestamp = Date.parse('2026-11-26T02:00:00Z');
    const now = () => timestamp;
    const store = createMemoryStore({ now });
    const { sessionId, expiresAt } = await store.createSession({});
    const vote = (positive, language = 'en', id = sessionId) => handleFeedback(
      makeJsonRequest({ url: 'http://localhost/api/feedback', payload: { sessionId: id, positive, language } }),
      { store, now, env: {}, logger: () => {} }
    );

    const unknown = await vote(true, 'en', 'sess_unknown');
    assert.equal(unknown.status, 410);
    assert.deepEqual(await unknown.json(), { error: { code: ERROR_CODES.SESSION_EXPIRED } });

    const responses = await Promise.all(Array.from({ length: 9 }, () => vote(true)));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { total: 1, positive: 1, satisfactionRate: 100 });
    }
    const limited = await vote(false, 'id');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.deepEqual(await limited.json(), {
      error: { code: ERROR_CODES.QUOTA_REACHED, resetAt: '2026-11-26T02:01:00.000Z' },
    });

    timestamp += 60_000;
    const replay = await vote(false, 'id');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).total, 1);
    assert.deepEqual((await store.getFeedbackSummary()).byLanguage, {
      id: { positive: 0, total: 0 },
      en: { positive: 1, total: 1 },
    });
    assert.equal((await store.getSession(sessionId)).expiresAt, expiresAt);
    timestamp = Date.parse(expiresAt);
    assert.equal((await vote(true)).status, 410);
    assert.equal((await store.getFeedbackSummary()).total, 1);
  });
});
