import {
  AppError,
  ERROR_CODES,
  INTERVIEW_QUESTION_COUNT,
  isInterviewQuestion,
  validateInterviewAnswerRequest,
} from '../../../../lib/contracts.js';
import { generateInterviewFeedback, getCompletedInterviewReport, withInterviewGeneration } from '../../../../lib/interview.js';
import { buildInterviewSummary, isInterviewSummary } from '../../../../lib/interview-report.js';
import { logRouteEvent } from '../../../../lib/logger.js';
import { redactPii } from '../../../../lib/redact.js';
import { deriveIpHash, getStore } from '../../../../lib/store.js';
import { readBoundedJson } from '../../../../lib/request-body.js';
import { budgetedGeminiProvider, getAiBudgetLimits, requireAiBudget } from '../../../../lib/ai-budget.js';

export const runtime = 'nodejs';
const ROUTE = '/api/interview/answer';

function questionAt(interview, number) {
  const question = interview.questions[number - 1];
  if (!isInterviewQuestion(question, number)) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
  const { questionNumber, questionText, focusArea } = question;
  return { questionNumber, questionText, focusArea };
}

function answerResult(interview, record) {
  if (record.questionNumber === INTERVIEW_QUESTION_COUNT) {
    const report = getCompletedInterviewReport(interview);
    if (!report) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    return { feedback: record.feedback, nextQuestion: null, ...report };
  }
  return {
    feedback: record.feedback,
    nextQuestion: questionAt(interview, record.questionNumber + 1),
    ...(interview.completed ? { completedReport: getCompletedInterviewReport(interview) }
      : interview.currentQuestion > record.questionNumber + 1
        ? { resumeQuestion: questionAt(interview, interview.currentQuestion) } : {}),
    finalSummary: null,
  };
}

function matchesAnswer(record, sanitizedAnswer) {
  return record && (record.userAnswer === sanitizedAnswer || redactPii(record.userAnswer).trim() === sanitizedAnswer);
}

function conflict(interview) {
  const completed = interview?.completed === true;
  return new AppError(ERROR_CODES.QUESTION_CONFLICT, {
    completed,
    currentQuestion: interview && !completed ? questionAt(interview, interview.currentQuestion) : null,
    report: completed ? getCompletedInterviewReport(interview) : null,
  });
}

export async function handleInterviewAnswer(request, deps = {}) {
  const log = deps.logger ?? logRouteEvent;
  const startedAt = Date.now();
  const headers = { 'cache-control': 'no-store' };
  function respond(payload, status, code) {
    log({ route: ROUTE, status, code, elapsedMs: Date.now() - startedAt });
    return Response.json(payload, { status, headers });
  }

  try {
    const body = await readBoundedJson(request, 32_768);
    const { sessionId, questionNumber, userAnswer } = validateInterviewAnswerRequest(body);
    const sanitizedAnswer = redactPii(userAnswer).trim();
    if (!sanitizedAnswer) throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'userAnswer' });

    const store = deps.store ?? getStore();
    const session = await store.getSession(sessionId);
    if (!session) throw new AppError(ERROR_CODES.SESSION_EXPIRED);
    const { interview } = session;
    if (!interview) throw conflict(null);
    headers['content-language'] = interview.language;

    const records = interview.answers ?? [];
    const previous = records[questionNumber - 1];
    if (matchesAnswer(previous, sanitizedAnswer)) {
      return respond(answerResult(interview, previous), 200, 'OK');
    }
    if (interview.completed || interview.currentQuestion !== questionNumber) throw conflict(interview);
    if (records.length !== questionNumber - 1) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);

    const ipHash = deriveIpHash(request, deps.ipSecret, deps.env);
    const limits = getAiBudgetLimits(deps.env);
    await requireAiBudget(store, limits);
    const outcome = await withInterviewGeneration(store, { session, ipHash, questionNumber }, async (claim) => {
      const feedback = await generateInterviewFeedback({
        mode: interview.mode,
        language: interview.language,
        question: questionAt(interview, questionNumber),
        sanitizedJd: session.sanitizedJd,
        userAnswer: sanitizedAnswer,
      }, deps.provider ?? budgetedGeminiProvider(store, limits, claim, deps.geminiOptions));
      const record = { questionNumber, userAnswer: sanitizedAnswer, feedback };
      const completed = questionNumber === INTERVIEW_QUESTION_COUNT;
      const nextInterview = {
        ...interview,
        answers: [...records, record],
        currentQuestion: completed ? null : questionNumber + 1,
        completed,
      };
      if (completed) {
        nextInterview.finalSummary = buildInterviewSummary(nextInterview.answers, interview.language);
        if (!isInterviewSummary(nextInterview.finalSummary)) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
      }
      return { interview: nextInterview, response: answerResult(nextInterview, record) };
    });
    if (outcome.response) return respond(outcome.response, 200, 'OK');
    const latest = outcome.session?.interview;
    const winner = latest?.answers?.[questionNumber - 1];
    if (matchesAnswer(winner, sanitizedAnswer)) {
      return respond(answerResult(latest, winner), 200, 'OK');
    }
    throw conflict(latest);
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    const error = { code: appError.code };
    if (appError.code === ERROR_CODES.INVALID_INPUT) error.field = appError.meta.field;
    if (appError.code === ERROR_CODES.QUOTA_REACHED) {
      error.action = appError.meta.action;
      error.resetAt = appError.meta.resetAt;
    }
    if (appError.code === ERROR_CODES.QUESTION_CONFLICT) {
      error.currentQuestion = appError.meta.currentQuestion ?? null;
      error.completed = appError.meta.completed === true;
      if (error.completed) error.report = appError.meta.report;
    }
    return respond({ error }, appError.status, appError.code);
  }
}

export async function POST(request) {
  return handleInterviewAnswer(request);
}
