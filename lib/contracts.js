// Shared client-safe contracts, validators, localized error copy, report builder, and fixtures.
// Zero Node-only imports so both App Router client components and Node Route Handlers can import this module.

import { MAX_PDF_BYTES } from '../app/limit.js';
import { REDACTION_PLACEHOLDERS, redactAnalysisOutput, redactPii } from './redact.js';

export { MAX_PDF_BYTES };

export const MAX_MULTIPART_OVERHEAD_BYTES = 65_536;
export const MAX_CV_TEXT_CHARS = 30_000;
export const MAX_JD_CHARS = 15_000;
export const SUPPORTED_LANGUAGES = Object.freeze(['id', 'en']);
export const INTERVIEW_MODES = Object.freeze(['hrd', 'user']);
export const SESSION_TTL_SECONDS = 5400;
export const DAILY_LIMITS = Object.freeze({
  analyze: 5,
  interviewStart: 3,
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  PDF_UNREADABLE: 'PDF_UNREADABLE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  QUESTION_CONFLICT: 'QUESTION_CONFLICT',
  QUOTA_REACHED: 'QUOTA_REACHED',
  TEMPORARILY_UNAVAILABLE: 'TEMPORARILY_UNAVAILABLE',
});

export const ERROR_STATUS = Object.freeze({
  INVALID_INPUT: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  PDF_UNREADABLE: 422,
  SESSION_EXPIRED: 410,
  QUESTION_CONFLICT: 409,
  QUOTA_REACHED: 429,
  TEMPORARILY_UNAVAILABLE: 503,
});

export class AppError extends Error {
  constructor(code, statusOrMeta, maybeMeta) {
    const resolvedCode = ERROR_STATUS[code] ? code : ERROR_CODES.TEMPORARILY_UNAVAILABLE;
    super(resolvedCode);
    this.name = 'AppError';
    this.code = resolvedCode;
    if (typeof statusOrMeta === 'number') {
      this.status = statusOrMeta;
      this.meta = maybeMeta && typeof maybeMeta === 'object' ? maybeMeta : {};
    } else {
      this.status = ERROR_STATUS[resolvedCode] || 503;
      this.meta = statusOrMeta && typeof statusOrMeta === 'object' ? statusOrMeta : {};
    }
  }
}

export const ALIAS_GROUPS = Object.freeze({
  javascript: Object.freeze(['javascript', 'js', 'ecmascript', 'es6']),
  typescript: Object.freeze(['typescript', 'ts']),
  nodejs: Object.freeze(['node.js', 'nodejs', 'node js']),
  react: Object.freeze(['react', 'reactjs', 'react.js']),
  nextjs: Object.freeze(['next.js', 'nextjs', 'next js']),
  vuejs: Object.freeze(['vue', 'vue.js', 'vuejs']),
  python: Object.freeze(['python', 'python 3', 'python3', 'py']),
  sql: Object.freeze(['sql', 'structured query language']),
  postgresql: Object.freeze(['postgresql', 'postgres', 'psql']),
  mysql: Object.freeze(['mysql', 'my sql']),
  excel: Object.freeze(['excel', 'microsoft excel', 'ms excel', 'ms. excel', 'spreadsheet excel']),
  'google sheets': Object.freeze(['google sheets', 'gsheets', 'google spreadsheet', 'google spreadsheets']),
  'power bi': Object.freeze(['power bi', 'powerbi', 'microsoft power bi', 'ms power bi']),
  tableau: Object.freeze(['tableau', 'tableau desktop']),
  powerpoint: Object.freeze(['powerpoint', 'microsoft powerpoint', 'ms powerpoint', 'ppt']),
  word: Object.freeze(['microsoft word', 'ms word', 'ms. word']),
  golang: Object.freeze(['golang', 'go language']),
  csharp: Object.freeze(['c#', 'csharp', 'c sharp']),
  cplusplus: Object.freeze(['c++', 'cpp', 'c plus plus']),
  'rest api': Object.freeze(['rest api', 'restful api', 'rest apis', 'restful apis']),
  'ci/cd': Object.freeze(['ci/cd', 'cicd', 'ci cd']),
  git: Object.freeze(['git', 'git version control']),
  github: Object.freeze(['github', 'git hub']),
  'machine learning': Object.freeze(['machine learning', 'ml', 'pembelajaran mesin']),
  'data analysis': Object.freeze(['data analysis', 'data analytics', 'analisis data', 'analisa data']),
  'project management': Object.freeze(['project management', 'manajemen proyek']),
  communication: Object.freeze(['communication', 'communication skills', 'komunikasi', 'kemampuan komunikasi']),
  teamwork: Object.freeze(['teamwork', 'team work', 'kerja tim', 'kerja sama tim', 'kerjasama tim']),
  'problem solving': Object.freeze(['problem solving', 'problem-solving', 'pemecahan masalah']),
});

