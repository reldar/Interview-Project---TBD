// Shared client-safe contracts, validators, localized error copy, report builder, and fixtures.
// Zero Node-only imports so both App Router client components and Node Route Handlers can import this module.

import { MAX_PDF_BYTES } from '../app/limit.js';
import { REDACTION_PLACEHOLDERS, redactAnalysisOutput, redactPii } from './redact.js';

export { MAX_PDF_BYTES };

export const MAX_MULTIPART_OVERHEAD_BYTES = 65_536;
export const MAX_CV_TEXT_CHARS = 30_000;
export const MAX_JD_CHARS = 15_000;
export const MAX_KEYWORDS_PER_GROUP = 60;
export const MAX_KEYWORD_CHARS = 100;
export const MAX_REWRITE_FIELD_CHARS = 600;
export const SUPPORTED_LANGUAGES = Object.freeze(['id', 'en']);
export const INTERVIEW_MODES = Object.freeze(['hrd', 'user']);
export const INTERVIEW_QUESTION_COUNT = 5;
export const MAX_INTERVIEW_QUESTION_CHARS = 500;
export const MAX_INTERVIEW_FOCUS_CHARS = 120;
export const MAX_INTERVIEW_ANSWER_CHARS = 4_000;
export const MAX_INTERVIEW_SUGGESTION_CHARS = 360;
const SESSION_ID_PATTERN = /^sess_[A-Za-z0-9_-]{1,100}$/;
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

export function validateFeedbackRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  }
  const { sessionId, positive, language } = body;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'sessionId' });
  }
  if (typeof positive !== 'boolean') {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'positive' });
  }
  const lang = validateLanguage(language);
  if (!lang.ok) throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'language' });
  return { sessionId, positive, language: lang.value };
}

export function validateInterviewStartRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  }
  const { sessionId, mode, language } = body;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'sessionId' });
  }
  if (!INTERVIEW_MODES.includes(mode)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'mode' });
  }
  const lang = validateLanguage(language);
  if (!lang.ok) throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'language' });
  return { sessionId, mode, language: lang.value };
}

export function validateInterviewAnswerRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'body' });
  }
  const { sessionId, questionNumber, userAnswer } = body;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'sessionId' });
  }
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > INTERVIEW_QUESTION_COUNT) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'questionNumber' });
  }
  if (typeof userAnswer !== 'string' || userAnswer.length > MAX_INTERVIEW_ANSWER_CHARS || !userAnswer.trim()) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, { field: 'userAnswer' });
  }
  return { sessionId, questionNumber, userAnswer: userAnswer.trim() };
}

export function isInterviewFeedback(feedback) {
  return Boolean(
    feedback &&
    [feedback.clarityScore, feedback.relevanceScore, feedback.impactScore]
      .every((score) => Number.isInteger(score) && score >= 1 && score <= 5) &&
    typeof feedback.suggestion === 'string' &&
    feedback.suggestion.trim() &&
    feedback.suggestion.length <= MAX_INTERVIEW_SUGGESTION_CHARS
  );
}

export function isInterviewQuestion(question, expectedNumber) {
  return Boolean(
    question &&
    Number.isInteger(question.questionNumber) &&
    question.questionNumber >= 1 &&
    question.questionNumber <= INTERVIEW_QUESTION_COUNT &&
    (expectedNumber === undefined || expectedNumber === question.questionNumber) &&
    typeof question.questionText === 'string' &&
    question.questionText.trim() &&
    question.questionText.length <= MAX_INTERVIEW_QUESTION_CHARS &&
    typeof question.focusArea === 'string' &&
    question.focusArea.trim() &&
    question.focusArea.length <= MAX_INTERVIEW_FOCUS_CHARS
  );
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

const BULLET_PREFIX_RE = /^(?:[-*•·▪▸◦‣]+|\d+[.)])\s+/;

