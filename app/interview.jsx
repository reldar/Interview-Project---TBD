'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ERROR_CODES,
  INTERVIEW_QUESTION_COUNT,
  MAX_INTERVIEW_ANSWER_CHARS,
  SUPPORTED_LANGUAGES,
  getErrorCopy,
  isInterviewFeedback,
  isInterviewQuestion,
} from '../lib/contracts';
import { INTERVIEW_FIXTURES } from '../lib/interview-fixtures';
import { isInterviewReport } from '../lib/interview-report';
import { InterviewReport } from './interview-report';
import { Button } from './ui/button';

const unavailable = { code: ERROR_CODES.TEMPORARILY_UNAVAILABLE };

function getInterviewError(status, data) {
  if (status === 410) return { code: ERROR_CODES.SESSION_EXPIRED };
  if (status === 413) return { code: ERROR_CODES.FILE_TOO_LARGE };
  if (status === 429) {
    return {
      code: ERROR_CODES.QUOTA_REACHED,
      action: ['interviewGeneration', 'aiBudget'].includes(data?.error?.action) ? data.error.action : 'interviewStart',
      resetAt: data?.error?.resetAt,
    };
  }
  if (status === 400) return { code: ERROR_CODES.INVALID_INPUT, field: data?.error?.field };
  return unavailable;
}

