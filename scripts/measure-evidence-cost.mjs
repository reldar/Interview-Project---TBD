import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FIXTURES, validateAnalysisPayload } from '../lib/contracts.js';
import { redactPii } from '../lib/redact.js';

const rounds = 5;
const iterations = 40;
const layouts = [7_500, 15_000, 30_000];
const lesson = 'Experience notes about spreadsheet reporting and data cleanup.\n';
const grow = (text, length) => text.repeat(Math.ceil(length / text.length)).slice(0, length);
const cvFixture = FIXTURES.en.cvText;
const jdFixture = FIXTURES.en.jobDescription;
const oversized = { ...FIXTURES.en.response, matchedKeywords: Array(2_500).fill('Python') };

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) };
}

function measure(run) {
  for (let i = 0; i < iterations; i += 1) assert.ok(run());
  const wall = [];
  const cpu = [];
  for (let round = 0; round < rounds; round += 1) {
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    for (let i = 0; i < iterations; i += 1) assert.ok(run());
    wall.push((performance.now() - wallStart) / iterations);
    const usage = process.cpuUsage(cpuStart);
    cpu.push((usage.user + usage.system) / (iterations * 1_000));
  }
  return { wall: summarize(wall), cpu: summarize(cpu) };
}

for (const cvSize of layouts) {
  const jdSize = cvSize / 2;
  const cv = `${cvFixture}\n${grow(lesson, cvSize - cvFixture.length - 1)}`;
  const jd = `${jdFixture}\n${grow(lesson, jdSize - jdFixture.length - 1)}`;
  const marker = '\nEmail: generated@example.test';
  const markerInput = `${grow('x', cvSize - marker.length)}${marker}`;
  const expectedRedaction = `${grow('x', cvSize - marker.length)}\nEmail: [EMAIL_REDACTED]`;
  console.log(JSON.stringify({
    cvSize, jdSize, rounds, iterations,
    valid: measure(() => validateAnalysisPayload(FIXTURES.en.response, cv, { sanitizedJd: jd }).ok),
    oversized: measure(() => validateAnalysisPayload(oversized, cv, { sanitizedJd: jd }).reason === 'Keyword groups cannot exceed 60 items.'),
    redaction: measure(() => redactPii(markerInput) === expectedRedaction),
  }));
}