const ALIAS_LOOKUP = (() => {
  const map = new Map();
  for (const [canonical, variants] of Object.entries(ALIAS_GROUPS)) {
    map.set(canonical, canonical);
    for (const v of variants) {
      map.set(v.toLowerCase().replace(/\s+/g, ' ').trim(), canonical);
    }
  }
  return map;
})();

export function normalizeKeyword(term) {
  if (typeof term !== 'string') return '';
  const cleaned = term
    .toLowerCase()
    .replace(/^[\s"'`([{•·*-]+|[\s"'`)\]},;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return ALIAS_LOOKUP.get(cleaned) || cleaned;
}

export function validateLanguage(lang) {
  if (typeof lang !== 'string') {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'language', reason: 'Language must be a string.' };
  }
  const normalized = lang.trim();
  if (!SUPPORTED_LANGUAGES.includes(normalized)) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'language', reason: 'Unsupported language.' };
  }
  return { ok: true, value: normalized };
}

export function validateJobDescription(jd) {
  if (typeof jd !== 'string') {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'jobDescription', reason: 'Job description is required.' };
  }
  if (jd.length > MAX_JD_CHARS) {
    return {
      ok: false,
      code: ERROR_CODES.INVALID_INPUT,
      field: 'jobDescription',
      reason: `Job description exceeds ${MAX_JD_CHARS} characters.`,
    };
  }
  const trimmed = jd.trim();
  if (trimmed.length === 0 || !/[A-Za-z0-9]/.test(trimmed)) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'jobDescription', reason: 'Job description cannot be blank.' };
  }
  return { ok: true, value: trimmed };
}

export function validateCvText(cvText) {
  if (typeof cvText !== 'string') {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'cvText', reason: 'CV text is required.' };
  }
  if (cvText.length > MAX_CV_TEXT_CHARS) {
    return {
      ok: false,
      code: ERROR_CODES.INVALID_INPUT,
      field: 'cvText',
      reason: `CV text exceeds ${MAX_CV_TEXT_CHARS} characters.`,
    };
  }
  const trimmed = cvText.trim();
  if (trimmed.length === 0 || !/[A-Za-z0-9]/.test(trimmed)) {
    return { ok: false, code: ERROR_CODES.INVALID_INPUT, field: 'cvText', reason: 'CV text cannot be blank.' };
  }
  return { ok: true, value: trimmed };
}

const PLACEHOLDER_TOKENS = new Set(Object.values(REDACTION_PLACEHOLDERS));

const HEADER_ONLY_LINE_RE =
  /^(?:(?:work\s+|professional\s+)?experience|pengalaman(?:\s+(?:kerja|organisasi|proyek))?|education|pendidikan|riwayat\s+pendidikan|(?:technical\s+|core\s+)?skills?|keahlian|keterampilan|projects?|proyek|summary|ringkasan|profil(?:e)?|tentang\s+saya|about(?:\s+me)?|certifications?|sertifikasi|organizations?|organisasi|achievements?|prestasi|languages?|bahasa|contact|kontak|internship|magang|volunteer(?:ing)?)\s*[:=]?\s*$/i;

const SKILLS_OR_CONTACT_LINE_RE =
  /^(?:(?:technical\s+|hard\s+|soft\s+|core\s+)?(?:skills?|keahlian|keterampilan|tools?|technologies|bahasa|languages?|contact|kontak|email|phone|telp|linkedin|github|portfolio)\s*[:=])/i;

