import { AppError, ERROR_CODES, isInterviewQuestion, validateInterviewStartRequest } from '../../../../lib/contracts.js';
import { generateInterviewQuestions, getCompletedInterviewReport, withInterviewGeneration } from '../../../../lib/interview.js';
import { logRouteEvent } from '../../../../lib/logger.js';
import { deriveIpHash, getStore } from '../../../../lib/store.js';

export const runtime = 'nodejs';

const ROUTE = '/api/interview/start';
const HEADERS = { 'cache-control': 'no-store' };

export async function handleInterviewStart(request, deps = {}) {
  const log = deps.logger ?? logRouteEvent;
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const { sessionId, mode, language } = validateInterviewStartRequest(body);
    const store = deps.store ?? getStore();
    const session = await store.getSession(sessionId);
    if (!session) throw new AppError(ERROR_CODES.SESSION_EXPIRED);
    let interview = session.interview;
    if (!interview) {
      const ipHash = deriveIpHash(request, deps.ipSecret);
      const result = await withInterviewGeneration(store, { session, ipHash }, async () => {
        const questions = await generateInterviewQuestions({
          mode,
          language,
          sanitizedCvText: session.sanitizedCvText,
          sanitizedJd: session.sanitizedJd,
        }, deps.provider);
        return { interview: { mode, language, currentQuestion: 1, questions } };
      });
      interview = result.interview ?? result.session?.interview;
      if (!interview) throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    }

    const { currentQuestion, questions, completed, language: interviewLanguage } = interview;
    if (completed) {
      throw new AppError(ERROR_CODES.QUESTION_CONFLICT, {
        completed,
        language: interviewLanguage,
        report: getCompletedInterviewReport(interview),
      });
    }
    const question = questions[currentQuestion - 1];
    if (!isInterviewQuestion(question, currentQuestion)) {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    }
    const { questionNumber, questionText, focusArea } = question;
    log({ route: ROUTE, status: 200, code: 'OK', elapsedMs: Date.now() - startedAt });
    return Response.json({ questionNumber, questionText, focusArea }, {
      headers: { ...HEADERS, 'content-language': interviewLanguage },
    });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    const error = { code: appError.code };
    if (error.code === ERROR_CODES.INVALID_INPUT) error.field = appError.meta.field;
    if (appError.meta.completed) {
      error.completed = true;
      error.report = appError.meta.report;
    }
    if (error.code === ERROR_CODES.QUOTA_REACHED) {
      error.action = appError.meta.action;
      error.resetAt = appError.meta.resetAt;
    }
    log({ route: ROUTE, status: appError.status, code: appError.code, elapsedMs: Date.now() - startedAt });
    const headers = appError.meta.language ? { ...HEADERS, 'content-language': appError.meta.language } : HEADERS;
    return Response.json({ error }, { status: appError.status, headers });
  }
}

export async function POST(request) {
  return handleInterviewStart(request);
}
