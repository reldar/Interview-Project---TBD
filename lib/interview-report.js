import {
  INTERVIEW_MODES,
  INTERVIEW_QUESTION_COUNT,
  isInterviewFeedback,
} from './contracts.js';
import { redactPii } from './redact.js';

export const RUBRIC = [
  { key: 'clarity', score: 'clarityScore', id: 'Kejelasan', en: 'Clarity' },
  { key: 'relevance', score: 'relevanceScore', id: 'Relevansi', en: 'Relevance' },
  { key: 'impact', score: 'impactScore', id: 'Dampak', en: 'Impact' },
];

function hasFiveFeedbackRecords(records) {
  return Array.isArray(records) && records.length === INTERVIEW_QUESTION_COUNT
    && Array.from(records).every((record, index) =>
      record?.questionNumber === index + 1 && isInterviewFeedback(record.feedback));
}

export function buildInterviewSummary(records, language) {
  if (!hasFiveFeedbackRecords(records)) return null;
  const averageScores = Object.fromEntries(RUBRIC.map(({ key, score }) => [
    key, records.reduce((sum, record) => sum + record.feedback[score], 0) / INTERVIEW_QUESTION_COUNT,
  ]));
  const ranked = [...RUBRIC].sort((a, b) => averageScores[b.key] - averageScores[a.key]);
  const highest = averageScores[ranked[0].key];
  const lowest = Math.min(...Object.values(averageScores));
  const weakest = RUBRIC.find(({ key }) => averageScores[key] === lowest);
  const priority = records.reduce((lowestRated, record) =>
    record.feedback[weakest.score] < lowestRated.feedback[weakest.score] ? record : lowestRated);
  const strengths = ranked.filter(({ key }) => averageScores[key] === highest && highest >= 3).map((dimension) =>
    language === 'id'
      ? `${dimension.id} termasuk aspek dengan nilai tertinggi.`
      : `${dimension.en} was among your highest-rated areas.`);

  return {
    questionsAnswered: INTERVIEW_QUESTION_COUNT,
    averageScores,
    strengths,
    nextSteps: [redactPii(priority.feedback.suggestion).trim()],
  };
}

export function isInterviewSummary(summary) {
  const isTextList = (list) => Array.isArray(list)
    && Array.from(list).every((item) => typeof item === 'string' && item.trim());
  return summary?.questionsAnswered === INTERVIEW_QUESTION_COUNT
    && RUBRIC.every(({ key }) => {
      const value = summary.averageScores?.[key];
      return Number.isFinite(value) && value >= 1 && value <= 5 && Number.isInteger(value * 5);
    })
    && isTextList(summary.strengths)
    && isTextList(summary.nextSteps) && summary.nextSteps.length > 0;
}

export function isInterviewReport(report) {
  return isInterviewSummary(report?.finalSummary)
    && INTERVIEW_MODES.includes(report.mode)
    && hasFiveFeedbackRecords(report.transcript)
    && report.transcript.every(({ questionText, userAnswer }) =>
      typeof questionText === 'string' && questionText.trim()
      && typeof userAnswer === 'string' && userAnswer.trim());
}

export function interviewReportLabels(language) {
  return language === 'id'
    ? {
      title: 'Ringkasan wawancara', mode: 'Mode', language: 'Bahasa Indonesia',
      technical: 'Teknis', answered: 'Pertanyaan terjawab', overall: 'Rata-rata keseluruhan',
      strengths: 'Kekuatan', noStrengths: 'Belum ada kekuatan yang menonjol pada rubrik.',
      nextSteps: 'Prioritas perbaikan', review: 'Tinjauan lima pertanyaan',
      question: 'Pertanyaan', answer: 'Jawaban', tip: 'Saran',
    }
    : {
      title: 'Interview report', mode: 'Mode', language: 'English',
      technical: 'Technical', answered: 'Questions answered', overall: 'Overall average',
      strengths: 'Strengths', noStrengths: 'The rubric scores did not show a clear strength yet.',
      nextSteps: 'Improvement priorities', review: 'Five-question review',
      question: 'Question', answer: 'Answer', tip: 'Tip',
    };
}

export function formatInterviewAverage(value, language) {
  return new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function overallInterviewAverage(averageScores) {
  return RUBRIC.reduce((sum, { key }) => sum + averageScores[key], 0) / RUBRIC.length;
}

export function buildInterviewReportText({ finalSummary, mode, transcript }, language) {
  const labels = interviewReportLabels(language);
  const { averageScores, questionsAnswered, strengths, nextSteps } = finalSummary;
  return [
    labels.title,
    '',
    `${labels.mode}: ${mode === 'hrd' ? 'HR' : labels.technical} · ${labels.language}`,
    `${labels.answered}: ${questionsAnswered}/${INTERVIEW_QUESTION_COUNT}`,
    `${labels.overall}: ${formatInterviewAverage(overallInterviewAverage(averageScores), language)}/5`,
    ...RUBRIC.map(({ key, ...dimension }) =>
      `${dimension[language]}: ${formatInterviewAverage(averageScores[key], language)}/5`),
    '',
    labels.strengths,
    ...(strengths.length ? strengths : [labels.noStrengths]).map((item) => `- ${redactPii(item)}`),
    '',
    labels.nextSteps,
    ...nextSteps.map((item) => `- ${redactPii(item)}`),
    '',
    labels.review,
    ...transcript.flatMap(({ questionNumber, questionText, userAnswer, feedback }) => [
      '',
      `${labels.question} ${questionNumber}: ${redactPii(questionText)}`,
      `${labels.answer}: ${redactPii(userAnswer)}`,
      RUBRIC.map(({ score, ...dimension }) => `${dimension[language]} ${feedback[score]}/5`).join(' · '),
      `${labels.tip}: ${redactPii(feedback.suggestion)}`,
    ]),
  ].join('\n') + '\n';
}