const EDUCATION_METADATA_RE =
  /\b(?:universitas|university|institut|institute|politeknik|sekolah\s+tinggi|sma|smk|bachelor(?:'s)?|sarjana|diploma|s1|d3|d4|gpa|ipk|graduated|lulus(?:an)?|class\s+of)\b/i;

const ROLE_DATE_HEADER_RE =
  /\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|sekarang|current)\b/i;

const ACTION_VERB_RE =
  /\b(?:built|wrote|helped|created|developed|designed|managed|analyzed|analysed|prepared|cleaned|automated|implemented|led|assisted|supported|maintained|tested|documented|improved|reduced|increased|conducted|collaborated|organized|coordinated|processed|compiled|visualized|deployed|integrated|migrated|optimized|refactored|trained|presented|researched|handled|performed|contributed|worked|used|delivered|architected|executed|monitored|streamlined|drafted|reviewed|validated|membuat|menulis|membantu|mengembangkan|merancang|mengelola|menganalisis|menganalisa|menyusun|membersihkan|mengotomatisasi|mengimplementasikan|memimpin|mendukung|memelihara|menguji|mendokumentasikan|meningkatkan|mengurangi|melakukan|berkolaborasi|mengatur|mengkoordinasikan|mengolah|memproses|memvisualisasikan|membangun|menyiapkan|menangani|berkontribusi|bekerja|menggunakan|merapikan|mengevaluasi|memantau|melayani|bertanggung\s+jawab)\b/i;

function stripRedactionPlaceholders(str) {
  let cleaned = str;
  for (const token of PLACEHOLDER_TOKENS) {
    cleaned = cleaned.split(token).join(' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function countCandidateBullets(sanitizedCvText) {
  if (typeof sanitizedCvText !== 'string' || !sanitizedCvText.trim()) return 0;

  const lines = sanitizedCvText.replace(/\r\n?/g, '\n').split('\n');
  const seen = new Set();
  let count = 0;

  const addCandidate = (rawSegment, isExplicitBullet) => {
    const cleaned = stripRedactionPlaceholders(rawSegment)
      .replace(/^[-*•·▪▸◦‣]+\s*|^\d+[.)]\s*/, '')
      .trim();
    if (!cleaned) return;
    if (HEADER_ONLY_LINE_RE.test(cleaned)) return;
    if (SKILLS_OR_CONTACT_LINE_RE.test(cleaned)) return;

    const words = cleaned.match(/[A-Za-z0-9+#.-]+/g) || [];
    if (words.length < 4) return;

    if (!isExplicitBullet) {
      if (EDUCATION_METADATA_RE.test(cleaned) && !ACTION_VERB_RE.test(cleaned)) return;
      if (ROLE_DATE_HEADER_RE.test(cleaned) && !ACTION_VERB_RE.test(cleaned)) return;
      if (!ACTION_VERB_RE.test(cleaned)) return;
    } else if (EDUCATION_METADATA_RE.test(cleaned) && words.length < 6 && !ACTION_VERB_RE.test(cleaned)) {
      return;
    }

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      count += 1;
    }
  };

  for (const rawLine of lines) {
    const cells = rawLine.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    for (const cell of cells) {
      const explicit = /^(?:[-*•·▪▸◦‣]|\d+[.)])\s+/.test(cell);
      if (explicit) {
        addCandidate(cell, true);
        continue;
      }
      if (HEADER_ONLY_LINE_RE.test(cell) || SKILLS_OR_CONTACT_LINE_RE.test(cell)) continue;
      // Split multi-sentence paragraphs (such as the PRD single-line JSON CV example).
      const sentences = cell.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      for (const sentence of sentences) {
        addCandidate(sentence, false);
      }
    }
  }

  return count;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'over', 'under', 'were', 'was',
  'are', 'have', 'has', 'had', 'using', 'used', 'their', 'our', 'your', 'about', 'while', 'across',
  'dan', 'yang', 'untuk', 'dengan', 'dari', 'pada', 'dalam', 'ke', 'di', 'oleh', 'serta', 'atau',
  'ini', 'itu', 'sebagai', 'agar', 'saat', 'para',
]);

function normalizeForTrace(str) {
  return str
    .toLowerCase()
    .replace(/^[-*•·▪▸◦‣\s]+/, '')
    .replace(/[^a-z0-9+#%/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContentWords(str) {
  const norm = normalizeForTrace(str);
  if (!norm) return [];
  return norm
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && (w.length >= 3 || /^(?:js|ts|go|ui|ux|qa|ai|ml|bi|db|ci|cd|hr|s1|d3)$/.test(w)));
}

function tracesToSource(original, sanitizedCvText) {
  if (typeof original !== 'string' || typeof sanitizedCvText !== 'string') return false;
  const normOrig = normalizeForTrace(original);
  const normSource = normalizeForTrace(sanitizedCvText);
  if (!normOrig || !normSource) return false;

  const origWords = extractContentWords(original);
  if (origWords.length === 0 && normOrig.length < 8) return false;

  // Fast path: normalized substring against full sanitized CV text.
  if (normOrig.length >= 8 && normSource.includes(normOrig)) return true;

  if (origWords.length < 2) return false;

  // Clause/line & sliding 3-segment window overlap check (>= 60% content-word overlap).
  const rawSegments = sanitizedCvText
    .replace(/\r\n?/g, '\n')
    .split(/[\n\t]+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const checkAgainst = (candidateText) => {
    const candWords = new Set(extractContentWords(candidateText));
    if (candWords.size === 0) return false;
    let hits = 0;
    for (const w of origWords) {
      if (candWords.has(w)) hits += 1;
    }
    return hits / origWords.length >= 0.6;
  };

  for (let i = 0; i < rawSegments.length; i += 1) {
    if (checkAgainst(rawSegments[i])) return true;
    if (i + 1 < rawSegments.length && checkAgainst(`${rawSegments[i]} ${rawSegments[i + 1]}`)) return true;
    if (i + 2 < rawSegments.length && checkAgainst(`${rawSegments[i]} ${rawSegments[i + 1]} ${rawSegments[i + 2]}`)) {
      return true;
    }
  }

  return false;
}

const NUMERIC_TOKEN_RE = /(?<![A-Za-z])\d+(?:[.,]\d+)*%?(?![A-Za-z])/g;

function normalizeNumericForms(token) {
  const forms = new Set([token]);
  const isPercent = token.endsWith('%');
  const body = isPercent ? token.slice(0, -1) : token;
  const suffix = isPercent ? '%' : '';

  // Normalize comma vs dot decimal (e.g., 99,5% <-> 99.5%).
  forms.add(`${body.replace(/,/g, '.')}${suffix}`);

  // If formatted as thousands separator (e.g., 10,000 or 10.000), add plain integer form 10000.
  if (/^\d{1,3}(?:,\d{3})+$/.test(body) || /^\d{1,3}(?:\.\d{3})+$/.test(body)) {
    forms.add(`${body.replace(/[.,]/g, '')}${suffix}`);
  }

  return forms;
}

function buildAllowedNumericSet(...texts) {
  const allowed = new Set();
  for (const txt of texts) {
    if (typeof txt !== 'string') continue;
    const matches = txt.match(NUMERIC_TOKEN_RE) || [];
    for (const tok of matches) {
      for (const form of normalizeNumericForms(tok)) {
        allowed.add(form);
      }
    }
  }
  return allowed;
}

function introducesInventedNumbers(improved, original, sanitizedCvText) {
  const tokens = improved.match(NUMERIC_TOKEN_RE) || [];
  if (tokens.length === 0) return false;
  const allowed = buildAllowedNumericSet(original, sanitizedCvText);
  for (const tok of tokens) {
    const candidateForms = normalizeNumericForms(tok);
    let matched = false;
    for (const f of candidateForms) {
      if (allowed.has(f)) {
        matched = true;
        break;
      }
    }
    if (!matched) return true;
  }
  return false;
}

export function validateAnalysisPayload(payload, sanitizedCvText, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'Payload must be an object.' };
  }
  if (typeof sanitizedCvText !== 'string' || !sanitizedCvText.trim()) {
    return { ok: false, reason: 'sanitizedCvText is required for source validation.' };
  }

  const { atsScore, matchedKeywords, missingKeywords, rewrites } = payload;

  // 1. atsScore: strict integer 0..100.
  if (typeof atsScore !== 'number' || !Number.isInteger(atsScore) || atsScore < 0 || atsScore > 100) {
    return { ok: false, reason: 'atsScore must be an integer between 0 and 100.' };
  }

  // 2. matchedKeywords & missingKeywords: arrays of non-blank strings, deduplicated, disjoint by normalizeKeyword.
  if (!Array.isArray(matchedKeywords) || !Array.isArray(missingKeywords)) {
    return { ok: false, reason: 'matchedKeywords and missingKeywords must be arrays.' };
  }

  const isStandalonePlaceholder = (str) => {
    let hasPlaceholder = false;
    for (const token of PLACEHOLDER_TOKENS) {
      if (str.includes(token)) {
        hasPlaceholder = true;
        break;
      }
    }
    if (!hasPlaceholder) return false;
    return !stripRedactionPlaceholders(str).replace(/[^A-Za-z0-9]+/g, '');
  };

  const cleanMatched = [];
  const matchedSet = new Set();
  for (const item of matchedKeywords) {
    if (typeof item !== 'string' || !item.trim()) {
      return { ok: false, reason: 'matchedKeywords must contain only non-blank strings.' };
    }
    const trimmed = item.trim();
    if (isStandalonePlaceholder(trimmed)) {
      return { ok: false, reason: 'matchedKeywords must not contain standalone redaction placeholders.' };
    }
    const norm = normalizeKeyword(trimmed);
    if (!norm) {
      return { ok: false, reason: 'matchedKeywords contains an invalid keyword.' };
    }
    if (!matchedSet.has(norm)) {
      matchedSet.add(norm);
      cleanMatched.push(trimmed);
    }
  }

  const cleanMissing = [];
  const missingSet = new Set();
  for (const item of missingKeywords) {
    if (typeof item !== 'string' || !item.trim()) {
      return { ok: false, reason: 'missingKeywords must contain only non-blank strings.' };
    }
    const trimmed = item.trim();
    if (isStandalonePlaceholder(trimmed)) {
      return { ok: false, reason: 'missingKeywords must not contain standalone redaction placeholders.' };
    }
    const norm = normalizeKeyword(trimmed);
    if (!norm) {
      return { ok: false, reason: 'missingKeywords contains an invalid keyword.' };
    }
    if (matchedSet.has(norm)) {
      return { ok: false, reason: `Keyword "${trimmed}" appears in both matchedKeywords and missingKeywords.` };
    }
    if (!missingSet.has(norm)) {
      missingSet.add(norm);
      cleanMissing.push(trimmed);
    }
  }

  // 3. rewrites count & sparse-CV rule.
  if (!Array.isArray(rewrites)) {
    return { ok: false, reason: 'rewrites must be an array.' };
  }
  if (rewrites.length > 5) {
    return { ok: false, reason: 'rewrites cannot exceed 5 items.' };
  }

  const candidateBullets = countCandidateBullets(sanitizedCvText);
  const sparseAllowed = Boolean(options?.allowSparse) || candidateBullets < 3;
  const minRewrites = sparseAllowed ? 0 : 3;
  if (rewrites.length < minRewrites) {
    return {
      ok: false,
      reason: `Expected 3 to 5 rewrites for CV with ${candidateBullets} bullets, received ${rewrites.length}.`,
    };
  }

  // 4. Validate each rewrite item for non-blank strings, uniqueness, source traceability, and numeric evidence.
  const cleanRewrites = [];
  const seenOriginals = new Set();
  for (const item of rewrites) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'Each rewrite must be an object.' };
    }
    const { original, improved, reason } = item;
    if (
      typeof original !== 'string' || !original.trim() ||
      typeof improved !== 'string' || !improved.trim() ||
      typeof reason !== 'string' || !reason.trim()
    ) {
      return { ok: false, reason: 'Each rewrite requires non-blank original, improved, and reason strings.' };
    }

    const trimmedOrig = original.trim();
    const trimmedImp = improved.trim();
    const trimmedReason = reason.trim();

    if (HEADER_ONLY_LINE_RE.test(trimmedOrig)) {
      return { ok: false, reason: 'Section headers cannot be used as rewrite originals.' };
    }

    const normOrigKey = normalizeForTrace(trimmedOrig);
    if (seenOriginals.has(normOrigKey)) {
      return { ok: false, reason: 'Duplicate rewrite originals are not allowed.' };
    }
    seenOriginals.add(normOrigKey);

    if (!tracesToSource(trimmedOrig, sanitizedCvText)) {
      return { ok: false, reason: 'Rewrite original does not trace to sanitizedCvText.' };
    }

    if (introducesInventedNumbers(trimmedImp, trimmedOrig, sanitizedCvText)) {
      return { ok: false, reason: 'Rewrite improved introduces unsupported numeric metrics.' };
    }

    cleanRewrites.push({
      original: trimmedOrig,
      improved: trimmedImp,
      reason: trimmedReason,
    });
  }

  return {
    ok: true,
    value: {
      atsScore,
      matchedKeywords: cleanMatched,
      missingKeywords: cleanMissing,
      rewrites: cleanRewrites,
    },
    candidateBullets,
    isSparse: cleanRewrites.length < 3,
  };
}

