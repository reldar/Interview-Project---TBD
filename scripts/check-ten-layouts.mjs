import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { handleAnalyzeCv } from '../app/api/analyze-cv/route.js';
import { createGeminiProvider } from '../lib/ats.js';
import { ERROR_CODES, buildCvReportText, getErrorCopy } from '../lib/contracts.js';
import { createMemoryStore } from '../lib/store.js';
import { generateFixtures } from './generate-layout-pdfs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function loadDotEnvLocal() {
  if (process.env.GEMINI_API_KEY) return;
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  let raw;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function normalizeWs(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function checkExtractionOrder(sentCvText, expectedBullets) {
  if (!expectedBullets || expectedBullets.length === 0) {
    return { ok: true, found: 0, total: 0, ordered: true };
  }
  const haystack = normalizeWs(sentCvText);
  let prevIdx = -1;
  let found = 0;
  let ordered = true;

  for (const bullet of expectedBullets) {
    const needle = normalizeWs(bullet.replace(/^[-*•]\s*/, ''));
    const idx = haystack.indexOf(needle);
    if (idx >= 0) {
      found += 1;
      if (idx < prevIdx) ordered = false;
      prevIdx = idx;
    } else {
      ordered = false;
    }
  }
  return { ok: found === expectedBullets.length && ordered, found, total: expectedBullets.length, ordered };
}

function findLeakedPii(syntheticPii, texts) {
  const leaks = [];
  for (const entry of syntheticPii) {
    const rawVal = entry.includes(':') ? entry.split(':').slice(1).join(':').trim() : entry.trim();
    for (const txt of texts) {
      if (txt.includes(entry) || (rawVal && rawVal.length >= 4 && txt.includes(rawVal))) {
        leaks.push(entry);
        break;
      }
    }
  }
  return leaks;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

const HARNESS_ENV = Object.freeze({
  VERCEL: '1',
  VERCEL_ENV: 'production',
  QUOTA_HMAC_SECRET: 'local-ten-layout-check-secret-32chars',
});

const STUB_MISSING_CANDIDATES = [
  'Apache Airflow',
  'Looker Studio',
  'Power BI',
  'REST APIs',
  'TypeScript',
  'Playwright',
  'Tableau',
  'Looker',
  'Git',
  'SQL',
];

function pickStubMissingKeywords(spec) {
  const jdLower = String(spec.sampleJobDescription || '').toLowerCase();
  const matchedLower = new Set(
    (spec.expectedSkills || []).map((skill) => String(skill).toLowerCase())
  );
  for (const candidate of STUB_MISSING_CANDIDATES) {
    const lower = candidate.toLowerCase();
    if (!matchedLower.has(lower) && jdLower.includes(lower)) {
      return [candidate];
    }
  }
  return [];
}

function paraphraseStubBullet(orig, language) {
  const rules =
    language === 'id'
      ? [
          [/^Menyusun\b/, 'Menyiapkan'],
          [/^Membuat\b/, 'Mengembangkan'],
          [/^Membantu\b/, 'Mendukung'],
          [/^Menyiapkan\b/, 'Mendokumentasikan'],
          [/^Built\b/, 'Mengembangkan'],
          [/^Cleaned\b/, 'Membersihkan'],
          [/^Maintained\b/, 'Memelihara'],
          [/^Coordinated\b/, 'Mengoordinasikan'],
          [/^Helped\b/, 'Mendukung'],
          [/^Wrote\b/, 'Mendokumentasikan'],
        ]
      : [
          [/^Built\b/, 'Developed'],
          [/^Helped prepare\b/, 'Supported preparing'],
          [/^Helped\b/, 'Supported'],
          [/^Wrote step-by-step instructions\b/, 'Documented step-by-step instructions'],
          [/^Wrote\b/, 'Developed'],
          [/^Automated\b/, 'Implemented automated'],
          [/^Created\b/, 'Developed'],
          [/^Maintained\b/, 'Updated and maintained'],
          [/^Extracted\b/, 'Queried'],
          [/^Verified\b/, 'Validated'],
          [/^Standardized\b/, 'Unified'],
          [/^Refactored\b/, 'Improved'],
          [/^Designed\b/, 'Created'],
          [/^Guided\b/, 'Supported'],
          [/^Graded\b/, 'Reviewed'],
          [/^Modeled\b/, 'Designed'],
          [/^Documented\b/, 'Compiled documentation for'],
          [/^Coordinated\b/, 'Organized'],
        ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(orig)) {
      return orig.replace(pattern, replacement);
    }
  }
  return language === 'id' ? `Memperjelas: ${orig}` : `Clarified: ${orig}`;
}

function createOfflineStubProvider(spec) {
  return async () => {
    const rewrites = spec.expectedBullets.slice(0, 3).map((b) => {
      const orig = b.replace(/^-\s*/, '');
      return {
        original: orig,
        improved: paraphraseStubBullet(orig, spec.language),
        reason:
          spec.language === 'id'
            ? 'Memperjelas tindakan sesuai CV. Tambahkan metrik jika diketahui.'
            : 'Clarifies action supported by CV. Add measurable scope if known.',
      };
    });
    return JSON.stringify({
      atsScore: spec.expectedBullets.length === 0 ? 42 : 76,
      matchedKeywords: spec.expectedSkills,
      missingKeywords: pickStubMissingKeywords(spec),
      rewrites,
    });
  };
}

function makeUploadRequest(bytes, filename, jobDescription, language, ip) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  form.append('jobDescription', jobDescription);
  form.append('language', language);
  return new Request('http://localhost:3000/api/analyze-cv', {
    method: 'POST',
    headers: { 'x-vercel-forwarded-for': ip },
    body: form,
  });
}

