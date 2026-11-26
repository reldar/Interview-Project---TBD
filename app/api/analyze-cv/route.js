import { createHash, createHmac } from 'node:crypto';
import { analyzeCv } from '../../../lib/ats.js';
import {
  AppError,
  DAILY_LIMITS,
  ERROR_CODES,
  MAX_MULTIPART_OVERHEAD_BYTES,
  MAX_PDF_BYTES,
  validateCvText,
  validateJobDescription,
  validateLanguage,
} from '../../../lib/contracts.js';
import { logRouteEvent } from '../../../lib/logger.js';
import { extractPdfText } from '../../../lib/pdf.js';
import { redactPii } from '../../../lib/redact.js';
import { deriveIpHash, getStore } from '../../../lib/store.js';
import { readBoundedBytes, readBoundedJson } from '../../../lib/request-body.js';
import { budgetedGeminiProvider, getAiBudgetLimits, requireAiBudget } from '../../../lib/ai-budget.js';

export const runtime = 'nodejs';

const MAX_JSON_BODY_BYTES = 512_000;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function parseOptionalRequestId(candidate, headerCandidate) {
  const raw =
    typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : typeof headerCandidate === 'string' && headerCandidate.trim()
      ? headerCandidate.trim()
      : '';
  if (!raw) return '';
  if (!REQUEST_ID_RE.test(raw)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'requestId' });
  }
  return raw;
}

function buildErrorJson(appErr) {
  const errorObj = { code: appErr.code };
  if (appErr.code === ERROR_CODES.INVALID_INPUT && appErr.meta?.field) {
    errorObj.field = appErr.meta.field;
  }
  if (appErr.code === ERROR_CODES.QUOTA_REACHED) {
    errorObj.action = appErr.meta?.action || 'analyze';
    if (appErr.meta?.resetAt) {
      errorObj.resetAt = appErr.meta.resetAt;
    }
  }
  return Response.json({ error: errorObj }, { status: appErr.status });
}

