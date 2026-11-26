import { AppError, ERROR_CODES, isInterviewQuestion, validateInterviewStartRequest } from '../../../../lib/contracts.js';
import { generateInterviewQuestions, getCompletedInterviewReport } from '../../../../lib/interview.js';
import { logRouteEvent } from '../../../../lib/logger.js';
import { deriveIpHash, getStore } from '../../../../lib/store.js';

export const runtime = 'nodejs';

const ROUTE = '/api/interview/start';
const ACTION = 'interviewStart';
const HEADERS = { 'cache-control': 'no-store' };

function requireAvailable(result) {
  switch (result.status) {
    case 'ready':
    case 'active':
      return result;
    case 'expired':
      throw new AppError(ERROR_CODES.SESSION_EXPIRED);
    case 'limited':
      throw new AppError(ERROR_CODES.QUOTA_REACHED, { action: ACTION, resetAt: result.resetAt });
    case 'conflict':
      throw new AppError(ERROR_CODES.QUESTION_CONFLICT);
    default:
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
  }
}

export async function handleInterviewStart(request, deps = {}) {
  const log = deps.logger ?? logRouteEvent;
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const { sessionId, mode, language } = validateInterviewStartRequest(body);
    const store = deps.store ?? getStore();
    const ipHash = deriveIpHash(request, deps.ipSecret);
    let result = requireAvailable(await store.startInterview({ sessionId, ipHash }));

    if (result.status === 'ready') {
      const { session } = result;
      const questions = await generateInterviewQuestions({
        mode,
        language,
        sanitizedCvText: session.sanitizedCvText,
        sanitizedJd: session.sanitizedJd,
      }, deps.provider);
      result = requireAvailable(await store.startInterview({
        sessionId,
        ipHash,
        session,
        interview: { mode, language, currentQuestion: 1, questions },
      }));
    }

    const { currentQuestion, questions, completed, language: interviewLanguage } = result.interview;
    if (completed) {
      throw new AppError(ERROR_CODES.QUESTION_CONFLICT, {
        completed,
        language: interviewLanguage,
        report: getCompletedInterviewReport(result.interview),
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
      error.action = ACTION;
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