async function runValidSpec({ spec, pdfBytes, ip, offline, store }) {
  let capturedPrompt = null;
  const attempts = [];
  const underlying = offline
    ? createOfflineStubProvider(spec)
    : createGeminiProvider({
        fetchImpl: async (url, init) => {
          const model = url.match(/models\/([^:]+)/)?.[1] || 'unknown';
          const t0 = performance.now();
          try {
            const res = await fetch(url, init);
            attempts.push(`${model}:${res.status}(${Math.round(performance.now() - t0)}ms)`);
            return res;
          } catch (err) {
            attempts.push(`${model}:${err.name || 'ERR'}(${Math.round(performance.now() - t0)}ms)`);
            throw err;
          }
        },
      });

  const observingProvider = {
    async generateAtsAnalysis(args) {
      capturedPrompt = args;
      if (typeof underlying === 'function') {
        return underlying(args);
      }
      return underlying.generateAtsAnalysis(args);
    },
  };

  const req = makeUploadRequest(
    pdfBytes,
    spec.filename,
    spec.sampleJobDescription,
    spec.language,
    ip
  );

  const t0 = performance.now();
  const res = await handleAnalyzeCv(req, {
    store,
    provider: observingProvider,
    env: HARNESS_ENV,
    logger: () => {},
  });
  const latencyMs = Math.round(performance.now() - t0);
  const body = await res.json();

  const sentCv = capturedPrompt?.sanitizedCvText || '';
  const sentJd = capturedPrompt?.sanitizedJd || '';
  const orderCheck = checkExtractionOrder(sentCv, spec.expectedBullets);
  const missedSkills = spec.expectedSkills.filter((skill) => !sentCv.includes(skill));
  const missedLandmarks = spec.survivingLandmarks.filter((lm) => !sentCv.includes(lm));

  const exportedText = res.status === 200 ? buildCvReportText(body, spec.language) : '';
  const leakedPii = findLeakedPii(spec.syntheticPii, [
    sentCv,
    sentJd,
    JSON.stringify(body),
    exportedText,
  ]);
  const sessionLeaked = res.status === 200 && body.sessionId ? exportedText.includes(body.sessionId) : false;

  const isSparseTwo = spec.id === 'sparse-two-bullets';
  const isSparseZero = spec.id === 'sparse-zero-bullets';
  const rewriteCount = Array.isArray(body?.rewrites) ? body.rewrites.length : -1;

  let rewriteCheckOk = false;
  if (res.status === 200) {
    if (isSparseZero) {
      rewriteCheckOk = rewriteCount === 0;
    } else if (isSparseTwo) {
      rewriteCheckOk = rewriteCount >= 1 && rewriteCount <= 2;
    } else {
      rewriteCheckOk = rewriteCount >= 3 && rewriteCount <= 5;
    }
  }

  const stubParaphrasedOk =
    !offline ||
    (Array.isArray(body?.rewrites) &&
      body.rewrites.every((rw) => rw.improved !== rw.original));

  const passed =
    res.status === 200 &&
    orderCheck.ok &&
    missedSkills.length === 0 &&
    missedLandmarks.length === 0 &&
    leakedPii.length === 0 &&
    !sessionLeaked &&
    Number.isInteger(body?.atsScore) &&
    body.atsScore >= 0 &&
    body.atsScore <= 100 &&
    rewriteCheckOk &&
    stubParaphrasedOk;

  const notes = [];
  if (res.status !== 200) notes.push(`HTTP ${res.status} (${body?.error?.code || 'ERR'})`);
  if (!orderCheck.ok) notes.push(`bullets ${orderCheck.found}/${orderCheck.total} ordered=${orderCheck.ordered}`);
  if (missedSkills.length) notes.push(`missedSkills=[${missedSkills.join(',')}]`);
  if (missedLandmarks.length) notes.push(`missedLandmarks=[${missedLandmarks.join(',')}]`);
  if (leakedPii.length) notes.push(`leakedPii=[${leakedPii.join(',')}]`);
  if (sessionLeaked) notes.push('sessionId in export');
  if (res.status === 200 && !rewriteCheckOk) notes.push(`unexpected rewriteCount=${rewriteCount}`);
  if (res.status === 200 && !stubParaphrasedOk) notes.push('verbatim stub rewrite');

  return {
    id: spec.id,
    layout: spec.layout,
    language: spec.language,
    status: res.status,
    errorCode: body?.error?.code || null,
    orderOk: orderCheck.ok,
    skillsLabel: `${spec.expectedSkills.length - missedSkills.length}/${spec.expectedSkills.length}`,
    bulletsLabel: `${orderCheck.found}/${orderCheck.total}`,
    piiMasked: leakedPii.length === 0 && !sessionLeaked,
    landmarksLabel: `${spec.survivingLandmarks.length - missedLandmarks.length}/${spec.survivingLandmarks.length}`,
    atsScore: res.status === 200 ? body.atsScore : null,
    matchedCount: Array.isArray(body?.matchedKeywords) ? body.matchedKeywords.length : 0,
    missingCount: Array.isArray(body?.missingKeywords) ? body.missingKeywords.length : 0,
    rewriteCount: res.status === 200 ? rewriteCount : 0,
    latencyMs,
    attempts: attempts.join(' -> '),
    passed,
    notes: notes.join('; '),
  };
}