export function formatJakartaResetTime(isoString, lang = 'id') {
  const isEn = lang === 'en';
  if (typeof isoString !== 'string' || !isoString.trim()) {
    return isEn ? '00:00 WIB (Asia/Jakarta)' : '00.00 WIB (Asia/Jakarta)';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isEn ? '00:00 WIB (Asia/Jakarta)' : '00.00 WIB (Asia/Jakarta)';
  }
  try {
    const formatted = new Intl.DateTimeFormat(isEn ? 'en-GB' : 'id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${formatted} WIB`;
  } catch {
    return isEn ? '00:00 WIB (Asia/Jakarta)' : '00.00 WIB (Asia/Jakarta)';
  }
}

export function getErrorCopy(code, lang = 'id', meta = {}) {
  const isEn = lang === 'en';
  const field = meta?.field;

  switch (code) {
    case ERROR_CODES.PDF_UNREADABLE:
      // Exact §2 copy from guideline.md lines 42-43.
      return isEn
        ? 'We couldn’t read the text in this CV. Upload a PDF with text you can select or copy.'
        : 'Teks CV belum bisa dibaca. Unggah PDF yang teksnya bisa dipilih atau disalin.';

    case ERROR_CODES.FILE_TOO_LARGE:
      return isEn
        ? 'This PDF exceeds the 5 MB limit. Choose a smaller PDF file.'
        : 'Ukuran PDF melebihi batas 5 MB. Pilih berkas PDF yang lebih kecil.';

    case ERROR_CODES.UNSUPPORTED_FILE:
      return isEn
        ? 'Unsupported file format. Upload one PDF file (.pdf).'
        : 'Format berkas belum didukung. Unggah satu berkas berformat PDF (.pdf).';

    case ERROR_CODES.INVALID_INPUT:
      if (field === 'file') {
        return isEn ? 'Choose one readable PDF file before analyzing.' : 'Pilih satu berkas PDF terlebih dahulu sebelum menganalisis.';
      }
      if (field === 'jobDescription') {
        return isEn
          ? 'Paste a non-empty job description (up to 15,000 characters).'
          : 'Tempel deskripsi lowongan yang tidak kosong (maksimal 15.000 karakter).';
      }
      if (field === 'cvText') {
        return isEn
          ? 'Provide readable CV text within the 30,000-character limit.'
          : 'Masukkan teks CV yang terbaca dalam batas 30.000 karakter.';
      }
      if (field === 'language') {
        return isEn
          ? 'Choose a supported language (Bahasa Indonesia or English).'
          : 'Pilih bahasa yang didukung (Bahasa Indonesia atau Inggris).';
      }
      return isEn
        ? 'Check your input fields and try again.'
        : 'Periksa kembali isian kamu lalu coba lagi.';

    case ERROR_CODES.SESSION_EXPIRED:
      return isEn
        ? 'Your 90-minute preparation session has expired. Run a new CV analysis to continue.'
        : 'Sesi persiapan 90 menit sudah berakhir. Jalankan analisis CV baru untuk melanjutkan.';

    case ERROR_CODES.QUESTION_CONFLICT:
      return isEn
        ? 'This step was already updated. Your draft is preserved on the current question.'
        : 'Langkah ini sudah diperbarui. Draf kamu tetap tersimpan pada pertanyaan saat ini.';

    case ERROR_CODES.QUOTA_REACHED: {
      const resetLabel = formatJakartaResetTime(meta?.resetAt, lang);
      const isInterview = meta?.action === 'interviewStart';
      if (isInterview) {
        return isEn
          ? `Daily mock interview start limit reached (3 per day). Resets at ${resetLabel}.`
          : `Batas harian mulai simulasi wawancara tercapai (3 per hari). Kuota direset pada ${resetLabel}.`;
      }
      return isEn
        ? `Daily CV analysis limit reached (5 per day). Resets at ${resetLabel}.`
        : `Batas harian analisis CV tercapai (5 per hari). Kuota direset pada ${resetLabel}.`;
    }

    case ERROR_CODES.TEMPORARILY_UNAVAILABLE:
    default:
      return isEn
        ? 'The analysis service is temporarily unavailable. Your inputs are kept—please try again in a moment.'
        : 'Layanan analisis sedang tidak tersedia sementara. Isian kamu tetap tersimpan—silakan coba lagi sesaat lagi.';
  }
}

export function buildCvReportText(analysis, lang = 'id', meta = {}) {
  const isEn = lang === 'en';
  const safe = redactAnalysisOutput(analysis || {});
  const score = Number.isInteger(safe?.atsScore) ? safe.atsScore : 0;
  const matched = Array.isArray(safe?.matchedKeywords) ? safe.matchedKeywords : [];
  const missing = Array.isArray(safe?.missingKeywords) ? safe.missingKeywords : [];
  const rewrites = Array.isArray(safe?.rewrites) ? safe.rewrites : [];

  const lines = [];
  lines.push(isEn ? 'LatihKerja — CV Review Summary' : 'LatihKerja — Ringkasan Tinjauan CV');
  if (meta?.isExample) {
    lines.push(
      isEn
        ? 'Note: Fictional example for preview purposes.'
        : 'Catatan: Contoh fiktif untuk pratinjau.'
    );
  }
  lines.push(
    isEn
      ? `Estimated ATS alignment (this CV vs pasted vacancy): ${score}/100`
      : `Estimasi kecocokan ATS (CV ini terhadap lowongan yang ditempel): ${score}/100`
  );
  lines.push(
    isEn
      ? 'Disclaimer: Coaching estimate based on text overlap, not an employer screening guarantee.'
      : 'Catatan: Skor ini adalah estimasi pembimbingan berdasarkan kesesuaian teks, bukan jaminan lolos seleksi perusahaan.'
  );
  lines.push('');

  lines.push(
    isEn
      ? `Matched keywords: ${matched.length > 0 ? matched.join(', ') : 'No advertised skills evidenced yet in this CV.'}`
      : `Kata kunci yang sesuai: ${matched.length > 0 ? matched.join(', ') : 'Belum ada kata kunci lowongan yang terlihat pada CV ini.'}`
  );
  lines.push(
    isEn
      ? `Missing keywords: ${missing.length > 0 ? missing.join(', ') : 'All key requirements in this vacancy are evidenced.'}`
      : `Kata kunci yang belum terlihat: ${missing.length > 0 ? missing.join(', ') : 'Semua kebutuhan utama pada lowongan ini sudah terlihat.'}`
  );
  lines.push('');

  lines.push(isEn ? 'Suggested CV bullet improvements:' : 'Usulan perbaikan poin CV:');
  if (rewrites.length === 0) {
    lines.push(
      isEn
        ? '- No experience or project bullets were found to rewrite honestly. Add coursework, internship, organization, or project bullets to your CV.'
        : '- Belum ada poin pengalaman atau proyek yang dapat ditulis ulang secara jujur. Tambahkan poin tugas kuliah, magang, organisasi, atau proyek pada CV kamu.'
    );
  } else {
    if (rewrites.length < 3) {
      lines.push(
        isEn
          ? `(Showing ${rewrites.length} rewrite${rewrites.length === 1 ? '' : 's'} based on the ${rewrites.length} distinct source bullet${rewrites.length === 1 ? '' : 's'} found in this CV.)`
          : `(Menampilkan ${rewrites.length} usulan perbaikan sesuai jumlah poin pengalaman yang ditemukan pada CV ini.)`
      );
    }
    rewrites.forEach((rw, idx) => {
      lines.push(`${idx + 1}. ${isEn ? 'Original' : 'Asli'}: ${redactPii(rw.original || '')}`);
      lines.push(`   ${isEn ? 'Improved' : 'Usulan'}: ${redactPii(rw.improved || '')}`);
      lines.push(`   ${isEn ? 'Reason' : 'Alasan'}: ${redactPii(rw.reason || '')}`);
    });
  }

  return lines.join('\n');
}

export const FIXTURES = Object.freeze({
  en: Object.freeze({
    cvText:
      'Built a Python script to clean duplicate rows. Helped make weekly reports in Excel. Wrote instructions for the reports.',
    jobDescription: 'Data intern. Python, Excel and SQL required.',
    language: 'en',
    response: Object.freeze({
      sessionId: 'sess_example_en',
      atsScore: 68,
      matchedKeywords: Object.freeze(['Python', 'Excel']),
      missingKeywords: Object.freeze(['SQL']),
      rewrites: Object.freeze([
        Object.freeze({
          original: 'Built a Python script to clean duplicate rows.',
          improved: 'Wrote a Python script to remove duplicate rows from a dataset.',
          reason: 'Names the tool and the operation. Add dataset size if known.',
        }),
        Object.freeze({
          original: 'Helped make weekly reports in Excel.',
          improved: 'Contributed to weekly reporting in Excel.',
          reason: 'Keeps the reporting frequency and your level of responsibility.',
        }),
        Object.freeze({
          original: 'Wrote instructions for the reports.',
          improved: 'Documented how to prepare the weekly reports.',
          reason: 'Clarifies the purpose of the instructions. Mention the audience if known.',
        }),
      ]),
    }),
  }),
  id: Object.freeze({
    cvText:
      'Membuat skrip Python untuk membersihkan baris duplikat. Membantu membuat laporan mingguan di Excel. Menulis petunjuk untuk laporan.',
    jobDescription: 'Magang analis data. Menguasai Python, Excel, dan SQL.',
    language: 'id',
    response: Object.freeze({
      sessionId: 'sess_example_id',
      atsScore: 68,
      matchedKeywords: Object.freeze(['Python', 'Excel']),
      missingKeywords: Object.freeze(['SQL']),
      rewrites: Object.freeze([
        Object.freeze({
          original: 'Membuat skrip Python untuk membersihkan baris duplikat.',
          improved: 'Menulis skrip Python untuk menghapus baris duplikat pada dataset.',
          reason: 'Menjelaskan tindakan dan alat yang digunakan. Tambahkan ukuran dataset jika diketahui.',
        }),
        Object.freeze({
          original: 'Membantu membuat laporan mingguan di Excel.',
          improved: 'Berkontribusi dalam penyusunan laporan mingguan menggunakan Excel.',
          reason: 'Menjaga frekuensi pelaporan, alat, dan porsi tanggung jawab sesuai CV.',
        }),
        Object.freeze({
          original: 'Menulis petunjuk untuk laporan.',
          improved: 'Mendokumentasikan langkah penyusunan laporan mingguan.',
          reason: 'Memperjelas tujuan petunjuk. Sebutkan pembaca panduan jika diketahui.',
        }),
      ]),
    }),
  }),
  sparseTwo: Object.freeze({
    sessionId: 'sess_sparse_two',
    atsScore: 55,
    matchedKeywords: Object.freeze(['Python', 'Excel']),
    missingKeywords: Object.freeze(['SQL']),
    rewrites: Object.freeze([
      Object.freeze({
        original: 'Built a Python script to clean duplicate rows.',
        improved: 'Wrote a Python script to remove duplicate rows from raw records.',
        reason: 'Clarifies the data-cleaning action. Add row volume if known.',
      }),
      Object.freeze({
        original: 'Helped make weekly reports in Excel.',
        improved: 'Contributed to weekly Excel summary reports.',
        reason: 'Preserves your supporting role and cadence.',
      }),
    ]),
  }),
  sparseZero: Object.freeze({
    sessionId: 'sess_sparse_zero',
    atsScore: 40,
    matchedKeywords: Object.freeze(['Python', 'Excel']),
    missingKeywords: Object.freeze(['SQL']),
    rewrites: Object.freeze([]),
  }),
  emptyMatched: Object.freeze({
    sessionId: 'sess_empty_matched',
    atsScore: 18,
    matchedKeywords: Object.freeze([]),
    missingKeywords: Object.freeze(['Python', 'SQL', 'Tableau']),
    rewrites: Object.freeze([
      Object.freeze({
        original: 'Organized student club event schedules in spreadsheets.',
        improved: 'Coordinated student club event schedules using structured spreadsheets.',
        reason: 'Highlights scheduling structure. Mention the number of events if known.',
      }),
      Object.freeze({
        original: 'Prepared meeting notes for committee members.',
        improved: 'Documented action items and meeting notes for committee members.',
        reason: 'Clarifies what readers gained from the notes.',
      }),
      Object.freeze({
        original: 'Answered questions from new club members.',
        improved: 'Guided new club members on onboarding questions and schedules.',
        reason: 'Specifies the topic of support without overstating scope.',
      }),
    ]),
  }),
  emptyMissing: Object.freeze({
    sessionId: 'sess_empty_missing',
    atsScore: 92,
    matchedKeywords: Object.freeze(['Python', 'Excel', 'SQL']),
    missingKeywords: Object.freeze([]),
    rewrites: Object.freeze([
      Object.freeze({
        original: 'Built a Python script to clean duplicate rows.',
        improved: 'Wrote a Python script to remove duplicate rows before analysis.',
        reason: 'Connects the script to downstream data quality.',
      }),
      Object.freeze({
        original: 'Queried tables in SQL for weekly checks.',
        improved: 'Wrote SQL queries to verify weekly reporting tables.',
        reason: 'Clarifies the purpose of the SQL checks.',
      }),
      Object.freeze({
        original: 'Helped make weekly reports in Excel.',
        improved: 'Contributed to weekly reporting workbooks in Excel.',
        reason: 'Preserves cadence and collaboration scope.',
      }),
    ]),
  }),
  errors: Object.freeze({
    INVALID_INPUT: Object.freeze({ error: Object.freeze({ code: 'INVALID_INPUT', field: 'jobDescription' }) }),
    FILE_TOO_LARGE: Object.freeze({ error: Object.freeze({ code: 'FILE_TOO_LARGE' }) }),
    UNSUPPORTED_FILE: Object.freeze({ error: Object.freeze({ code: 'UNSUPPORTED_FILE' }) }),
    PDF_UNREADABLE: Object.freeze({ error: Object.freeze({ code: 'PDF_UNREADABLE' }) }),
    SESSION_EXPIRED: Object.freeze({ error: Object.freeze({ code: 'SESSION_EXPIRED' }) }),
    QUESTION_CONFLICT: Object.freeze({ error: Object.freeze({ code: 'QUESTION_CONFLICT' }) }),
    QUOTA_REACHED: Object.freeze({
      error: Object.freeze({
        code: 'QUOTA_REACHED',
        action: 'analyze',
        resetAt: '2026-11-25T17:00:00.000Z',
      }),
    }),
    TEMPORARILY_UNAVAILABLE: Object.freeze({ error: Object.freeze({ code: 'TEMPORARILY_UNAVAILABLE' }) }),
  }),
});