export function Interview({ lang, sessionId, onStage, onReanalyze, analyzing = false, active = true }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hrd');
  const [language, setLanguage] = useState(null);
  const [question, setQuestion] = useState(null);
  const [draft, setDraft] = useState('');
  const [conflictDrafts, setConflictDrafts] = useState({});
  const [result, setResult] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  const openButton = useRef(null);
  const setupHeading = useRef(null);
  const questionHeading = useRef(null);
  const feedbackHeading = useRef(null);
  const completionHeading = useRef(null);
  const reportHeading = useRef(null);
  const alert = useRef(null);

  const chosenLanguage = language ?? lang;
  const t = (id, en) => chosenLanguage === 'en' ? en : id;
  const dashboardText = (id, en) => lang === 'en' ? en : id;
  const isExample = !sessionId;
  const expired = error?.code === ERROR_CODES.SESSION_EXPIRED;
  const retryable = error?.code === ERROR_CODES.TEMPORARILY_UNAVAILABLE;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (error && open) alert.current?.focus();
    else if (reportOpen) reportHeading.current?.focus();
    else if (result) feedbackHeading.current?.focus();
    else if (completed) completionHeading.current?.focus();
    else if (question) questionHeading.current?.focus();
    else if (open) setupHeading.current?.focus();
  }, [completed, error, open, question, reportOpen, result]);

  async function submit(action, body, handleResponse) {
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/interview/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ...body }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) return;

      const serverLanguage = response.headers.get('content-language');
      if (SUPPORTED_LANGUAGES.includes(serverLanguage)) setLanguage(serverLanguage);
      const serverMode = response.headers.get('x-interview-mode');
      if (serverMode === 'hrd' || serverMode === 'user') setMode(serverMode);
      handleResponse(response, data);
    } catch {
      if (!controller.signal.aborted) setError(unavailable);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function start(event) {
    event.preventDefault();
    if (request.current || expired || question || completed) return;

    setLanguage(chosenLanguage);
    if (isExample) {
      setQuestion(INTERVIEW_FIXTURES[mode][chosenLanguage].questions[0]);
      onStage(2);
      return;
    }
    submit('start', { mode, language: chosenLanguage }, (response, data) => {
      if (response.status === 409 && data?.error?.completed === true) {
        recoverCompleted(data.error.report);
      } else if (!response.ok) setError(getInterviewError(response.status, data));
      else if (!isInterviewQuestion(data)) setError(unavailable);
      else {
        setQuestion(data);
        onStage(2);
      }
    });
  }

  function recoverCompleted(report) {
    if (!isInterviewReport(report)) {
      setError(unavailable);
      return false;
    }
    setMode(report.mode);
    setCompleted(true);
    setQuestion(null);
    setResult({ ...report, feedback: report.transcript[INTERVIEW_QUESTION_COUNT - 1].feedback });
    onStage(2);
    return true;
  }

  function answer(event) {
    event.preventDefault();
    if (request.current || expired || completed || result || !question || !draft.trim()) return;

    const number = question.questionNumber;
    submit('answer', { questionNumber: number, userAnswer: draft }, (response, data) => {
      if (response.status === 409 && data?.error?.code === ERROR_CODES.QUESTION_CONFLICT) {
        const { currentQuestion, completed: serverCompleted } = data.error;
        if (serverCompleted ? !isInterviewReport(data.error.report)
          : currentQuestion !== null && !isInterviewQuestion(currentQuestion)) {
          setError(unavailable);
          return;
        }
        if (serverCompleted || currentQuestion?.questionNumber !== number) {
          setConflictDrafts((previous) => ({ ...previous, [number]: draft }));
          setDraft('');
        }
        if (serverCompleted) {
          if (!recoverCompleted(data.error.report)) return;
        } else setQuestion(isInterviewQuestion(currentQuestion) ? currentQuestion : null);
        setError({ code: ERROR_CODES.QUESTION_CONFLICT });
      } else if (!response.ok) setError(getInterviewError(response.status, data));
      else if ((data?.completedReport && !isInterviewReport(data.completedReport))
        || (data?.resumeQuestion && !isInterviewQuestion(data.resumeQuestion))
        || !isInterviewFeedback(data?.feedback)
        || (number === INTERVIEW_QUESTION_COUNT
          ? data.nextQuestion !== null || !isInterviewReport(data)
          : !isInterviewQuestion(data.nextQuestion, number + 1))) {
        setError(unavailable);
      } else {
        setDraft('');
        setResult(data);
        setCompleted(number === INTERVIEW_QUESTION_COUNT);
      }
    });
  }

  if (!active) return null;
  const heading = dashboardText('Latihan wawancara', 'Interview practice');
  return (
    <section className="interviewBridge" aria-labelledby="interview-bridge-heading">
      <h2 id="interview-bridge-heading">{heading}</h2>
      {!open && (
        <Button ref={openButton} variant="default" onClick={() => setOpen(true)}>
          {isExample
            ? dashboardText('Lihat contoh pertanyaan', 'Preview example question')
            : dashboardText('Siapkan wawancara', 'Set up interview')}
        </Button>
      )}
      {open && (
        <div lang={chosenLanguage}>
          {question || completed ? (
            <>
              <p>{mode === 'hrd' ? 'HR' : t('Teknis', 'Technical')} · {chosenLanguage === 'id' ? 'Bahasa Indonesia' : 'English'}</p>
              {question && (
                <>
                  <div className="interviewProgress">
                    <span className="tag" id="question-progress">
                      {t(
                        `Pertanyaan ${question.questionNumber} dari ${INTERVIEW_QUESTION_COUNT}`,
                        `Question ${question.questionNumber} of ${INTERVIEW_QUESTION_COUNT}`
                      )}
                    </span>
                    <progress
                      aria-labelledby="question-progress"
                      value={question.questionNumber}
                      max={INTERVIEW_QUESTION_COUNT}
                    />
                  </div>
                  <h3 ref={questionHeading} tabIndex={-1} className="question">{question.questionText}</h3>
                  <p><strong>{t('Fokus', 'Focus area')}</strong> · {question.focusArea}</p>
                </>
              )}
              {question && !isExample && !result && !completed && (
                <form onSubmit={answer} aria-busy={pending}>
                  <fieldset disabled={pending}>
                    <label htmlFor="interview-answer">{t('Jawaban kamu', 'Your answer')}</label>
                    <p id="answer-privacy">{t('Gunakan contoh fiktif. Hapus nama, kontak, dan tautan profil. Draf tersedia hingga halaman ditutup atau dimuat ulang. Jawaban yang dikirim diproses Gemini setelah penyamaran.', 'Use fictional examples. Remove names, contact details and profile links. Drafts last until you close or reload this page. Submitted answers go to Gemini after masking.')}</p>
                    <textarea aria-describedby="answer-privacy"
                      id="interview-answer"
                      rows={5}
                      maxLength={MAX_INTERVIEW_ANSWER_CHARS}
                      readOnly={expired}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <Button type="submit" variant="default" disabled={expired || !draft.trim()}>
                      {retryable ? t('Coba lagi', 'Retry') : t('Kirim jawaban', 'Submit answer')}
                    </Button>
                  </fieldset>
                </form>
              )}
              {result && (
                <div className="noticeCard">
                  <h3 ref={feedbackHeading} tabIndex={-1}>{t('Umpan balik jawaban', 'Answer feedback')}</h3>
                  <ul>
                    <li>{t('Kejelasan', 'Clarity')} {result.feedback.clarityScore}/5</li>
                    <li>{t('Relevansi', 'Relevance')} {result.feedback.relevanceScore}/5</li>
                    <li>{t('Dampak', 'Impact')} {result.feedback.impactScore}/5</li>
                  </ul>
                  <p>{result.feedback.suggestion}</p>
                  {result.nextQuestion && (
                    <Button className="mt-4" variant="default" onClick={() => {
                      if (result.completedReport) {
                        recoverCompleted(result.completedReport);
                        return;
                      }
                      setQuestion(result.resumeQuestion ?? result.nextQuestion);
                      setResult(null);
                    }}>
                      {result.completedReport ? t('Lihat hasil akhir', 'View completed results') : t('Pertanyaan berikutnya', 'Next question')}
                    </Button>
                  )}
                </div>
              )}
              {completed && (
                <>
                  <h3 ref={completionHeading} tabIndex={-1} className="mt-4">
                    {t('Lima pertanyaan selesai', 'Five questions complete')}
                  </h3>
                  {result?.finalSummary && !reportOpen && (
                    <Button className="mt-4" variant="default" onClick={() => {
                      setReportOpen(true);
                      setError(null);
                      onStage(3);
                    }}>
                      {t('Lihat ringkasan', 'View interview report')}
                    </Button>
                  )}
                  {reportOpen && <InterviewReport report={result} language={chosenLanguage} headingRef={reportHeading} />}
                </>
              )}
            </>
          ) : (
            <>
              <h3 ref={setupHeading} tabIndex={-1}>{t('Pengaturan wawancara', 'Interview setup')}</h3>
              <form onSubmit={start} aria-busy={pending}>
                <fieldset disabled={pending}>
                  <div className="controls">
                    <label>
                      {t('Jenis wawancara', 'Interview mode')}
                      <select value={mode} onChange={(event) => setMode(event.target.value)}>
                        <option value="hrd">HR</option>
                        <option value="user">{t('Teknis', 'Technical')}</option>
                      </select>
                    </label>
                    <label>
                      {t('Bahasa wawancara', 'Interview language')}
                      <select value={chosenLanguage} onChange={(event) => setLanguage(event.target.value)}>
                        <option value="id">Bahasa Indonesia</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                  </div>
                  <div className="actions">
                    <Button variant="default" type="submit" disabled={expired}>
                      {retryable ? t('Coba lagi', 'Retry') : isExample
                        ? t('Tampilkan pertanyaan', 'Show question')
                        : t('Mulai wawancara', 'Start interview')}
                    </Button>
                    <Button onClick={() => {
                      setOpen(false);
                      requestAnimationFrame(() => openButton.current?.focus());
                    }}>
                      {t('Batal', 'Cancel')}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </>
          )}
          {pending && (
            <p role="status" className="pendingStatus">
              <span className="spinner" aria-hidden="true" />
              {question
                ? t('Menilai jawaban…', 'Evaluating your answer…')
                : t('Menyiapkan pertanyaan wawancara…', 'Preparing interview questions…')}
            </p>
          )}
          {error && (
            <div ref={alert} tabIndex={-1} role="alert" className="alertBanner">
              <p>{retryable
                ? question
                  ? t('Hasil belum diterima. Coba lagi dengan jawaban yang sama untuk memulihkan umpan balik.', 'Feedback did not arrive. Retry with the same answer to recover any saved feedback.')
                  : t('Wawancara belum bisa dimulai. Pengaturan kamu tersimpan. Coba lagi sesaat lagi.', 'Could not start the interview. Your settings are kept. Try again in a moment.')
                : error.code === ERROR_CODES.QUESTION_CONFLICT
                  ? t('Langkah wawancara berubah. Buka draf pertanyaan sebelumnya untuk menyalin jawabanmu.', 'The interview step changed. Open the previous question’s draft to copy your answer.')
                  : error.code === ERROR_CODES.FILE_TOO_LARGE
                    ? t('Permintaan terlalu besar. Persingkat jawaban lalu kirim kembali.', 'The request is too large. Shorten your answer and submit again.')
                    : getErrorCopy(error.code, chosenLanguage, error)}</p>
              {expired && (
                <div className="actions">
                  <p>{t('Salin draf yang ingin disimpan sebelum analisis ulang.', 'Copy any draft you want to keep before starting a new analysis.')}</p>
                  <Button onClick={onReanalyze} disabled={analyzing}>
                    {t('Analisis CV ulang', 'Run a new CV analysis')}
                  </Button>
                </div>
              )}
            </div>
          )}
          {Object.entries(conflictDrafts).map(([number, savedDraft]) => (
            <details className="mt-4" key={number}>
              <summary>{t(`Draf dari pertanyaan ${number}`, `Draft from question ${number}`)}</summary>
              <textarea readOnly aria-label={t('Draf tersimpan', 'Saved draft')} value={savedDraft} />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