export async function handleAnalyzeCv(request, deps = {}) {
  const now = deps.now || (() => Date.now());
  const startedAt = now();
  const log = deps.logger || logRouteEvent;
  let activeStore;
  let admission;
  let providerAttempted = false;
  let chargeAdmission = true;

  let transport = undefined;
  let language = undefined;
  let pdfPages = undefined;
  let pdfBytes = undefined;

  try {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    const headerRequestId = request.headers.get('x-request-id');

    let rawCvText = null;
    let rawJobDescription = null;
    let requestId = '';
    let file;

    if (contentType.includes('multipart/form-data')) {
      transport = 'multipart';
      const multipartCeiling = MAX_PDF_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
      let rawBody = await readBoundedBytes(request, multipartCeiling);

      let form;
      try {
        form = await new Response(rawBody, { headers: request.headers }).formData();
      } catch {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
      } finally {
        rawBody = null;
      }

      const files = form.getAll('file');
      file = files[0];
      if (files.length !== 1 || !(file instanceof Blob)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'file' });
      }
      if (file.size === 0) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'file' });
      }
      if (file.size > MAX_PDF_BYTES) {
        throw new AppError(ERROR_CODES.FILE_TOO_LARGE, 413);
      }
      if (file.type !== 'application/pdf') {
        throw new AppError(ERROR_CODES.UNSUPPORTED_FILE, 415);
      }

      const langField = form.get('language');
      const langCheck = validateLanguage(typeof langField === 'string' ? langField : '');
      if (!langCheck.ok) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'language' });
      }
      language = langCheck.value;

      const jdField = form.get('jobDescription');
      const jdCheck = validateJobDescription(typeof jdField === 'string' ? jdField : '');
      if (!jdCheck.ok) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'jobDescription' });
      }
      rawJobDescription = jdCheck.value;

      const formRequestId = form.get('requestId');
      requestId = parseOptionalRequestId(
        typeof formRequestId === 'string' ? formRequestId : '',
        headerRequestId
      );

    } else if (contentType.includes('application/json')) {
      transport = 'json';
      const body = await readBoundedJson(request, MAX_JSON_BODY_BYTES);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
      }

      const langCheck = validateLanguage(body.language);
      if (!langCheck.ok) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'language' });
      }
      language = langCheck.value;

      const cvCheck = validateCvText(body.cvText);
      if (!cvCheck.ok) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'cvText' });
      }
      rawCvText = cvCheck.value;

      const jdCheck = validateJobDescription(body.jobDescription);
      if (!jdCheck.ok) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'jobDescription' });
      }
      rawJobDescription = jdCheck.value;

      if (body.requestId !== undefined && body.requestId !== null && typeof body.requestId !== 'string') {
        throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'requestId' });
      }
      requestId = parseOptionalRequestId(body.requestId, headerRequestId);
    } else {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'body' });
    }

    activeStore = deps.store ?? getStore();
    const ipHash = deriveIpHash(request, deps.ipSecret, deps.env);
    const sanitizedJd = redactPii(rawJobDescription);
    rawJobDescription = null;
    let fileBytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    file = null;
    const fingerprint = createHmac('sha256', ipHash)
      .update(JSON.stringify([transport, language, sanitizedJd]))
      .update(fileBytes ?? redactPii(rawCvText))
      .digest('hex');
    const limits = getAiBudgetLimits(deps.env);
    const intake = await activeStore.claimCvAdmission({
      ipHash,
      fingerprint,
      limits,
      requestId: requestId ? createHash('sha256').update(`${requestId}\0${fingerprint}`).digest('hex') : '',
    });
    if (intake.status === 'cached') {
      log({ route: '/api/analyze-cv', status: 200, code: 'OK', elapsedMs: now() - startedAt, meta: { transport, language, cached: true } });
      return Response.json(intake.result);
    }
    const quotaActions = { limited: 'analyze', attempts: 'cvAdmission', budget: 'aiBudget', throttled: 'cvIntake' };
    if (Object.hasOwn(quotaActions, intake.status)) {
      throw new AppError(ERROR_CODES.QUOTA_REACHED, {
        action: quotaActions[intake.status],
        resetAt: intake.resetAt,
      });
    }
    if (intake.status !== 'claimed') throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    admission = intake.admission;
    if (fileBytes) {
      const extracted = await (deps.extractPdfText ?? extractPdfText)(fileBytes, { maxBytes: MAX_PDF_BYTES });
      fileBytes = null;
      pdfPages = extracted.pages;
      pdfBytes = extracted.bytes;
      const cvCheck = validateCvText(extracted.text);
      if (!cvCheck.ok) throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'cvText' });
      rawCvText = cvCheck.value;
    }

    const sanitizedCvText = redactPii(rawCvText);
    rawCvText = null;

    if (!sanitizedCvText.trim()) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'cvText' });
    }
    if (!sanitizedJd.trim()) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, 400, { field: 'jobDescription' });
    }

    const effectiveRequestId = requestId
      ? createHash('sha256')
          .update(`${requestId}\0${language}\0${sanitizedCvText}\0${sanitizedJd}`)
          .digest('hex')
      : '';
    const reservation = await activeStore.reserveQuota({
      action: 'analyze',
      ipHash,
      limit: DAILY_LIMITS.analyze,
      requestId: effectiveRequestId,
    });

    if (reservation.cached) {
      log({
        route: '/api/analyze-cv',
        status: 200,
        code: 'OK',
        elapsedMs: now() - startedAt,
        meta: {
          transport,
          language,
          cached: true,
          quotaRemaining: reservation.remaining,
          storeBackend: activeStore.backend,
        },
      });
      return Response.json(reservation.cached, { status: 200 });
    }

    if (!reservation.allowed) {
      throw new AppError(ERROR_CODES.QUOTA_REACHED, 429, {
        action: 'analyze',
        resetAt: reservation.resetAt,
      });
    }

    let committed = false;
    try {
      if (deps.provider) {
        await requireAiBudget(activeStore, limits, false, admission);
        providerAttempted = true;
      }
      const analysis = await analyzeCv(
        { sanitizedCvText, sanitizedJd, language },
        {
          provider: deps.provider ?? budgetedGeminiProvider(
            activeStore, limits, admission, deps.geminiOptions, () => { providerAttempted = true; }
          ),
        }
      );

      const session = await activeStore.createSession({
        language,
        sanitizedCvText,
        sanitizedJd,
        analysis: {
          atsScore: analysis.atsScore,
          matchedKeywords: analysis.matchedKeywords,
          missingKeywords: analysis.missingKeywords,
          rewrites: analysis.rewrites,
        },
      }, { deferUntilCommit: true });

      const responsePayload = {
        sessionId: session.sessionId,
        atsScore: analysis.atsScore,
        matchedKeywords: analysis.matchedKeywords,
        missingKeywords: analysis.missingKeywords,
        rewrites: analysis.rewrites,
      };

      await activeStore.commitQuota({
        reservationId: reservation.reservationId,
        action: 'analyze',
        ipHash,
        requestId: effectiveRequestId,
        result: responsePayload,
        session,
        admission,
      });
      committed = true;

      log({
        route: '/api/analyze-cv',
        status: 200,
        code: 'OK',
        elapsedMs: now() - startedAt,
        meta: {
          transport,
          language,
          pages: pdfPages,
          bytes: pdfBytes,
          atsScore: analysis.atsScore,
          matchedCount: analysis.matchedKeywords.length,
          missingCount: analysis.missingKeywords.length,
          rewriteCount: analysis.rewrites.length,
          sparse: analysis.isSparse,
          cached: false,
          quotaRemaining: reservation.remaining,
          storeBackend: activeStore.backend,
        },
      });

      return Response.json(responsePayload, { status: 200 });
    } finally {
      if (!committed && reservation.reservationId) {
        try {
          await activeStore.releaseQuota(reservation);
        } catch {
          // Never mask original error if release fails on a broken external store.
        }
      }
    }
  } catch (err) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503);
    if (appErr.code === ERROR_CODES.QUOTA_REACHED && appErr.meta?.action === 'aiBudget' && !providerAttempted) {
      chargeAdmission = false;
    }

    log({
      route: '/api/analyze-cv',
      status: appErr.status,
      code: appErr.code,
      elapsedMs: now() - startedAt,
      meta: {
        transport,
        language,
        pages: pdfPages,
        bytes: pdfBytes,
        field: appErr.meta?.field,
        action: appErr.meta?.action,
        storeBackend: activeStore?.backend,
      },
    });

    return buildErrorJson(appErr);
  } finally {
    if (admission) {
      try { await activeStore.releaseCvAdmission(admission, chargeAdmission); } catch { /* Lease expiration releases admission. */ }
    }
  }
}

export async function POST(request) {
  return handleAnalyzeCv(request);
}