function candidateBulletKey(text) {
  return text.normalize('NFC').trim().replace(BULLET_PREFIX_RE, '')
    .replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function candidateBulletSources(sanitizedCvText) {
  const sources = new Set();
  if (typeof sanitizedCvText !== 'string' || !sanitizedCvText.trim()) return sources;

  const lines = sanitizedCvText.replace(/\r\n?/g, '\n').split('\n');

  const addCandidate = (rawSegment, isExplicitBullet) => {
    const cleaned = stripRedactionPlaceholders(rawSegment).replace(BULLET_PREFIX_RE, '').trim();
    if (!cleaned) return;
    if (HEADER_ONLY_LINE_RE.test(cleaned)) return;
    if (SKILLS_OR_CONTACT_LINE_RE.test(cleaned)) return;

    const words = cleaned.match(/[\p{L}\p{N}+#.-]+/gu) || [];
    if (words.length < 4) return;

    // Unbulleted prose can start with an action outside the common CV verb list.
    const hasAction = ACTION_VERB_RE.test(cleaned)
      || /^(?:\p{L}{3,}ed|(?:me(?:m|n|ng|ny)|ber)\p{L}{3,})\b/iu.test(cleaned);
    if (!isExplicitBullet) {
      if (!hasAction) return;
      if ((EDUCATION_METADATA_RE.test(cleaned) || ROLE_DATE_HEADER_RE.test(cleaned)) && !ACTION_VERB_RE.test(cleaned)) return;
    } else if (EDUCATION_METADATA_RE.test(cleaned) && words.length < 6 && !hasAction) {
      return;
    }

    sources.add(candidateBulletKey(rawSegment));
  };

  for (const rawLine of lines) {
    const cells = rawLine.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    for (const cell of cells) {
      const explicit = BULLET_PREFIX_RE.test(cell);
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

  return sources;
}

export function countCandidateBullets(sanitizedCvText) {
  return candidateBulletSources(sanitizedCvText).size;
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

const NUMERIC_TOKEN_RE = /(?<![\p{L}\p{N}])(?:[+−-])?\d+(?:[.,]\d+)*(?:[ \t]*%)?/gu;

const INVARIANT_S_TOKENS = new Set([
  'aws', 'gcs', 'rds', 'ecs', 'eks', 'sns', 'sqs', 'kms', 'iam', 'css', 'sass', 'less',
  'nextjs', 'nodejs', 'reactjs', 'vuejs', 'expressjs', 'nestjs', 'nuxtjs', 'threejs', 'chartjs', 'rxjs', 'd3js',
  'postgres', 'kubernetes', 'jenkins', 'pandas', 'rails', 'devops', 'mlops', 'secops', 'gitops', 'finops', 'dataops',
  'linux', 'windows', 'macos', 'ios', 'axios', 'cypress', 'vitest', 'keras', 'spss', 'oops', 'cors', 'https',
  'dns', 'tls', 'sms', 'cms', 'lms', 'ats', 'saas', 'paas', 'iaas', 'baas', 'series', 'species',
  'bisnis', 'analisis', 'teknis', 'operasional', 'staf', 'kas', 'tugas', 'lulus', 'kelas', 'berkas',
]);

function stemSkillToken(tok) {
  if (!tok || tok.length <= 3) return tok;
  if (INVARIANT_S_TOKENS.has(tok) || /[\d+#]/.test(tok)) return tok;
  if (tok.endsWith('ss') || tok.endsWith('us') || tok.endsWith('is')) return tok;
  if (tok.length >= 5 && tok.endsWith('ies') && !/[aeiou]ies$/.test(tok)) {
    return `${tok.slice(0, -3)}y`;
  }
  if (tok.length >= 5 && /(?:sses|ches|shes|xes|zes)$/.test(tok) && tok !== 'caches' && tok !== 'niches') {
    return tok.slice(0, -2);
  }
  if (tok.endsWith('s')) {
    return tok.slice(0, -1);
  }
  return tok;
}

function extractNormalizedTokens(value) {
  if (typeof value !== 'string' || !value) return [];
  return (
    value
      .toLowerCase()
      .replace(/\b([a-z0-9]{2,})\.js\b/g, '$1js')
      .replace(/\bms\.\s+/g, 'ms ')
      .match(/[\p{L}\p{N}+#]+/gu) || []
  );
}

export function tokenizeText(value) {
  const tokens = extractNormalizedTokens(value);
  if (tokens.length === 0) {
    return { exact: '  ', stemmed: '  ' };
  }
  const stemmedTokens = tokens.map(stemSkillToken);
  return {
    exact: ` ${tokens.join(' ')} `,
    stemmed: ` ${stemmedTokens.join(' ')} `,
  };
}

const PRETOKENIZED_ALIAS_VARIANTS = (() => {
  const map = new Map();
  for (const [canonical, variants] of Object.entries(ALIAS_GROUPS)) {
    const compiled = [];
    for (const variant of variants) {
      const tok = tokenizeText(variant);
      if (tok.exact.trim()) compiled.push(tok);
    }
    map.set(canonical, compiled);
  }
  return map;
})();

function containsSkill(haystackOrText, term) {
  const cleanedTerm = stripRedactionPlaceholders(String(term || '')).replace(/[()]/g, ' ').trim();
  const keyword = normalizeKeyword(cleanedTerm);
  if (!keyword) return false;
  const haystack =
    haystackOrText && typeof haystackOrText === 'object' && typeof haystackOrText.exact === 'string'
      ? haystackOrText
      : tokenizeText(haystackOrText);

  const precompiled = PRETOKENIZED_ALIAS_VARIANTS.get(keyword);
  const variants = precompiled || [tokenizeText(keyword)];
  return variants.some(
    (v) =>
      v.exact.trim() &&
      (haystack.exact.includes(v.exact) || haystack.stemmed.includes(v.stemmed))
  );
}

function positiveCvEvidence(text) {
  return text
    .replace(/\bgo(?=\s+(?:to|through|back|for|over|out|on|home|ahead)\b)/gi, ' ')
    .split(/\n|(?<=[.!?;])\s+|\b(?:but|however|tetapi|namun)\b/iu)
    .map((clause) => clause.replace(/\b(?:no (?:prior )?(?:experience|knowledge|familiarity)|(?:do not|don't|did not|didn't|never) (?:use|used|work|worked|learn|learned|have)|(?:belum|tidak) (?:pernah|berpengalaman|menguasai|menggunakan|memiliki pengalaman))\b.*$/iu, ' '))
    .join('\n');
}

function omitsKnownRequiredSkill(sanitizedJd, matchedSet) {
  const requirements = sanitizedJd.split(/\n|(?<=[.!?;])\s+/).filter((clause) =>
    /\b(?:required|mandatory|must|wajib|dibutuhkan|diperlukan)\b/i.test(clause)
    && !/\b(?:preferred|optional|nice to have|nilai tambah|diutamakan)\b/i.test(clause));
  return requirements.some((clause) => {
    const tokens = tokenizeText(clause);
    return Object.keys(ALIAS_GROUPS).some((skill) => !matchedSet.has(skill) && containsSkill(tokens, skill));
  });
}

const SOFT_SKILL_CANONICALS = new Set([
  'data analysis',
  'communication',
  'teamwork',
  'problem solving',
]);

const EXTRA_TECH_SYNONYM_GROUPS = [
  ['kubernetes', ['kubernetes', 'k8s']],
  ['docker', ['docker']],
  ['aws', ['aws', 'amazon web services']],
  ['gcp', ['gcp', 'google cloud', 'google cloud platform']],
  ['azure', ['azure', 'microsoft azure']],
  ['terraform', ['terraform']],
  ['ansible', ['ansible']],
  ['jenkins', ['jenkins']],
  ['graphql', ['graphql']],
  ['kafka', ['kafka', 'apache kafka']],
  ['redis', ['redis']],
  ['mongodb', ['mongodb']],
  ['elasticsearch', ['elasticsearch']],
  ['snowflake', ['snowflake']],
  ['bigquery', ['bigquery']],
  ['spark', ['spark', 'apache spark', 'pyspark']],
  ['hadoop', ['hadoop']],
  ['airflow', ['airflow', 'apache airflow']],
  ['dbt', ['dbt']],
  ['pytorch', ['pytorch']],
  ['tensorflow', ['tensorflow']],
  ['scikit-learn', ['scikit-learn', 'scikit learn', 'sklearn']],
  ['pandas', ['pandas']],
  ['numpy', ['numpy']],
  ['figma', ['figma']],
  ['sketch', ['sketch']],
  ['jira', ['jira']],
  ['confluence', ['confluence']],
  ['salesforce', ['salesforce']],
  ['sap', ['sap']],
  ['oracle', ['oracle']],
  ['looker', ['looker', 'looker studio']],
  ['qlik', ['qlik', 'qlikview', 'qlik sense']],
  ['spss', ['spss']],
  ['stata', ['stata']],
  ['matlab', ['matlab']],
  ['swift', ['swift']],
  ['kotlin', ['kotlin']],
  ['rust', ['rust']],
  ['ruby', ['ruby']],
  ['rails', ['rails', 'ruby on rails']],
  ['php', ['php']],
  ['laravel', ['laravel']],
  ['django', ['django']],
  ['flask', ['flask']],
  ['fastapi', ['fastapi']],
  ['spring', ['spring', 'spring boot']],
  ['angular', ['angular', 'angularjs']],
  ['svelte', ['svelte', 'sveltekit']],
  ['flutter', ['flutter']],
  ['dart', ['dart']],
  ['solidity', ['solidity']],
  ['blockchain', ['blockchain']],
  ['linux', ['linux']],
  ['bash', ['bash']],
  ['powershell', ['powershell']],
  ['selenium', ['selenium']],
  ['playwright', ['playwright']],
  ['cypress', ['cypress']],
  ['jest', ['jest']],
  ['vitest', ['vitest']],
  ['junit', ['junit']],
  ['postman', ['postman']],
  ['swagger', ['swagger']],
  ['opencv', ['opencv']],
  ['langchain', ['langchain']],
  ['openai', ['openai']],
  ['gemini', ['gemini']],
  ['llm', ['llm', 'llms', 'large language model', 'large language models']],
  ['html', ['html', 'html5']],
  ['css', ['css', 'css3', 'tailwind', 'tailwindcss', 'bootstrap']],
  ['java', ['java']],
];

const TECH_BY_FIRST_TOKEN = (() => {
  const entries = [];
  for (const [canonical, variants] of Object.entries(ALIAS_GROUPS)) {
    if (SOFT_SKILL_CANONICALS.has(canonical)) continue;
    for (const variant of variants) {
      const tokens = extractNormalizedTokens(variant);
      if (tokens.length > 0) entries.push({ canonical, tokens });
    }
  }
  for (const [canonical, variants] of EXTRA_TECH_SYNONYM_GROUPS) {
    for (const variant of variants) {
      const tokens = extractNormalizedTokens(variant);
      if (tokens.length > 0) entries.push({ canonical, tokens });
    }
  }
  // Sort longest phrase first so multi-word & dotted phrases match before single tokens.
  entries.sort((a, b) => b.tokens.length - a.tokens.length);

  const index = new Map();
  for (const entry of entries) {
    const first = entry.tokens[0];
    if (!index.has(first)) index.set(first, []);
    index.get(first).push(entry);
  }
  return index;
})();

function extractTechSkills(text) {
  const tokens = extractNormalizedTokens(text);
  const found = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    const candidates = TECH_BY_FIRST_TOKEN.get(tokens[i]);
    if (!candidates) continue;
    let matchedLen = 0;
    for (const cand of candidates) {
      if (i + cand.tokens.length > tokens.length) continue;
      let allMatch = true;
      for (let k = 1; k < cand.tokens.length; k += 1) {
        if (tokens[i + k] !== cand.tokens[k]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        found.add(cand.canonical);
        matchedLen = cand.tokens.length;
        break;
      }
    }
    if (matchedLen > 1) {
      i += matchedLen - 1;
    }
  }
  return found;
}

const MONTH_TOKEN_PART =
  '(?:jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)\\.?';

const DATE_RANGE_YEAR_RE =
  /\b((?:19|20)\d{2})\s*(?:[-–—/]|s\.?d\.?)\s*((?:19|20)\d{2}|present|sekarang|current|now|kini)\b/gi;
const DATE_PAREN_YEAR_RE = /\(\s*((?:19|20)\d{2})\s*\)/g;
const DATE_MONTH_FIRST_RE = new RegExp(
  `\\b${MONTH_TOKEN_PART}\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?((?:19|20)\\d{2})\\b`,
  'gi'
);
const DATE_DAY_MONTH_YEAR_RE = new RegExp(
  `\\b\\d{1,2}\\s+${MONTH_TOKEN_PART},?\\s+((?:19|20)\\d{2})\\b`,
  'gi'
);
const DATE_PREP_ORIG_RE =
  /\b(?:in|since|during|until|from|to|graduated|class\s+of|expected\s+graduation|tahun|sejak|pada|lulus(?:an)?|hingga|sampai)\s+((?:19|20)\d{2})\b/gi;
const DATE_PREP_IMP_RE =
  /(?<!\bup\s+)\b(?:in|since|during|until|from|to|graduated|class\s+of|expected\s+graduation|tahun|sejak|pada|lulus(?:an)?|hingga|sampai)\s+((?:19|20)\d{2})\b(?!\s+(?:[a-z]+\s+)?(?:engineers|users|clients|customers|rows|records|reports|datasets|tables|queries|scripts|projects|teams|members|students|employees|transactions|orders|tickets|bugs|baris|laporan|pengguna|pelanggan|mahasiswa|karyawan)\b)/gi;

function extractDateYearsAndNonDateCounts(text, isImproved) {
  const dateYears = new Set();
  const prepRe = isImproved ? DATE_PREP_IMP_RE : DATE_PREP_ORIG_RE;

  for (const m of text.matchAll(DATE_RANGE_YEAR_RE)) {
    dateYears.add(m[1]);
    if (/^(?:19|20)\d{2}$/.test(m[2])) dateYears.add(m[2]);
  }
  for (const m of text.matchAll(DATE_PAREN_YEAR_RE)) dateYears.add(m[1]);
  for (const m of text.matchAll(DATE_MONTH_FIRST_RE)) dateYears.add(m[1]);
  for (const m of text.matchAll(DATE_DAY_MONTH_YEAR_RE)) dateYears.add(m[1]);
  for (const m of text.matchAll(prepRe)) dateYears.add(m[1]);

  const stripped = text
    .replace(DATE_RANGE_YEAR_RE, ' ')
    .replace(DATE_PAREN_YEAR_RE, ' ')
    .replace(DATE_MONTH_FIRST_RE, ' ')
    .replace(DATE_DAY_MONTH_YEAR_RE, ' ')
    .replace(prepRe, ' ');

  const nonDateCounts = new Map();
  for (const y of stripped.match(/\b(?:19|20)\d{2}\b/g) || []) {
    nonDateCounts.set(y, (nonDateCounts.get(y) || 0) + 1);
  }
  return { dateYears, nonDateCounts };
}

function misusesDateAsMetric(original, improved) {
  const origInfo = extractDateYearsAndNonDateCounts(original, false);
  if (origInfo.dateYears.size === 0) return false;
  const impInfo = extractDateYearsAndNonDateCounts(improved, true);
  for (const year of origInfo.dateYears) {
    const allowedNonDate = origInfo.nonDateCounts.get(year) || 0;
    const actualNonDate = impInfo.nonDateCounts.get(year) || 0;
    if (actualNonDate > allowedNonDate) return true;
  }
  return false;
}

const CREDENTIAL_GROUPS = [
  ['certified', 'certification', 'certifications', 'certificate', 'certificates', 'bersertifikat', 'tersertifikasi', 'sertifikasi', 'sertifikat'],
  ['licensed', 'lisensi', 'berlisensi'],
  ['patented', 'patent', 'patents', 'paten'],
  ['awarded', 'award', 'awards', 'penghargaan'],
  ['degree', 'gelar'],
  ['bachelor', 'sarjana'], ['master', 'magister'], ['doctorate', 'phd', 'doktor'],
  ['expert', 'expertise', 'ahli', 'pakar'], ['proficient', 'proficiency', 'mahir'],
];

const SENIORITY_AND_TITLE_GROUPS = [
  ['senior', 'sr'],
  ['principal'],
  ['staff', 'staf'],
  ['lead', 'leads', 'leader', 'leaders', 'ketua'],
  ['chief'],
  ['cto'],
  ['ceo'],
  ['cfo'],
  ['vp'],
  ['director', 'directors', 'direktur'],
  ['head', 'heads', 'kepala'],
  ['manager', 'managers', 'manajer'],
  ['supervisor', 'supervisors', 'penyelia'],
  ['architect', 'architects', 'arsitek'],
  ['engineer', 'engineers', 'engineering', 'insinyur'],
];

const LEADERSHIP_VERB_GROUPS = [
  ['led', 'spearheaded', 'memimpin'],
  ['managed', 'mengelola'],
  ['directed', 'mengarahkan'],
  ['architected'],
  ['supervised', 'oversaw', 'mengawasi'],
  ['headed', 'mengepalai'],
  ['founded', 'mendirikan'],
  ['owned', 'ownership'],
  ['promoted', 'promotion', 'dipromosikan', 'promosi'],
];

const OUTCOME_GROUPS = [
  ['saved', 'saving', 'savings', 'menghemat', 'penghematan'],
  ['reduced', 'reducing', 'reduction', 'decreased', 'lowered', 'mengurangi', 'menurunkan', 'penurunan'],
  ['increased', 'increasing', 'increase', 'boosted', 'raised', 'grew', 'meningkatkan', 'peningkatan', 'menaikkan'],
  ['eliminated', 'eradicated', 'eliminasi', 'mengeliminasi'],
  ['achieved', 'attained', 'mencapai'], ['exceeded', 'melampaui'],
  ['won', 'earned', 'meraih', 'memenangkan'],
  ['generated', 'menghasilkan'],
  ['prevented', 'avoided', 'mencegah', 'menghindari'],
  ['automated', 'automation', 'mengotomatisasi', 'otomatisasi'],
  ['deployed', 'launched', 'published', 'meluncurkan', 'menerbitkan'],
  ['doubled', 'doubling'], ['tripled', 'tripling'], ['quadrupled'], ['melipatgandakan'],
  ['million', 'millions', 'juta'], ['billion', 'billions', 'miliar'], ['thousand', 'thousands', 'ribu'],
];

const METRIC_ACTIONS = [
  ...OUTCOME_GROUPS,
  ['clean', 'cleaned', 'cleaning', 'remove', 'removed', 'removing', 'deduplicate', 'deduplicated', 'membersihkan', 'menghapus'],
  ['made', 'make', 'prepared', 'preparing', 'prepare', 'created', 'produced', 'wrote', 'built', 'developed', 'membuat', 'menyusun', 'menyiapkan', 'menulis', 'mengembangkan'],
  ['reviewed', 'reviewing', 'tested', 'checked', 'verified', 'memeriksa', 'menguji', 'meninjau'],
  ['trained', 'training', 'tutored', 'taught', 'melatih', 'membimbing', 'mengajari'],
  ['worked', 'spent', 'bekerja', 'menghabiskan'],
  ['processed', 'handled', 'mengolah', 'menangani', 'memproses'],
];

const METRIC_UNITS = [
  ['report', 'laporan'], ['row', 'baris'], ['record', 'rekaman'], ['outage', 'gangguan'],
  ['hour', 'jam'], ['minute', 'menit'], ['second', 'detik'], ['day', 'hari'], ['week', 'minggu'],
  ['month', 'bulan'], ['year', 'tahun'], ['team', 'tim'], ['user', 'pengguna'],
  ['customer', 'pelanggan'], ['student', 'siswa', 'mahasiswa'], ['child', 'children', 'anak'],
  ['accuracy', 'akurasi', 'ketepatan'], ['error', 'kesalahan'], ['time', 'waktu'],
  ['cost', 'biaya'], ['revenue', 'pendapatan'], ['sale', 'penjualan'],
  ['percent', 'persen'], ['idr', 'rp', 'rupiah'], ['usd', 'dollar', 'dolar'],
];

const METRIC_MODIFIERS = [
  ['duplicate', 'duplikat'], ['weekly', 'mingguan'], ['daily', 'harian'],
  ['sales', 'penjualan'], ['review', 'peninjauan'], ['processing', 'pemrosesan'],
];
const METRIC_LINK_WORDS = new Set([
  'and', 'or', 'for', 'with', 'in', 'from', 'at', 'by', 'per', 'using', 'during', 'over', 'across', 'to',
  'dan', 'atau', 'untuk', 'dengan', 'di', 'dari', 'ke', 'sebesar', 'menggunakan', 'selama', 'pada',
]);

function metricWord(word) {
  const stem = stemSkillToken(word);
  return METRIC_MODIFIERS.find((family) => family.includes(word))?.[0] ?? stem;
}

function metricUnit(word) {
  const stem = stemSkillToken(word);
  return METRIC_UNITS.find((family) => family.includes(stem))?.[0];
}

function metricFacts(text, isImproved) {
  const lower = text.toLowerCase().replace(/(\d)[ \t]+(?:percent|persen)\b/gu, '$1%');
  const dateSpans = [DATE_RANGE_YEAR_RE, DATE_PAREN_YEAR_RE, DATE_MONTH_FIRST_RE, DATE_DAY_MONTH_YEAR_RE,
    isImproved ? DATE_PREP_IMP_RE : DATE_PREP_ORIG_RE].flatMap((pattern) => [...lower.matchAll(pattern)]);
  const facts = [];
  for (const match of lower.matchAll(NUMERIC_TOKEN_RE)) {
    const token = match[0];
    const rawNumber = token.replace(/\s*%$/, '');
    const value = (/^[+−-]?\d{1,3}(?:[.,]\d{3})+$/.test(rawNumber)
      ? rawNumber.replace(/[.,]/g, '') : rawNumber.replace(',', '.')).replace('−', '-');
    if (dateSpans.some((date) => match.index >= date.index && match.index < date.index + date[0].length)) {
      facts.push({ value, unit: 'date', action: -1, modifiers: [] });
      continue;
    }

    const before = lower.slice(0, match.index).split(/[;\n]|[.!?]\s+|,\s+/).at(-1);
    const after = lower.slice(match.index + token.length).split(/[;\n]|[.!?]\s*|,\s+/)[0];
    const previousWords = (before.match(/\p{L}+/gu) ?? []).slice(-10);
    const nextWords = (after.match(/^\s*(?:\p{L}+[ -]?){1,4}/u)?.[0].match(/\p{L}+/gu) ?? []);
    const link = nextWords.findIndex((word) => METRIC_LINK_WORDS.has(word));
    const nounPhrase = nextWords.slice(0, link < 0 ? undefined : link);
    const unitIndex = nounPhrase.findIndex((word) => metricUnit(word) && !METRIC_MODIFIERS.some((family) => family.includes(word)));
    const unitWord = nextWords[unitIndex < 0 ? 0 : unitIndex];
    const knownUnit = metricUnit(unitWord);
    const currency = before.match(/(?:\b(?:rp|idr|usd)|[$€£])\s*$/u)?.[0].trim();
    const action = previousWords.map((word) => METRIC_ACTIONS.findIndex((family) => family.includes(word))).findLast((index) => index >= 0) ?? -1;
    const percent = token.endsWith('%') || knownUnit === 'percent';
    const subjects = percent
      ? [knownUnit, ...previousWords.slice(-5).reverse().map(metricUnit)]
        .filter((unit) => unit && unit !== 'percent') : [];
    facts.push({
      value,
      unit: percent ? `percent:${subjects[0] ?? ''}`
        : currency ? (currency === 'rp' ? 'idr' : currency === '$' ? 'usd' : currency)
        : knownUnit ?? stemSkillToken(unitWord ?? ''),
      action,
      modifiers: unitIndex < 0 ? [] : nounPhrase.filter((_, index) => index !== unitIndex).map(metricWord),
    });
  }
  return facts;
}

function introducesInventedNumbers(improved, original) {
  const claimed = metricFacts(improved, true);
  if (!claimed.length) return false;
  const available = metricFacts(original, false);
  return claimed.some((metric) => {
    const index = available.findIndex((source) => source.value === metric.value && source.unit === metric.unit
      && (metric.action === -1 || source.action === -1 || source.action === metric.action)
      && metric.modifiers.every((word) => source.modifiers.includes(word)));
    if (index < 0) return true;
    available.splice(index, 1);
    return false;
  });
}

const ORIG_SUPPORTING_CUES = new Set([
  'assisted', 'assisting', 'assist',
  'helped', 'helping', 'help',
  'supported', 'supporting', 'support',
  'membantu', 'mendukung',
  'contributed', 'contributing', 'collaborated', 'berkontribusi', 'berkolaborasi',
]);

const IMP_SUPPORTING_CUES = new Set([
  'assisted', 'assisting', 'assist',
  'helped', 'helping', 'help',
  'supported', 'supporting', 'support',
  'contributed', 'contributing', 'contribute',
  'collaborated', 'collaborating', 'collaborate',
  'membantu', 'mendukung', 'berkontribusi', 'berkolaborasi',
]);

const ROLE_INVERSION_TITLES = new Set([
  'senior', 'principal', 'manager', 'managers', 'lead', 'leads', 'leader', 'leaders',
  'director', 'directors', 'supervisor', 'supervisors', 'manajer', 'direktur', 'kepala',
  'ketua', 'vp', 'chief', 'cto', 'ceo', 'cfo', 'head', 'heads', 'architect', 'arsitek',
]);

const LEADING_SENIOR_TITLE_RE =
  /^(?:(?:acted|worked|served)\s+as\s+|sebagai\s+)?(?:a\s+|an\s+|the\s+)?(?:senior|principal|lead|chief|cto|ceo|cfo|vp|director|direktur|head|kepala|manager|manajer|supervisor|architect|arsitek|ketua)\b/i;

function extractWordTokens(text) {
  return new Set(String(text || '').toLowerCase().match(/\p{L}+/gu) || []);
}

function affirmativeClaimWords(text) {
  return extractWordTokens(text.split(/[;\n]|(?<=[.!?])\s+|\b(?:but|however|namun|tetapi)\b/iu)
    .map((clause) => clause.replace(/\b(?:did not|didn't|never|without|no|tidak|belum|tanpa|bukan)\b.*$/iu, ' '))
    .join(' '));
}

function hasUngroundedGroupClaim(origWordSet, impWordSet, groups) {
  for (const group of groups) {
    let inImp = false;
    for (const w of group) {
      if (impWordSet.has(w)) {
        inImp = true;
        break;
      }
    }
    if (!inImp) continue;
    let inOrig = false;
    for (const w of group) {
      if (origWordSet.has(w)) {
        inOrig = true;
        break;
      }
    }
    if (!inOrig) return true;
  }
  return false;
}

function hasRoleInversion(original, improved, origWordSet, impWordSet) {
  let origHasSupport = false;
  for (const cue of ORIG_SUPPORTING_CUES) {
    if (origWordSet.has(cue)) {
      origHasSupport = true;
      break;
    }
  }
  let origHasTitle = false;
  let impHasTitle = false;
  for (const title of ROLE_INVERSION_TITLES) {
    if (origWordSet.has(title)) origHasTitle = true;
    if (impWordSet.has(title)) impHasTitle = true;
  }

  if (origHasSupport && origHasTitle && impHasTitle) {
    let impHasSupport = false;
    for (const cue of IMP_SUPPORTING_CUES) {
      if (impWordSet.has(cue)) {
        impHasSupport = true;
        break;
      }
    }
    if (!impHasSupport) return true;
    if (LEADING_SENIOR_TITLE_RE.test(improved) && !LEADING_SENIOR_TITLE_RE.test(original)) {
      return true;
    }
  }
  return false;
}

const BILINGUAL_ANCHOR_FAMILIES = [
  ['clean', 'cleaned', 'cleaning', 'cleanup', 'remove', 'removed', 'removing', 'deduplicate', 'deduplicated', 'deduplicating', 'deduplication', 'duplicate', 'duplicates', 'normalize', 'normalized', 'membersihkan', 'menghapus', 'merapikan', 'duplikat'],
  ['analyze', 'analyzed', 'analysed', 'analyzing', 'analysis', 'analytical', 'query', 'queried', 'queries', 'check', 'checked', 'verify', 'verified', 'validate', 'validated', 'reconcile', 'reconciled', 'audit', 'audited', 'test', 'tested', 'testing', 'menganalisis', 'menganalisa', 'analisis', 'analisa', 'memeriksa', 'memverifikasi', 'mengevaluasi', 'menguji', 'rekonsiliasi', 'validasi'],
  ['document', 'documented', 'documenting', 'documentation', 'instruction', 'instructions', 'guide', 'guided', 'guiding', 'guideline', 'guidelines', 'manual', 'step', 'steps', 'note', 'notes', 'handoff', 'onboarding', 'checklist', 'checklists', 'mendokumentasikan', 'dokumentasi', 'petunjuk', 'panduan', 'langkah', 'catatan', 'membimbing'],
  ['report', 'reports', 'reporting', 'summary', 'summaries', 'summarize', 'summarized', 'dashboard', 'dashboards', 'chart', 'charts', 'visualize', 'visualized', 'visualization', 'laporan', 'pelaporan', 'ringkasan', 'merangkum', 'visualisasi', 'grafik', 'dasbor'],
  ['data', 'dataset', 'datasets', 'row', 'rows', 'record', 'records', 'table', 'tables', 'spreadsheet', 'spreadsheets', 'workbook', 'workbooks', 'sheet', 'sheets', 'file', 'files', 'csv', 'database', 'databases', 'schema', 'schemas', 'baris', 'tabel', 'berkas', 'lembar'],
  ['schedule', 'scheduled', 'schedules', 'scheduling', 'organize', 'organized', 'organizing', 'coordinate', 'coordinated', 'coordinating', 'maintain', 'maintained', 'maintaining', 'track', 'tracked', 'tracking', 'monitor', 'monitored', 'automate', 'automated', 'automation', 'menjadwalkan', 'jadwal', 'mengatur', 'mengkoordinasikan', 'mengoordinasikan', 'memelihara', 'memantau', 'mengotomatisasi', 'otomatisasi'],
  ['interface', 'interfaces', 'ui', 'ux', 'component', 'components', 'responsive', 'frontend', 'screen', 'screens', 'form', 'forms', 'script', 'scripts', 'app', 'application', 'antarmuka', 'komponen', 'responsif', 'skrip', 'aplikasi', 'formulir'],
  ['user', 'users', 'customer', 'customers', 'client', 'clients', 'member', 'members', 'student', 'students', 'committee', 'club', 'meeting', 'meetings', 'event', 'events', 'pengguna', 'pelanggan', 'anggota', 'mahasiswa', 'panitia', 'kepanitiaan', 'organisasi', 'rapat', 'acara', 'kegiatan'],
  ['tutor', 'tutored', 'taught', 'teach', 'learn', 'study', 'membimbing', 'mengajar', 'mengajari', 'belajar'],
  ['read', 'reading', 'membaca', 'literacy', 'literasi'],
  ['arithmetic', 'math', 'counting', 'berhitung', 'matematika'],
  ['child', 'children', 'kid', 'kids', 'anak'],
];

function stemAnchorWord(word) {
  let w = stemSkillToken(word);
  if (w.length >= 6 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length >= 5 && w.endsWith('ed')) w = w.slice(0, -2);
  return w;
}

function hasSemanticAnchor(original, improved, origSkills, impSkills, origWordSet, impWordSet) {
  for (const skill of impSkills) {
    if (origSkills.has(skill)) return true;
  }

  const origContent = extractContentWords(original).map(stemAnchorWord);
  const impContentSet = new Set(extractContentWords(improved).map(stemAnchorWord));
  for (const w of origContent) {
    if (w && impContentSet.has(w)) return true;
  }

  for (const family of BILINGUAL_ANCHOR_FAMILIES) {
    let origHas = false;
    let impHas = false;
    for (const term of family) {
      if (origWordSet.has(term)) origHas = true;
      if (impWordSet.has(term)) impHas = true;
      if (origHas && impHas) return true;
    }
  }

  return false;
}

function groundedRewrite(original, improved) {
  if (misusesDateAsMetric(original, improved)) return false;

  const origSkills = extractTechSkills(original);
  const impSkills = extractTechSkills(improved);
  for (const skill of impSkills) {
    if (!origSkills.has(skill)) return false;
  }

  const origWords = extractWordTokens(original);
  const impWords = extractWordTokens(improved);

  const supportedClaims = affirmativeClaimWords(original);
  const improvedClaims = affirmativeClaimWords(improved);
  if (hasUngroundedGroupClaim(supportedClaims, improvedClaims, CREDENTIAL_GROUPS)) return false;
  if (hasUngroundedGroupClaim(supportedClaims, improvedClaims, SENIORITY_AND_TITLE_GROUPS)) return false;
  if (hasUngroundedGroupClaim(supportedClaims, improvedClaims, LEADERSHIP_VERB_GROUPS)) return false;
  if (hasUngroundedGroupClaim(supportedClaims, improvedClaims, OUTCOME_GROUPS)) return false;
  if ([...origWords].slice(0, 4).some((word) => ORIG_SUPPORTING_CUES.has(word))
      && ![...IMP_SUPPORTING_CUES].some((cue) => impWords.has(cue))) return false;
  if (hasRoleInversion(original, improved, origWords, impWords)) return false;

  if (!hasSemanticAnchor(original, improved, origSkills, impSkills, origWords, impWords)) {
    return false;
  }

  return true;
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

  // 2. matchedKeywords & missingKeywords: bounded arrays of non-blank strings, deduplicated, disjoint by normalizeKeyword.
  if (!Array.isArray(matchedKeywords) || !Array.isArray(missingKeywords)) {
    return { ok: false, reason: 'matchedKeywords and missingKeywords must be arrays.' };
  }
  if (
    matchedKeywords.length > MAX_KEYWORDS_PER_GROUP ||
    missingKeywords.length > MAX_KEYWORDS_PER_GROUP
  ) {
    return {
      ok: false,
      reason: `Keyword groups cannot exceed ${MAX_KEYWORDS_PER_GROUP} items.`,
    };
  }
  if (!Array.isArray(rewrites)) {
    return { ok: false, reason: 'rewrites must be an array.' };
  }
  if (rewrites.length > 5) {
    return { ok: false, reason: 'rewrites cannot exceed 5 items.' };
  }
  for (const item of rewrites) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'Each rewrite must be an object.' };
    }
    if (['original', 'improved', 'reason'].some((key) =>
      typeof item[key] !== 'string' || item[key].length > MAX_REWRITE_FIELD_CHARS + 64)) {
      return { ok: false, reason: `Each rewrite requires non-blank original, improved, and reason strings up to ${MAX_REWRITE_FIELD_CHARS} characters.` };
    }
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
    if (typeof item !== 'string' || item.length > MAX_KEYWORD_CHARS + 32) {
      return {
        ok: false,
        reason: `matchedKeywords must contain non-blank strings up to ${MAX_KEYWORD_CHARS} characters.`,
      };
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_KEYWORD_CHARS) {
      return {
        ok: false,
        reason: `matchedKeywords must contain non-blank strings up to ${MAX_KEYWORD_CHARS} characters.`,
      };
    }
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
    if (typeof item !== 'string' || item.length > MAX_KEYWORD_CHARS + 32) {
      return {
        ok: false,
        reason: `missingKeywords must contain non-blank strings up to ${MAX_KEYWORD_CHARS} characters.`,
      };
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_KEYWORD_CHARS) {
      return {
        ok: false,
        reason: `missingKeywords must contain non-blank strings up to ${MAX_KEYWORD_CHARS} characters.`,
      };
    }
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

  const hasJdGrounding = typeof options.sanitizedJd === 'string' && Boolean(options.sanitizedJd.trim());
  if (hasJdGrounding) {
    if (
      (atsScore > 40 && cleanMatched.length === 0) ||
      (atsScore === 100 && (cleanMissing.length > 0 || omitsKnownRequiredSkill(options.sanitizedJd, matchedSet))) ||
      (cleanMissing.length >= 3 && cleanMatched.length <= 1 && atsScore >= 90)
    ) {
      return { ok: false, reason: 'Score contradicts reported skill coverage.' };
    }

    // Pre-tokenize CV and JD ONCE after bounds & deduplication checks.
    const pretokenizedCv = tokenizeText(positiveCvEvidence(sanitizedCvText));
    const pretokenizedJd = tokenizeText(options.sanitizedJd);

    for (const kw of cleanMatched) {
      if (!containsSkill(pretokenizedCv, kw) || !containsSkill(pretokenizedJd, kw)) {
        return { ok: false, reason: 'Matched keyword lacks CV or vacancy evidence.' };
      }
    }

    for (const kw of cleanMissing) {
      if (!containsSkill(pretokenizedJd, kw) || containsSkill(pretokenizedCv, kw)) {
        return { ok: false, reason: 'Missing keyword lacks vacancy evidence or is already evidenced in CV.' };
      }
    }
  }

  // 3. rewrites count & sparse-CV rule.
  const bulletSources = candidateBulletSources(sanitizedCvText);
  const candidateBullets = bulletSources.size;
  const sparseAllowed = Boolean(options?.allowSparse) || candidateBullets < 3;
  const minRewrites = sparseAllowed ? 0 : 3;
  if (rewrites.length > candidateBullets) {
    return { ok: false, reason: 'Rewrites cannot exceed the number of distinct source bullets.' };
  }
  if (rewrites.length < minRewrites) {
    return {
      ok: false,
      reason: `Expected 3 to 5 rewrites for CV with ${candidateBullets} bullets, received ${rewrites.length}.`,
    };
  }

  // 4. Validate each rewrite item for bounded non-blank strings, uniqueness, source traceability, and anti-hallucination invariants.
  const cleanRewrites = [];
  const seenOriginals = new Set();
  for (const item of rewrites) {
    const { original, improved, reason } = item;

    const trimmedOrig = original.trim();
    const trimmedImp = improved.trim();
    const trimmedReason = reason.trim();

    if (
      !trimmedOrig ||
      !trimmedImp ||
      !trimmedReason ||
      trimmedOrig.length > MAX_REWRITE_FIELD_CHARS ||
      trimmedImp.length > MAX_REWRITE_FIELD_CHARS ||
      trimmedReason.length > MAX_REWRITE_FIELD_CHARS
    ) {
      return {
        ok: false,
        reason: `Each rewrite requires non-blank original, improved, and reason strings up to ${MAX_REWRITE_FIELD_CHARS} characters.`,
      };
    }

    if (HEADER_ONLY_LINE_RE.test(trimmedOrig)) {
      return { ok: false, reason: 'Section headers cannot be used as rewrite originals.' };
    }

    const normOrigKey = candidateBulletKey(trimmedOrig);
    if (seenOriginals.has(normOrigKey)) {
      return { ok: false, reason: 'Duplicate rewrite originals are not allowed.' };
    }
    seenOriginals.add(normOrigKey);

    if (!bulletSources.has(normOrigKey)) {
      return { ok: false, reason: 'Rewrite original does not trace to sanitizedCvText.' };
    }

    if (introducesInventedNumbers(trimmedImp, trimmedOrig) || !groundedRewrite(trimmedOrig, trimmedImp)) {
      return { ok: false, reason: 'Rewrite contains claims without supporting source evidence.' };
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
      const retryTime = typeof meta?.resetAt === 'string' && Number.isFinite(Date.parse(meta.resetAt))
        ? (isEn ? `Try again after ${resetLabel}.` : `Coba lagi setelah ${resetLabel}.`)
        : (isEn ? 'Try again later.' : 'Coba lagi nanti.');
      if (meta?.action === 'aiBudget') {
        return isEn
          ? `AI processing is at capacity. ${retryTime}`
          : `Kapasitas pemrosesan AI penuh. ${retryTime}`;
      }
      if (meta?.action === 'cvAdmission') {
        return isEn
          ? `CV processing limit reached. ${retryTime}`
          : `Batas pemrosesan CV tercapai. ${retryTime}`;
      }
      if (meta?.action === 'cvIntake') {
        return isEn
          ? `Too many CV requests in a short time. ${retryTime}`
          : `Terlalu banyak permintaan CV dalam waktu singkat. ${retryTime}`;
      }
      if (meta?.action === 'interviewGeneration') {
        return isEn
          ? `Interview processing limit reached. ${retryTime}`
          : `Batas pemrosesan wawancara tercapai. ${retryTime}`;
      }
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
