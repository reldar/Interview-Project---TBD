'use client';
import { Button } from './ui/button';
import { useEffect, useRef, useState } from 'react';
import {
  ERROR_CODES,
  MAX_JD_CHARS,
  MAX_PDF_BYTES,
  buildCvReportText,
  getErrorCopy,
  validateJobDescription,
} from '../lib/contracts';
import { review } from './sample';
import { Interview } from './interview';
import { ReportActions } from './report';

function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatFileSize(bytes, lang) {
  const locale = lang === 'en' ? 'en-US' : 'id-ID';
  if (bytes < 1_000) return `${bytes.toLocaleString(locale)} B`;
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })} MB`;
}

function isApiFileError(err) {
  if (!err) return false;
  if (
    err.code === ERROR_CODES.FILE_TOO_LARGE ||
    err.code === ERROR_CODES.UNSUPPORTED_FILE ||
    err.code === ERROR_CODES.PDF_UNREADABLE
  ) {
    return true;
  }
  return (
    err.code === ERROR_CODES.INVALID_INPUT &&
    (err.meta?.field === 'file' || err.meta?.field === 'cvText')
  );
}

function isApiJdError(err) {
  return Boolean(
    err && err.code === ERROR_CODES.INVALID_INPUT && err.meta?.field === 'jobDescription'
  );
}

function isValidAnalysisResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (typeof data.sessionId !== 'string' || !data.sessionId.trim()) return false;
  if (
    typeof data.atsScore !== 'number' ||
    !Number.isInteger(data.atsScore) ||
    data.atsScore < 0 ||
    data.atsScore > 100
  ) {
    return false;
  }
  if (!Array.isArray(data.matchedKeywords) || !Array.isArray(data.missingKeywords)) return false;
  if (!Array.isArray(data.rewrites)) return false;
  return data.rewrites.every(
    (rw) =>
      rw &&
      typeof rw === 'object' &&
      typeof rw.original === 'string' &&
      rw.original.trim().length > 0 &&
      typeof rw.improved === 'string' &&
      rw.improved.trim().length > 0 &&
      typeof rw.reason === 'string' &&
      rw.reason.trim().length > 0
  );
}

function getScoreBand(score, en) {
  if (score >= 75) return en ? 'Strong alignment' : 'Kesesuaian kuat';
  if (score >= 50) return en ? 'Moderate alignment' : 'Kesesuaian cukup';
  return en ? 'Early alignment' : 'Kesesuaian awal';
}

function FeedbackCard({ lang, sessionKey }) {
  const en = lang === 'en';
  const t = (id, english) => (en ? english : id);
  const locale = en ? 'en-US' : 'id-ID';
  const [status, setStatus] = useState('idle');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    setStatus('idle');
    setSummary(null);
  }, [sessionKey]);

  async function submitFeedback(positive) {
    if (status === 'submitting' || status === 'sent') return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positive, language: lang }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.total !== 'number') {
        setStatus('error');
        return;
      }
      setSummary({
        positive: data.positive,
        total: data.total,
        satisfactionRate: data.satisfactionRate,
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="feedbackCard" aria-labelledby="feedback-heading">
      <h3 id="feedback-heading">{t('Apakah tinjauan ini membantu?', 'Was this review helpful?')}</h3>
      <p className="feedbackHint">
        {t(
          'Opsional · Hanya mencatat jumlah tanggapan agregat tanpa riwayat pribadi.',
          'Optional · Records aggregate counts only, with no personal history.'
        )}
      </p>
      {status === 'sent' ? (
        <p role="status" aria-live="polite" className="feedbackThanks">
          {t('Terima kasih atas masukanmu.', 'Thanks for your feedback.')}
          {summary && typeof summary.total === 'number' && summary.total > 0 && (
            <>
              {' '}
              {en
                ? `(${summary.positive.toLocaleString(locale)} of ${summary.total.toLocaleString(locale)} responses found this helpful.)`
                : `(${summary.positive.toLocaleString(locale)} dari ${summary.total.toLocaleString(locale)} tanggapan menilai membantu.)`}
            </>
          )}
        </p>
      ) : (
        <>
          <div className="actions">
            <Button
              onClick={() => submitFeedback(true)}
              disabled={status === 'submitting'}
            >
              {t('Membantu', 'Helpful')}
            </Button>
            <Button
              onClick={() => submitFeedback(false)}
              disabled={status === 'submitting'}
            >
              {t('Perlu perbaikan', 'Needs work')}
            </Button>
          </div>
          {status === 'error' && (
            <p role="status" aria-live="polite" className="feedbackError">
              {t(
                'Masukan belum terkirim. Kamu bisa mencoba lagi tanpa kehilangan hasil tinjauan.',
                'Feedback could not be sent right now. You can try again without losing your review.'
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PrivacyNotice({ lang }) {
  const en = lang === 'en';
  const t = (id, english) => (en ? english : id);
  return (
    <div className="privacyNote" aria-label={t('Pemberitahuan privasi', 'Privacy notice')}>
      <svg
        aria-hidden="true"
        className="privacyIcon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 2.5 4 5v4.5c0 4 2.6 6.8 6 8 3.4-1.2 6-4 6-8V5l-6-2.5Z" />
        <path d="m7.5 10 1.7 1.7 3.3-3.4" />
      </svg>
      <div>
        <strong>{t('Privasi & penyamaran data', 'Privacy & data masking')}</strong>
        <p>
          {t(
            'PDF diproses sementara di memori (RAM) saja dan tidak disimpan permanen. Sebelum diproses, sistem menyamarkan 4 jenis data pribadi: email, nomor telepon, NIK/tanggal lahir, dan alamat rumah. Nama atau detail tidak biasa di teks bebas mungkin tetap terbaca.',
            'Your PDF is processed in memory (RAM) only and never stored permanently. Before analysis, the system masks 4 identifier types: email, phone number, NIK/birthdate, and home address. Names or unusual free-text details may remain.'
          )}
        </p>
      </div>
    </div>
  );
}

function AnalysisContent({
  analysis,
  lang,
  isExample,
  headingRef,
  title,
  subtitle,
  tagLabel,
  reportText,
  filename,
  onBackToReal,
}) {
  const en = lang === 'en';
  const t = (id, english) => (en ? english : id);
  const score = analysis.atsScore;
  const band = getScoreBand(score, en);
  const matched = Array.isArray(analysis.matchedKeywords) ? analysis.matchedKeywords : [];
  const missing = Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [];
  const rewrites = Array.isArray(analysis.rewrites) ? analysis.rewrites : [];

  return (
    <section aria-labelledby="analysis-heading">
      <div className="resultHeader">
        <small className="tag">{tagLabel}</small>
        {onBackToReal && (
          <Button className="backRealBtn" onClick={onBackToReal}>
            {t('Kembali ke hasil CV kamu', 'Back to your CV review')}
          </Button>
        )}
      </div>
      <h2 id="analysis-heading" ref={headingRef} tabIndex="-1">
        {title}
      </h2>
      {subtitle && <p className="resultSubtitle">{subtitle}</p>}

      {!isExample && analysis.language && analysis.language !== lang && (
        <p className="langMismatchNote">
          {t(
            'Isi tinjauan di bawah dihasilkan dalam Bahasa Inggris. Klik Analisis CV Sekarang lagi untuk menghasilkan ulang dalam Bahasa Indonesia.',
            'The review text below was generated in Bahasa Indonesia. Select Analyze CV Now again to regenerate it in English.'
          )}
        </p>
      )}

      <div className="scoreCard">
        <div className="score">
          <strong>
            {score}
            <small>/100</small>
          </strong>
          <div className="scoreMeta">
            <span className="scoreTitle">
              {t('Estimasi kecocokan ATS', 'Estimated ATS alignment')}
            </span>
            <span className="scoreBand">{band}</span>
          </div>
        </div>
        <div
          className="meterTrack"
          role="meter"
          aria-label={t('Estimasi kecocokan ATS', 'Estimated ATS alignment')}
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${score}/100 — ${band}`}
        >
          <div className="meterFill" style={{ width: `${score}%` }} />
        </div>
        <p className="scoreDisclaimer">
          {t(
            'Skor ini adalah estimasi pembimbingan yang membandingkan CV yang dikirim dengan lowongan yang ditempel—bukan algoritma seleksi perusahaan atau jaminan lolos penyaringan.',
            'This coaching estimate compares your submitted CV against the pasted vacancy—it is not an employer screening algorithm or a guarantee of passing.'
          )}
        </p>
      </div>

      <div className="keywordGrid">
        <div className="keywordGroup">
          <h3>{t('Kata kunci yang sesuai', 'Matched keywords')}</h3>
          {matched.length > 0 ? (
            <ul className="pills">
              {matched.map((kw, i) => (
                <li key={`m-${i}-${kw}`} className="pill pillMatched">
                  {kw}
                </li>
              ))}
            </ul>
          ) : (
            <p className="emptyState">
              {t(
                'Belum ada kata kunci lowongan yang terlihat pada CV ini.',
                'No advertised skills evidenced yet in this CV.'
              )}
            </p>
          )}
        </div>

        <div className="keywordGroup">
          <h3>{t('Kata kunci yang belum terlihat', 'Missing keywords')}</h3>
          {missing.length > 0 ? (
            <ul className="pills">
              {missing.map((kw, i) => (
                <li key={`x-${i}-${kw}`} className="pill pillMissing">
                  {kw}
                </li>
              ))}
            </ul>
          ) : (
            <p className="emptyState">
              {t(
                'Semua kebutuhan utama pada lowongan ini sudah terlihat pada CV kamu.',
                'All key requirements in this vacancy are evidenced in your CV.'
              )}
            </p>
          )}
        </div>
      </div>

      <div className="rewritesBlock">
        <h3>{t('Usulan perbaikan CV', 'Suggested CV improvements')}</h3>

        {rewrites.length === 0 ? (
          <div className="noticeCard">
            <p>
              {t(
                'Belum ada poin pengalaman atau proyek yang dapat ditulis ulang secara jujur dari CV ini. Tambahkan poin proyek, tugas kuliah, magang, atau pengalaman kerja agar kami dapat memberi usulan perbaikan tanpa mengarang pengalaman.',
                'No experience or project bullets were found to rewrite honestly in this CV. Add project, coursework, internship, or work-experience bullets so we can suggest improvements without fabricating experience.'
              )}
            </p>
          </div>
        ) : (
          <>
            {rewrites.length < 3 && (
              <div className="noticeCard">
                <p>
                  {t(
                    `Menampilkan ${rewrites.length} usulan perbaikan karena CV ini memuat ${rewrites.length} poin pengalaman yang bisa ditulis ulang secara jujur. Tambahkan poin proyek, tugas kuliah, magang, atau pengalaman kerja lain untuk mendapatkan 3–5 usulan.`,
                    `Showing ${rewrites.length} honest rewrite${rewrites.length === 1 ? '' : 's'} because this CV currently contains ${rewrites.length} distinct source bullet${rewrites.length === 1 ? '' : 's'}. Add more project, coursework, internship, or work-experience bullets to receive 3–5 rewrites.`
                  )}
                </p>
              </div>
            )}
            <div className="rewriteList">
              {rewrites.map((rw, idx) => (
                <article key={idx} className="rewriteCard">
                  <div className="rewritePair">
                    <div className="rewriteCol rewriteOrig">
                      <span className="rewriteLabel">{t('Asli', 'Original')}</span>
                      <p>{rw.original}</p>
                    </div>
                    <div className="rewriteCol rewriteImp">
                      <span className="rewriteLabel">{t('Usulan', 'Improved')}</span>
                      <p>{rw.improved}</p>
                    </div>
                  </div>
                  <div className="rewriteReason">
                    <span className="rewriteLabel">{t('Alasan', 'Reason')}</span>
                    <p>{rw.reason}</p>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <ReportActions text={reportText} en={en} filename={filename} />
      <PrivacyNotice lang={lang} />
      {!isExample && (
        <FeedbackCard lang={lang} sessionKey={analysis.sessionId} />
      )}
    </section>
  );
}

export default function Workspace() {
  const [lang, setLang] = useState('id');
  const [file, setFile] = useState(null);
  const [jd, setJD] = useState('');
  const [fileError, setFileError] = useState(null);
  const [jdError, setJdError] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState(null);
  const [realAnalysis, setRealAnalysis] = useState(null);
  const [previewInterview, setPreviewInterview] = useState(false);
  const [stage, setStage] = useState(0);
  const [focusSeq, setFocusSeq] = useState(0);

  const picker = useRef(null);
  const jdRef = useRef(null);
  const resultRef = useRef(null);
  const alertRef = useRef(null);
  const requestIdRef = useRef('');

  const en = lang === 'en';
  const locale = en ? 'en-US' : 'id-ID';
  const t = (id, english) => (en ? english : id);
  const sample = review[lang];

  const steps = [
    t('Siapkan dokumen', 'Prepare documents'),
    t('Tinjau CV', 'Review your CV'),
    t('Latihan wawancara', 'Interview practice'),
    t('Ringkasan', 'Summary'),
  ];

  const exampleAnalysis = {
    atsScore: 68,
    matchedKeywords: ['Python', 'Excel'],
    missingKeywords: ['SQL'],
    rewrites: sample.bullets.map(([original, improved, reason]) => ({
      original,
      improved,
      reason,
    })),
  };

  const exampleReportText = buildCvReportText(exampleAnalysis, lang, { isExample: true });
  const realReportText = realAnalysis
    ? buildCvReportText(realAnalysis, lang, { isExample: false })
    : '';

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (focusSeq > 0) {
      resultRef.current?.focus();
    }
  }, [focusSeq]);

  function resetDraftRequestId() {
    requestIdRef.current = '';
  }

  function handleLanguageChange(nextLang) {
    if (nextLang === lang) return;
    setLang(nextLang);
    resetDraftRequestId();
  }

  function pick(selectedFile) {
    if (!selectedFile) return;
    resetDraftRequestId();
    setApiError(null);
    setFileError(null);

    if (selectedFile.size === 0) {
      setFile(null);
      setFileError({ code: ERROR_CODES.INVALID_INPUT, meta: { field: 'file' } });
      return;
    }
    if (selectedFile.size > MAX_PDF_BYTES) {
      setFile(null);
      setFileError({ code: ERROR_CODES.FILE_TOO_LARGE });
      return;
    }
    if (selectedFile.type !== 'application/pdf') {
      setFile(null);
      setFileError({ code: ERROR_CODES.UNSUPPORTED_FILE });
      return;
    }
    setFile(selectedFile);
  }

  function handleJdChange(e) {
    const nextValue = e.target.value;
    setJD(nextValue);
    resetDraftRequestId();
    if (apiError) setApiError(null);
    if (nextValue.length > MAX_JD_CHARS) {
      setJdError({ code: ERROR_CODES.INVALID_INPUT, meta: { field: 'jobDescription' } });
    } else if (jdError && validateJobDescription(nextValue).ok) {
      setJdError(null);
    }
  }

  async function submitAnalysis({ reuseRequestId = false } = {}) {
    if (busy) return;

    const currentFileErr = !file
      ? fileError || { code: ERROR_CODES.INVALID_INPUT, meta: { field: 'file' } }
      : file.size === 0
      ? { code: ERROR_CODES.INVALID_INPUT, meta: { field: 'file' } }
      : file.size > MAX_PDF_BYTES
      ? { code: ERROR_CODES.FILE_TOO_LARGE }
      : file.type !== 'application/pdf'
      ? { code: ERROR_CODES.UNSUPPORTED_FILE }
      : null;

    const jdCheck = validateJobDescription(jd);
    const currentJdErr = jdCheck.ok
      ? null
      : { code: ERROR_CODES.INVALID_INPUT, meta: { field: 'jobDescription' } };

    setFileError(currentFileErr);
    setJdError(currentJdErr);

    if (currentFileErr) {
      setApiError(null);
      picker.current?.focus();
      return;
    }
    if (currentJdErr) {
      setApiError(null);
      jdRef.current?.focus();
      return;
    }

    const requestId =
      reuseRequestId && requestIdRef.current
        ? requestIdRef.current
        : requestIdRef.current || generateRequestId();
    requestIdRef.current = requestId;

    const submitLang = lang;
    setBusy(true);
    setApiError(null);

    const form = new FormData();
    form.append('file', file);
    form.append('jobDescription', jd);
    form.append('language', submitLang);
    form.append('requestId', requestId);

    try {
      const response = await fetch('/api/analyze-cv', {
        method: 'POST',
        body: form,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errPayload = data?.error;
        const resolvedCode =
          errPayload?.code && ERROR_CODES[errPayload.code]
            ? errPayload.code
            : response.status === 413
            ? ERROR_CODES.FILE_TOO_LARGE
            : response.status === 415
            ? ERROR_CODES.UNSUPPORTED_FILE
            : response.status === 422
            ? ERROR_CODES.PDF_UNREADABLE
            : response.status === 429
            ? ERROR_CODES.QUOTA_REACHED
            : response.status === 410
            ? ERROR_CODES.SESSION_EXPIRED
            : response.status === 409
            ? ERROR_CODES.QUESTION_CONFLICT
            : response.status === 400
            ? ERROR_CODES.INVALID_INPUT
            : ERROR_CODES.TEMPORARILY_UNAVAILABLE;

        const nextApiError = {
          code: resolvedCode,
          meta: {
            field: errPayload?.field,
            action: errPayload?.action,
            resetAt: errPayload?.resetAt,
          },
          retryable: resolvedCode === ERROR_CODES.TEMPORARILY_UNAVAILABLE,
        };
        setApiError(nextApiError);
        requestAnimationFrame(() => {
          if (isApiJdError(nextApiError)) {
            jdRef.current?.focus();
          } else {
            alertRef.current?.focus();
          }
        });
        return;
      }

      if (!isValidAnalysisResponse(data)) {
        setApiError({
          code: ERROR_CODES.TEMPORARILY_UNAVAILABLE,
          meta: {},
          retryable: true,
        });
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }

      setRealAnalysis({
        sessionId: data.sessionId,
        atsScore: data.atsScore,
        matchedKeywords: data.matchedKeywords,
        missingKeywords: data.missingKeywords,
        rewrites: data.rewrites,
        fileName: file.name,
        language: submitLang,
      });
      setMode('real');
      setPreviewInterview(false);
      setStage(1);
      setFocusSeq((seq) => seq + 1);
    } catch {
      setApiError({
        code: ERROR_CODES.TEMPORARILY_UNAVAILABLE,
        meta: {},
        retryable: true,
      });
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    submitAnalysis({ reuseRequestId: false });
  }

  function handleOpenExample() {
    setMode('example');
    setPreviewInterview(false);
    setStage(1);
    setFocusSeq((seq) => seq + 1);
  }

  function handleBackToReal() {
    if (!realAnalysis) return;
    setMode('real');
    setPreviewInterview(false);
    setStage(1);
    setFocusSeq((seq) => seq + 1);
  }

  const hasFileInvalid = Boolean(fileError) || isApiFileError(apiError);
  const hasJdInvalid = Boolean(jdError) || isApiJdError(apiError);
  const pdfDescribedBy = [
    'pdf-hint',
    fileError ? 'pdf-error' : null,
    !fileError && isApiFileError(apiError) ? 'api-error' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const jdDescribedBy = [
    'jd-hint',
    jdError ? 'jd-error' : null,
    !jdError && isApiJdError(apiError) ? 'api-error' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <header className="top">
        <div className="bar">
          <strong className="brand">
            <i aria-hidden="true">L</i>LatihKerja
          </strong>
          <div role="group" aria-label="Bahasa / Language" className="switch">
            {['id', 'en'].map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                disabled={busy}
                onClick={() => handleLanguageChange(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main>
        <div className="mast">
          <h1>{t('Ruang persiapan', 'Application workspace')}</h1>
          <p>
            {t(
              'Tinjau CV dan latih jawaban wawancara untuk posisi yang kamu tuju.',
              'Review your CV and practice interview answers for your target role.'
            )}
          </p>
        </div>

        <div className="workspace">
          <aside aria-label={t('Langkah persiapan', 'Your progress')}>
            <h2>{t('Langkah persiapan', 'Your progress')}</h2>
            <ol>
              {steps.map((s, i) => (
                <li key={i} aria-current={stage === i ? 'step' : undefined}>
                  <span>{i < stage ? '✓' : i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </aside>

          <div className="sheet">
            <section aria-labelledby="prepare-heading">
              <h2 id="prepare-heading">{steps[0]}</h2>
              <form onSubmit={handleSubmit} noValidate aria-busy={busy ? 'true' : undefined}>
                <fieldset disabled={busy}>
                  <label htmlFor="pdf">{t('CV kamu', 'Your CV')}</label>
                  <div
                    className={`drop${drag ? ' over' : ''}${hasFileInvalid ? ' invalid' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!busy) setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      if (busy) return;
                      if (e.dataTransfer.files.length === 1) {
                        pick(e.dataTransfer.files[0]);
                      } else {
                        resetDraftRequestId();
                        setFile(null);
                        setApiError(null);
                        setFileError({
                          code: ERROR_CODES.INVALID_INPUT,
                          meta: { field: 'file' },
                        });
                        picker.current?.focus();
                      }
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      className="paperIcon"
                      viewBox="0 0 32 32"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 3h10l6 6v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M19 3v7h6 M16 23v-9m-4 4 4-4 4 4" />
                    </svg>
                    <strong>
                      {file ? file.name : t('Tarik PDF ke sini', 'Drop your PDF here')}
                    </strong>
                    <small id="pdf-hint">
                      {file
                        ? `${formatFileSize(file.size, lang)} · PDF`
                        : t(
                            'PDF dengan teks yang bisa disalin · Maks. 5 MB',
                            'Selectable-text PDF · Up to 5 MB'
                          )}
                    </small>
                    <label className={`browse${busy ? ' isDisabled' : ''}`}>
                      {file
                        ? t('Ganti berkas', 'Replace file')
                        : t('Pilih berkas', 'Browse files')}
                      <input
                        ref={picker}
                        id="pdf"
                        type="file"
                        accept="application/pdf,.pdf"
                        aria-invalid={hasFileInvalid ? 'true' : undefined}
                        aria-describedby={pdfDescribedBy}
                        onChange={(e) => {
                          pick(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  {fileError && (
                    <p id="pdf-error" role="alert" className="fieldError">
                      {getErrorCopy(fileError.code, lang, fileError.meta)}
                    </p>
                  )}

                  <div className="fieldHeader">
                    <label htmlFor="jd">{t('Deskripsi lowongan', 'Job description')}</label>
                    <small
                      id="jd-hint"
                      className={`charCount${jd.length > MAX_JD_CHARS ? ' overLimit' : ''}`}
                    >
                      {jd.length.toLocaleString(locale)} / {MAX_JD_CHARS.toLocaleString(locale)}
                    </small>
                  </div>
                  <textarea
                    ref={jdRef}
                    id="jd"
                    rows="5"
                    value={jd}
                    aria-invalid={hasJdInvalid ? 'true' : undefined}
                    aria-describedby={jdDescribedBy}
                    onChange={handleJdChange}
                    placeholder={t(
                      'Tempel tanggung jawab dan kualifikasi dari lowongan…',
                      'Paste the responsibilities and qualifications from the vacancy…'
                    )}
                  />
                  {jdError && (
                    <p id="jd-error" role="alert" className="fieldError">
                      {getErrorCopy(jdError.code, lang, jdError.meta)}
                    </p>
                  )}

                  <div className="actions">
                    <Button variant="default" type="submit" disabled={busy}>
                      {busy
                        ? t('Menganalisis CV…', 'Analyzing CV…')
                        : t('Analisis CV Sekarang', 'Analyze CV Now')}
                    </Button>
                    <Button onClick={handleOpenExample} disabled={busy}>
                      {t('Buka contoh', 'Open example')} ↗
                    </Button>
                  </div>
                  <p className="inputPrivacyHint">
                    {t(
                      'PDF diproses di memori (RAM) saja; email, telepon, NIK/tanggal lahir, dan alamat rumah disamarkan otomatis.',
                      'PDFs are processed in memory (RAM) only; email, phone, NIK/birthdate, and home address are masked automatically.'
                    )}
                  </p>
                </fieldset>

                {busy && (
                  <p role="status" aria-live="polite" className="pendingStatus">
                    <span className="spinner" aria-hidden="true" />
                    {t(
                      'Menganalisis CV… PDF diproses di memori dan data pribadi disamarkan.',
                      'Analyzing CV… Processing PDF in memory and masking personal identifiers.'
                    )}
                  </p>
                )}

                {apiError && !busy && (
                  <div
                    id="api-error"
                    ref={alertRef}
                    tabIndex="-1"
                    role="alert"
                    className="alertBanner"
                  >
                    <p>{getErrorCopy(apiError.code, lang, apiError.meta)}</p>
                    {apiError.retryable && (
                      <div className="actions">
                        <Button
                          variant="default"
                          onClick={() => submitAnalysis({ reuseRequestId: true })}
                        >
                          {t('Coba lagi', 'Retry')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </section>

            {mode === 'real' && realAnalysis && (
              <>
                <AnalysisContent
                  analysis={realAnalysis}
                  lang={lang}
                  isExample={false}
                  headingRef={resultRef}
                  title={t('Tinjauan CV kamu', 'Your CV review')}
                  subtitle={t(
                    `Dibandingkan terhadap deskripsi lowongan yang ditempel · ${realAnalysis.fileName}`,
                    `Compared against the pasted job description · ${realAnalysis.fileName}`
                  )}
                  tagLabel={t('Hasil analisis CV', 'CV analysis result')}
                  reportText={realReportText}
                  filename={`LatihKerja-review-${lang}.txt`}
                />

                <section className="interviewBridge" aria-labelledby="interview-bridge-heading">
                  <h2 id="interview-bridge-heading">
                    {t('Latihan wawancara', 'Interview practice')}
                  </h2>
                  <p>
                    {t(
                      'Simulasi wawancara khusus berdasarkan CV yang kamu unggah akan hadir pada tahap berikutnya (Hari 6–8). Kamu tetap bisa mencoba pratinjau wawancara contoh tanpa menghapus hasil analisis CV di atas.',
                      'Mock interview practice tailored to your uploaded CV arrives in Days 6–8. Meanwhile, you can try the 5-step example interview preview without discarding your CV analysis above.'
                    )}
                  </p>
                  <div className="actions">
                    <Button
                      variant={previewInterview ? 'outline' : 'default'}
                      onClick={() => {
                        setPreviewInterview((open) => {
                          const next = !open;
                          if (!next) setStage(1);
                          return next;
                        });
                      }}
                    >
                      {previewInterview
                        ? t('Tutup pratinjau wawancara contoh', 'Hide example interview preview')
                        : t('Coba pratinjau wawancara contoh', 'Preview example interview')}
                    </Button>
                  </div>
                </section>

                {previewInterview && (
                  <Interview en={en} report={exampleReportText} onStage={setStage} />
                )}
              </>
            )}

            {mode === 'example' && (
              <>
                <AnalysisContent
                  analysis={exampleAnalysis}
                  lang={lang}
                  isExample={true}
                  headingRef={resultRef}
                  title={sample.title}
                  subtitle={sample.job}
                  tagLabel={t('Contoh fiktif', 'Fictional example')}
                  reportText={exampleReportText}
                  filename={`LatihKerja-${en ? 'example' : 'contoh'}.txt`}
                  onBackToReal={realAnalysis ? handleBackToReal : null}
                />
                <Interview en={en} report={exampleReportText} onStage={setStage} />
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