async function runInvalidSpec({ spec, pdfBytes, ip, store }) {
  let providerCalls = 0;
  const req = makeUploadRequest(
    pdfBytes,
    spec.filename,
    'Data Intern. Python, Excel, and SQL required.',
    'en',
    ip
  );
  const t0 = performance.now();
  const res = await handleAnalyzeCv(req, {
    store,
    env: HARNESS_ENV,
    provider: async () => {
      providerCalls += 1;
      return '{}';
    },
    logger: () => {},
  });
  const latencyMs = Math.round(performance.now() - t0);
  const body = await res.json();
  const code = body?.error?.code || null;
  const copyEn = getErrorCopy(ERROR_CODES.PDF_UNREADABLE, 'en');
  const copyId = getErrorCopy(ERROR_CODES.PDF_UNREADABLE, 'id');
  const passed =
    res.status === 422 &&
    code === spec.expectedCode &&
    providerCalls === 0 &&
    Boolean(copyEn) &&
    Boolean(copyId);

  return {
    id: spec.id,
    kind: spec.kind,
    expected: `422 ${spec.expectedCode}`,
    actual: `${res.status} ${code || 'NONE'}`,
    providerCalls,
    latencyMs,
    passed,
  };
}

async function main() {
  const offline = process.argv.includes('--offline');
  if (!offline) {
    await loadDotEnvLocal();
    if (!process.env.GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY (set env var, provide .env.local, or pass --offline).');
      process.exitCode = 1;
      return;
    }
  }

  const baseGeminiProvider = offline ? null : createGeminiProvider();
  const store = createMemoryStore();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'latihkerja-ten-layouts-'));

  try {
    const manifest = await generateFixtures(tempDir);

    const readableResults = [];
    for (let i = 0; i < manifest.readable.length; i += 1) {
      const spec = manifest.readable[i];
      const pdfBytes = await readFile(path.join(tempDir, spec.filename));
      const res = await runValidSpec({
        spec,
        pdfBytes,
        ip: `198.51.100.${i + 1}`,
        offline,
        store,
      });
      readableResults.push(res);
    }

    const sparseResults = [];
    for (let i = 0; i < manifest.sparse.length; i += 1) {
      const spec = manifest.sparse[i];
      const pdfBytes = await readFile(path.join(tempDir, spec.filename));
      const res = await runValidSpec({
        spec,
        pdfBytes,
        ip: `198.51.100.${50 + i + 1}`,
        offline,
        store,
      });
      sparseResults.push(res);
    }

    const invalidResults = [];
    for (let i = 0; i < manifest.invalid.length; i += 1) {
      const spec = manifest.invalid[i];
      const pdfBytes = await readFile(path.join(tempDir, spec.filename));
      const res = await runInvalidSpec({
        spec,
        pdfBytes,
        ip: `198.51.100.${100 + i + 1}`,
        store,
      });
      invalidResults.push(res);
    }

    const modeLabel = offline ? 'offline-stub' : `live-gemini (${baseGeminiProvider.models.join(' -> ')})`;
    console.log(`# Day-5 Ten-Layout Verification (${modeLabel})\n`);

    console.log('## 10 Readable Layouts\n');
    console.log('| # | Layout | Lang | Order | Skills | Bullets | PII Masked | Landmarks | Status | Score | Matched/Missing | Rewrites | Latency (ms) | Result |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    readableResults.forEach((r, idx) => {
      const detail = r.attempts ? ` [${r.attempts}]` : '';
      console.log(
        `| ${idx + 1} | ${r.layout} | ${r.language} | ${r.orderOk ? 'PASS' : 'FAIL'} | ${r.skillsLabel} | ${r.bulletsLabel} | ${r.piiMasked ? 'PASS' : 'FAIL'} | ${r.landmarksLabel} | ${r.status} | ${r.atsScore ?? '-'} | ${r.matchedCount}/${r.missingCount} | ${r.rewriteCount} | ${r.latencyMs} | ${r.passed ? 'PASS' : `FAIL (${r.notes}${detail})`} |`
      );
    });

    console.log('\n## 2 Sparse CV Layouts\n');
    console.log('| ID | Lang | Order | Skills | Bullets | PII Masked | Landmarks | Status | Score | Matched/Missing | Rewrites | Latency (ms) | Result |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of sparseResults) {
      const detail = r.attempts ? ` [${r.attempts}]` : '';
      console.log(
        `| ${r.id} | ${r.language} | ${r.orderOk ? 'PASS' : 'FAIL'} | ${r.skillsLabel} | ${r.bulletsLabel} | ${r.piiMasked ? 'PASS' : 'FAIL'} | ${r.landmarksLabel} | ${r.status} | ${r.atsScore ?? '-'} | ${r.matchedCount}/${r.missingCount} | ${r.rewriteCount} | ${r.latencyMs} | ${r.passed ? 'PASS' : `FAIL (${r.notes}${detail})`} |`
      );
    }

    if (!offline) {
      console.log('\n## Model Attempt Trace\n');
      for (const r of [...readableResults, ...sparseResults]) {
        console.log(`- ${r.id}: ${r.attempts || 'none'}`);
      }
    }

    console.log('\n## 4 Invalid PDFs (Tracked Separately)\n');
    console.log('| ID | Kind | Expected | Actual | Provider Calls | Latency (ms) | Result |');
    console.log('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of invalidResults) {
      console.log(
        `| ${r.id} | ${r.kind} | ${r.expected} | ${r.actual} | ${r.providerCalls} | ${r.latencyMs} | ${r.passed ? 'PASS' : 'FAIL'} |`
      );
    }

    const latencies = readableResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const under8s = readableResults.filter((r) => r.passed && r.latencyMs < 8000).length;
    console.log('\n## Latency Distribution (10 Readable Layouts — §11 Target < 8,000 ms)\n');
    console.log(`- Sample count: ${readableResults.length}`);
    console.log(`- Passed: ${readableResults.filter((r) => r.passed).length}/${readableResults.length}`);
    console.log(`- Min: ${latencies[0]} ms`);
    console.log(`- Median (p50): ${Math.round(median(latencies))} ms`);
    console.log(`- p95: ${percentile(latencies, 95)} ms`);
    console.log(`- Max: ${latencies[latencies.length - 1]} ms`);
    console.log(`- Under 8,000 ms: ${under8s}/${readableResults.length}`);

    const allPassed =
      readableResults.every((r) => r.passed) &&
      sparseResults.every((r) => r.passed) &&
      invalidResults.every((r) => r.passed);

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
