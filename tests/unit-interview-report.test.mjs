import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInterviewReportText, buildInterviewSummary, isInterviewReport, isInterviewSummary,
} from '../lib/interview-report.js';

const transcript = [
  [3, 5, 2], [5, 4, 1], [5, 5, 2], [4, 4, 4], [4, 5, 3],
].map(([clarityScore, relevanceScore, impactScore], index) => ({
  questionNumber: index + 1,
  questionText: `Pertanyaan fik·tif ${index + 1}?`,
  userAnswer: `Jawaban ${index + 1}.\nBaris kedua — kerja sama.`,
  feedback: { clarityScore, relevanceScore, impactScore, suggestion: `Saran perbaikan ${index + 1}.` },
}));

test('summary averages all five records and uses the lowest impact answer’s committed tip', () => {
  const summary = buildInterviewSummary(transcript, 'id');
  assert.deepEqual(summary, {
    questionsAnswered: 5,
    averageScores: { clarity: 4.2, relevance: 4.6, impact: 2.4 },
    strengths: ['Relevansi termasuk aspek dengan nilai tertinggi.'],
    nextSteps: ['Saran perbaikan 2.'],
  });
  assert.ok(isInterviewSummary(summary));
  assert.equal(isInterviewSummary({ ...summary, averageScores: { ...summary.averageScores, impact: 2.33 } }), false);
});

test('summary requires five ordered valid feedback records and handles ties deterministically', () => {
  assert.equal(buildInterviewSummary(transcript.slice(0, 4), 'en'), null);
  assert.equal(buildInterviewSummary([...transcript].reverse(), 'en'), null);
  assert.equal(buildInterviewSummary([...transcript.slice(0, 4), { ...transcript[4], feedback: {} }], 'en'), null);
  const tied = transcript.map((record) => ({
    ...record, feedback: { ...record.feedback, clarityScore: 2, relevanceScore: 2, impactScore: 2 },
  }));
  assert.deepEqual(buildInterviewSummary(tied, 'en').nextSteps, ['Saran perbaikan 1.']);
  assert.deepEqual(buildInterviewSummary(tied, 'en').strengths, []);
});

test('exports only report fields, with localized scores, line breaks and masked identifiers', () => {
  const email = 'candidate@example.org';
  const records = transcript.map((record) => ({
    ...record, userAnswer: `${record.userAnswer} ${email}`, rawMetadata: 'metadata-token',
  }));
  const report = {
    finalSummary: buildInterviewSummary(records, 'id'),
    transcript: records,
    mode: 'user',
    sessionId: 'sess_secret_id',
  };
  assert.ok(isInterviewReport(report));
  assert.equal(isInterviewReport({ ...report, transcript: records.slice(1) }), false);
  const text = buildInterviewReportText(report, 'id');
  assert.match(text, /Teknis · Bahasa Indonesia/);
  assert.match(text, /Kejelasan: 4,2\/5/);
  assert.match(text, /Rata-rata keseluruhan: 3,7\/5/);
  assert.match(text, /Baris kedua — kerja sama\. \[EMAIL_REDACTED\]/);
  assert.equal((text.match(/^Pertanyaan [1-5]:/gm) ?? []).length, 5);
  assert.doesNotMatch(text, /candidate@example\.org|sess_secret_id|metadata-token/);
});
