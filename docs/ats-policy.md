# LatihKerja — ATS Scoring, Alias, Privacy & Architectural Decisions Policy

**Document scope:** Days 1–5 CV Analysis implementation (`lib/` and `app/api/`)  
**ATS policy version:** `2026-11-v1` (`ATS_POLICY_VERSION` in `lib/ats.js`)  
**Source requirements:** `guideline.md` (§§3, 4, 5, 8, 11, 12) and `CHECKLIST.md` (Days 1–5)

---

## 1. ATS Coaching Score Policy (`2026-11-v1`)

### 1.1 Purpose and Disclaimer
LatihKerja's `atsScore` is an **automated coaching estimate of alignment between the submitted CV and the pasted job description** (`guideline.md` §1, `lib/contracts.js`, `lib/ats.js`).

- It estimates text and evidence overlap for candidate self-review in Bahasa Indonesia (`id`) or English (`en`).
- It is **not** an employer-specific applicant tracking system (ATS) algorithm and **not** a guarantee of passing any employer screening process (`guideline.md` §1; `buildCvReportText` disclaimer in `lib/contracts.js`).
- User-supplied CV text (`<cv_data>`) and job description text (`<job_description_data>`) are framed in `buildAtsPrompt` (`lib/ats.js`) as untrusted passive data; embedded instructions, score overrides, or role-change directives inside either input are explicitly ignored.

### 1.2 Score Weighting and Strict Numeric Range
- **Prompt scoring guidance (`buildAtsPrompt` in `lib/ats.js`):**
  - **~60%** — Required technical/domain skills and tools evidenced in the CV.
  - **~25%** — Relevant project, internship, or work actions.
  - **~15%** — Clarity and scope of presentation.
- **Strict integer `0..100` enforcement:**
  - `GEMINI_ATS_SCHEMA` requires `atsScore` as `INTEGER`, and `buildAtsPrompt` forbids floats.
  - `validateAnalysisPayload` (`lib/contracts.js`) rejects any non-number, `NaN`, float, or value outside `0 <= atsScore <= 100`.
- **Never fabricate `0` on failure:**
  - If PDF extraction fails (`422 PDF_UNREADABLE`), inputs are invalid (`400 INVALID_INPUT`), quotas are exhausted (`429 QUOTA_REACHED`), or Gemini/Redis fails, times out, returns malformed JSON, or fails validation (`503 TEMPORARILY_UNAVAILABLE`), `/api/analyze-cv` returns the error JSON payload without creating a session and never substitutes a fallback `0` score (`lib/ats.js`, `app/api/analyze-cv/route.js`).

### 1.3 Evidence & Rewrite Rules
For every analysis, `GEMINI_ATS_SCHEMA` requires `rewrites` as an array of `{ original, improved, reason }` objects, validated strictly by `validateAnalysisPayload` (`lib/contracts.js`):

1. **Quantity for standard CVs:**
   - When `countCandidateBullets(sanitizedCvText) >= 3`, `buildAtsPrompt` requests **3 to 5** distinct experience, internship, organization, coursework, or project bullets.
   - `validateAnalysisPayload` enforces `3 <= rewrites.length <= 5` (unless `options.allowSparse` is explicitly passed) and caps `rewrites.length` at `5`.
2. **Non-blank, distinct, non-header originals:**
   - `original`, `improved`, and `reason` must all be non-blank strings.
   - Section headers (e.g., `Experience`, `Pengalaman Kerja`, `Education`, `Pendidikan`, `Skills`, `Keahlian`, `Projects`, `Summary`, `Profil`) are rejected as `original` (`HEADER_ONLY_LINE_RE`).
   - Duplicate `original` strings (after trace normalization) are rejected.
3. **Verbatim traceable `original`:**
   - `buildAtsPrompt` requests an exact quote in the source language. Validation requires one full eligible source bullet or action sentence. It ignores case, bullet markers, whitespace, and terminal sentence punctuation. Reordering, concatenating passages, and importing facts from elsewhere in the CV fail validation.
4. **Metric and claim grounding in `improved`:**
   - Each recognized numeric mention must map to a distinct mention in the quoted bullet with the same value, unit, and supported nearby action and scope. Recognized decimal and grouping formats allow equivalents such as `99,5%` and `99.5%` or `10,000` and `10000`. Dates remain dates. Counts of reports cannot become counts of outages, and hours worked cannot become hours saved.
   - The validator checks supported tools, role and contribution cues, and recognizable qualifications and outcomes in ID and EN. It looks for source anchors in a paraphrase and permits new phrasing beyond the recognized claim groups. These lexical and contextual checks catch specific classes of mistakes. They cannot prove semantic equivalence, infer every measurement or implicit outcome, determine all vacancy requirements, or disambiguate every translation. An honest rewrite without a recognized anchor can still fail. Candidate review and fictional live calibration remain necessary. Validation adds no model call.
5. **Asking for missing evidence in `reason`:**
   - `improved` and `reason` are written in the selected language (`id` or `en`), preserving technical proper nouns in standard form.
   - When quantitative scope or outcomes are missing from the source bullet, `reason` explains the improvement and asks the candidate for that specific detail instead of inventing it.
   - Redaction placeholders (`[EMAIL_REDACTED]`, `[PHONE_REDACTED]`, `[IDENTITY_REDACTED]`, `[ADDRESS_REDACTED]`) are forbidden in keywords and rewrites.

### 1.4 Sparse-CV Exception (0, 1, or 2 Distinct Bullets)
To prevent hallucinated work experience on thin student/fresh-graduate CVs (`guideline.md` §4):

- **Bullet counting (`countCandidateBullets` in `lib/contracts.js`):**
  - Splits `sanitizedCvText` by lines and tab-separated cells (`\t+`), strips redaction placeholders and bullet/numbering prefixes (`-`, `*`, `•`, `1.`, `1)`), ignores header-only lines and skill/contact lines, and requires at least 4 words.
  - Non-bulleted lines are split on sentence boundaries and must contain an ID/EN action verb (`ACTION_VERB_RE`); education metadata and role date headers without action verbs are excluded (as are short `< 6`-word education metadata bullets lacking an action verb). Remaining candidates are deduplicated case-insensitively.
- **Exception behavior when `candidateBulletCount < 3`:**
  - **0 bullets:** `buildAtsPrompt` requires `rewrites: []` and forbids converting section headers, degrees, university names, or skill lists into fabricated bullets.
  - **1 or 2 bullets:** `buildAtsPrompt` limits `rewrites` to at most `candidateBulletCount`, corresponding solely to genuine bullets in `<cv_data>`.
  - `validateAnalysisPayload` lowers `minRewrites` from `3` to `0` and caps rewrites at the number of distinct eligible bullets. It validates each rewrite, preserves valid score and keyword groups, and returns `{ candidateBullets, isSparse: cleanRewrites.length < 3 }`.
  - `buildCvReportText` (`lib/contracts.js`) preserves the score and keyword sections and outputs an explicit localized shortfall note (either explaining why `< 3` rewrites are shown, or prompting the candidate to add coursework, internship, organization, or project bullets when `rewrites.length === 0`).

### 1.5 Empty Keyword Group Handling
- `matchedKeywords` and `missingKeywords` may validly be empty arrays (`[]`) when no vacancy keywords are evidenced or when all vacancy keywords are evidenced (`FIXTURES.emptyMatched`, `FIXTURES.emptyMissing` in `lib/contracts.js`).
- `buildCvReportText` renders explicit bilingual messages for empty groups rather than leaving blank sections:
  - Empty `matchedKeywords`: `"No advertised skills evidenced yet in this CV."` (`en`) / `"Belum ada kata kunci lowongan yang terlihat pada CV ini."` (`id`).
  - Empty `missingKeywords`: `"All key requirements in this vacancy are evidenced."` (`en`) / `"Semua kebutuhan utama pada lowongan ini sudah terlihat."` (`id`).

---

## 2. Canonical Alias & Disjointness Policy

### 2.1 Normalization Rules (`normalizeKeyword` in `lib/contracts.js`)
Before deduplication or cross-list comparison, every keyword string is normalized by `normalizeKeyword(term)`:
1. Non-strings return `''`.
2. Converts to lowercase.
3. Strips leading whitespace/quotes/brackets/bullet punctuation (`^[\s"'`([{•·*-]+`) and trailing whitespace/quotes/brackets/punctuation (`[\s"'`)\]},;:!?]+$`).
4. Collapses internal whitespace runs to a single space and trims.
5. Maps the cleaned string through `ALIAS_LOOKUP`; if present in `ALIAS_GROUPS`, returns the canonical group key; otherwise returns the cleaned lowercase string.

### 2.2 Canonical Alias Groups (`ALIAS_GROUPS` in `lib/contracts.js`)
The validator currently enforces **29 canonical alias groups** (and `buildAtsPrompt` passes the first 12 entries as inline prompt examples):

| Canonical Key | Recognized Variants |
| --- | --- |
| `javascript` | `javascript`, `js`, `ecmascript`, `es6` |
| `typescript` | `typescript`, `ts` |
| `nodejs` | `node.js`, `nodejs`, `node js` |
| `react` | `react`, `reactjs`, `react.js` |
| `nextjs` | `next.js`, `nextjs`, `next js` |
| `vuejs` | `vue`, `vue.js`, `vuejs` |
| `python` | `python`, `python 3`, `python3`, `py` |
| `sql` | `sql`, `structured query language` |
| `postgresql` | `postgresql`, `postgres`, `psql` |
| `mysql` | `mysql`, `my sql` |
| `excel` | `excel`, `microsoft excel`, `ms excel`, `ms. excel`, `spreadsheet excel` |
| `google sheets` | `google sheets`, `gsheets`, `google spreadsheet`, `google spreadsheets` |
| `power bi` | `power bi`, `powerbi`, `microsoft power bi`, `ms power bi` |
| `tableau` | `tableau`, `tableau desktop` |
| `powerpoint` | `powerpoint`, `microsoft powerpoint`, `ms powerpoint`, `ppt` |
| `word` | `microsoft word`, `ms word`, `ms. word` |
| `golang` | `golang`, `go language` |
| `csharp` | `c#`, `csharp`, `c sharp` |
| `cplusplus` | `c++`, `cpp`, `c plus plus` |
| `rest api` | `rest api`, `restful api`, `rest apis`, `restful apis` |
| `ci/cd` | `ci/cd`, `cicd`, `ci cd` |
| `git` | `git`, `git version control` |
| `github` | `github`, `git hub` |
| `machine learning` | `machine learning`, `ml`, `pembelajaran mesin` |
| `data analysis` | `data analysis`, `data analytics`, `analisis data`, `analisa data` |
| `project management` | `project management`, `manajemen proyek` |
| `communication` | `communication`, `communication skills`, `komunikasi`, `kemampuan komunikasi` |
| `teamwork` | `teamwork`, `team work`, `kerja tim`, `kerja sama tim`, `kerjasama tim` |
| `problem solving` | `problem solving`, `problem-solving`, `pemecahan masalah` |

### 2.3 Strict Disjointness Invariant
In `validateAnalysisPayload` (`lib/contracts.js`):
- Both `matchedKeywords` and `missingKeywords` must contain only non-blank strings that produce non-empty normalized keys.
- Within each array, terms mapping to the same `normalizeKeyword()` key are deduplicated (retaining the first trimmed surface form).
- **Strict disjointness:** If any term in `missingKeywords` shares a `normalizeKeyword()` key with any term already in `matchedKeywords` (for example, `"JS"` in `matchedKeywords` and `"JavaScript"` in `missingKeywords`, or `"MS Excel"` vs. `"Excel"`), validation fails and the response is rejected with `503 TEMPORARILY_UNAVAILABLE`.

---

## 3. Privacy, PII Redaction, and Session/Quota Controls (§8)

### 3.1 Memory-Only PDF Parsing (`lib/pdf.js`, `app/api/analyze-cv/route.js`)
- Runs strictly in Node.js (`export const runtime = 'nodejs'`) using `pdf-parse` `2.4.5` (`PDFParse`).
- Checks byte count `<= MAX_PDF_BYTES` (`5,000,000` bytes; `413 FILE_TOO_LARGE` if exceeded) and `%PDF-` magic header (`0x25 0x50 0x44 0x46 0x2d`) within the first 1,024 bytes (`422 PDF_UNREADABLE` if missing or empty).
- Copies incoming bytes into an isolated `Uint8Array`, clears input byte references immediately (`bytes = null`), extracts per-page text (`parseHyperlinks: false, pageJoiner: '', first: 30` page ceiling), and rejects image-only/blank/corrupt/password-protected PDFs (0 non-whitespace characters or parser error) with `422 PDF_UNREADABLE` before reserving quota, calling Gemini, or creating a session.
- In `finally`, sets byte references to `null` and calls `await parser.destroy()` on both success and failure.
- Raw PDF bytes and raw extracted text are **never** written to disk, `/tmp`, `public/`, logs, or Redis. In `handleAnalyzeCv` (`app/api/analyze-cv/route.js`), `rawBody`, `fileBytes`, `rawCvText`, and `rawJobDescription` are explicitly dereferenced (`null`) immediately after parsing/redaction.

### 3.2 PII Redaction Scope and Placeholders (`lib/redact.js`)
`lib/redact.js` is client-safe pure JS (zero Node-only imports) exporting `REDACTION_PLACEHOLDERS`, `redactPii(text)`, and `redactAnalysisOutput(analysis)`. It uses the exact four §8 placeholders:

| Category | Placeholder | Implemented Detection Scope (`redactPii`) | Preserved Non-PII Examples |
| --- | --- | --- | --- |
| Email | `[EMAIL_REDACTED]` | Fast-path `@` guarded, length-bounded, left-anchored regex covering standard emails, plus-tags, subdomains, and `mailto:` links (`EMAIL_RE`). | Technical terms, domain keywords. |
| Identity | `[IDENTITY_REDACTED]` | Executed **before** phone masking: 16-digit NIKs (contiguous, `6-6-4` administrative, or `4×4` grouped), labeled national/government IDs (`NIK`, `KTP`, `No. KTP`, `Nomor KTP`, `Nomor Induk Kependudukan`, `National ID`, `ID No./Number`), and labeled birthplaces/birthdates (`Tanggal Lahir`, `Tgl. Lahir`, `TTL`, `Tempat, Tanggal Lahir`, `Birthdate`, `Date of Birth`, `DOB`, `Born ...` in ID/EN formats). | `Graduated 2024`, `Lulus 2024`, `Class of 2024`, `Jan 2023 - Dec 2024`, `Mei 2023 - Sekarang`. |
| Home Address | `[ADDRESS_REDACTED]` | Labeled ID/EN addresses (line-start, tab-delimited, or inline comma/semicolon-separated `Alamat`, `Alamat Rumah`, `Alamat Domisili`, `Alamat Lengkap`, `Domisili`, `Home Address`, `Street Address`, `Residential Address`, `Current Address`, `Mailing Address`, `Address`, `Residence`; excluding `email/web/ip/mac/url/memory address`), multi-line continuations stopping before blank lines, section headers, other contact labels, bullets, or job/education lines; plus unlabeled Indonesian street phrases (`Jl.`/`Jln.`/`Jalan` with house number, `RT`/`RW`, `Blok`, `Kav.`, `Kode Pos`, or 5-digit postal code, both end-of-line and mid-sentence). | Nearby job titles (`Data Analyst Intern`), skills, and adjacent tab/pipe/bullet-delimited columns. |
| Phone | `[PHONE_REDACTED]` | Labeled phones (`HP`, `WA`, `WhatsApp`, `Telp`, `Telepon`, `Phone`, `Mobile`, `Handphone`, `Tel`, `No. HP`, etc., 7–15 digits), international numbers (`+62`, `+1`, etc., 8–15 digits), Indonesian mobile (`08...`, including 2–5 digit hyphen/space groups, 9–14 digits), Indonesian landline (`(021)...`, `021-...`, 8–13 digits), and 10-digit NANP phone formats. | Date ranges (`2020 - 2024`, `2021–2024`), graduation years (`2024`), GPAs (`3.85/4.00`), metrics (`10,000 rows`, `99.5%`). |

**Where redaction is applied:**
- **Submitted CV text & pasted job description:** Redacted immediately in `handleAnalyzeCv` (`app/api/analyze-cv/route.js`) before quota checks, again inside `analyzeCv` (`lib/ats.js`) before prompt construction/external Gemini calls, and inside `sanitizeSessionData` (`lib/store.js`) before storage.
- **Model output free-text fields:** `redactAnalysisOutput` masks `matchedKeywords`, `missingKeywords`, and every `original`, `improved`, and `reason` in `rewrites` inside `analyzeCv` (`lib/ats.js`), `sanitizeSessionData` (`lib/store.js`), and `buildCvReportText` (`lib/contracts.js`) prior to validation, storage, display, and UTF-8 text export.
- **Interview answers:** The answer handler masks each submission before provider scoring and session storage. The report builder masks transcript text at export. The example question preview makes no interview request. Unsubmitted drafts stay in page memory and can contain raw personal details.

### 3.3 Honest Limitations & External Provider Retention Caveat
- **Residual identifiers:** Regex masking covers the four identifier classes listed above. **Personal names, unusual or non-standard address formats, and other identifying free-text details (such as employer/school names or project links) may remain** after redaction (`guideline.md` §8). User-facing privacy notices must describe the four masked categories accurately and disclose that residual identifiers may survive.
- **External AI provider retention caveat:** Redaction removes the four identifier patterns before requests leave the server, and LatihKerja retains sanitized session context only for 90 minutes. However, any public promise regarding external AI retention or zero-retention guarantees must be verified directly against the **active Gemini API tier and project logging/retention configuration** prior to launch (`guideline.md` §§8, 12).

### 3.4 Temporary Session Lifetime & Safe Logging
- **Fixed 90-minute session lifetime (`SESSION_TTL_SECONDS = 5400`, `lib/contracts.js`, `lib/store.js`):**
  - Created only after `analyzeCv` succeeds and passes `validateAnalysisPayload`, returning an opaque `sess_...` identifier (`18` random bytes encoded as base64url).
  - Stores only `{ sessionId, version, createdAt, expiresAt, language, sanitizedCvText, sanitizedJd, analysis, interview }`.
  - **Expiry preservation & no resurrection:** `createMemoryStore.updateSession` keeps the original `expiresAtMs` unchanged and returns `SESSION_EXPIRED` (`410`) once expired. `createUpstashStore.updateSession` runs `CAS_SESSION_LUA`, checking `PTTL > 0` (`ERR SESSION_EXPIRED` if missing/expired), verifying `doc.version` (`ERR QUESTION_CONFLICT` `409` on mismatch), and writing `SET ... PX pttl` so updates preserve the exact remaining TTL and a late update never recreates an expired session.
- **Allowlisted structured logging (`lib/logger.js`):**
  - `logRouteEvent` emits single-line JSON containing only `ts`, `route` (`/api/...`), `status`, `code` (`OK` or valid `ERROR_CODES`), `elapsedMs`, and strictly allowlisted `meta`:
    - Numeric: `pages`, `bytes`, `atsScore`, `matchedCount`, `missingCount`, `rewriteCount`, `quotaRemaining`, `totalFeedback`, `positiveFeedback`, `attemptCount`.
    - Boolean: `cached`, `sparse`, `positive`.
    - Enums: `transport`, `language`, `mode`, `action`, `field`, `storeBackend`.
  - CV text, job descriptions, interview answers, request bodies, HTTP headers, raw client IPs, API keys, Redis tokens, and raw `sessionId` values can never pass the allowlist.

### 3.5 Independent Daily IP Quotas & Storage Architecture (`lib/store.js`)
- **Independent caps (`DAILY_LIMITS` in `lib/contracts.js`):** `analyze: 5` and `interviewStart: 3` per IP per calendar day in `Asia/Jakarta` (`UTC+7`, resetting at Jakarta `00:00:00` via `getJakartaDayWindow`). Expiring a 90-minute session does **not** replenish either daily quota.
- **HMAC-SHA256 IP digest (`deriveIpHash` in `lib/store.js`):**
  - Production requires a valid single address from the trusted Vercel `x-vercel-forwarded-for` header and a `QUOTA_HMAC_SECRET` of at least 32 characters. Development uses loopback and a local fallback. New interview replay uses a domain-separated HMAC with session and question scope and the same configured secret. The memory-only development fallback uses a process-local random key.
- **Atomic reservation, release-on-failure, and 15-minute idempotency:**
  - All request inputs and PDF parseability are validated **before** `reserveQuota` runs (`app/api/analyze-cv/route.js`), so `400`, `413`, `415`, and `422` errors consume zero quota.
  - `reserveQuota` checks `idem:${action}:${ipHash}:${effectiveRequestId}` first, where `handleAnalyzeCv` derives `effectiveRequestId` via `SHA-256(requestId + "\0" + language + "\0" + sanitizedCvText + "\0" + sanitizedJd)` (for optional `requestId` / `x-request-id` matching `/^[A-Za-z0-9._:-]{1,128}$/`). Payload binding ensures retries of the identical request replay cleanly while preventing shared-NAT collisions across different CVs.
  - The store checks committed successes plus live holds against the limit and takes an owned two-minute reservation. The CV route separately acquires a bounded pre-parser lease.
  - `commitQuota` publishes the session, increments committed successes and caches the canonical response atomically. The response and a logical retry marker expire after **15 minutes**. The marker is scoped to a network identity, request ID, analysis language and vacancy. After daily success or shared-budget exhaustion, it admits bounded replay-only parsing. The canonical content must still match a committed response. A cache miss keeps the existing limit, and neither path can dispatch generation.
  - Failure releases the temporary hold. The success count remains unchanged, and separate admission controls can charge for parse or generation attempts.
- **Upstash Redis REST (fail-closed) + local in-memory fallback (`createStore` / `getStore`):**
  - When `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is configured, `createUpstashStore` executes atomic Lua scripts (`RESERVE_QUOTA_LUA`, `COMMIT_QUOTA_LUA`, `RELEASE_QUOTA_LUA`, `CAS_SESSION_LUA`, `RECORD_FEEDBACK_LUA`) over Upstash REST `fetch` (`5,000 ms` timeout). Any missing partial credential, network/timeout failure, non-OK HTTP status, or Redis error **fails closed with `503 TEMPORARILY_UNAVAILABLE`** — quotas are never bypassed.
  - Production also requires the HTTPS Upstash endpoint, token and trusted Vercel runtime. `createMemoryStore` covers local development and tests with an injectable clock.
- **Aggregate feedback store (`app/api/feedback/route.js`):**
  - `POST /api/feedback` validates `{ sessionId, positive, language }` (max 4,096 JSON bytes). The first vote from a live CV session updates the aggregate totals and language breakdown in `stats:feedback`. A temporary marker expires with the session. A separate 60-second counter, keyed by the same IP digest used for analysis limits, allows up to ten attempts per network address across workers. Redis checks and records the vote in one operation. Historical aggregate counts remain in place.

---

## 4. Recorded Architectural Decisions (Days 1–5, §12)

| Timing | Decision Area | Recorded Choice & Parameters | Verification / Status |
| --- | --- | --- | --- |
| **Day 1** | Upload transport & byte boundary | `POST /api/analyze-cv` accepts both `multipart/form-data` (`file`, `jobDescription`, `language`, optional `requestId` / `x-request-id`) and `application/json` (`cvText`, `jobDescription`, `language`, optional `requestId`) through one in-process `analyzeCv` pipeline. `5 MB` is defined as **`5,000,000` bytes** (`MAX_PDF_BYTES` in `app/limit.js`) plus **`65,536` bytes** multipart overhead (`5,065,536` bytes streaming ceiling); JSON `/api/analyze-cv` ceiling is `512,000` bytes; text caps are `30,000` chars (`cvText`) and `15,000` chars (`jobDescription`). | Implemented in `lib/contracts.js`, `app/limit.js`, and `app/api/analyze-cv/route.js` (offline parser check `scripts/check-upload.mjs` exercises `4,999,999` / `5,000,000` / `5,000,001`). Deployed Vercel boundary check pending until deployment hold lifts. |
| **Days 1–3** | PDF parser & Next.js bundling | `pdf-parse` `2.4.5` (`PDFParse`) in `nodejs` runtime (`export const runtime = 'nodejs'`), memory-only buffer processing, `%PDF-` header check (first 1,024 bytes), non-whitespace check, and `parser.destroy()` in `finally`. `next.config.mjs` marks `pdf-parse` in `serverExternalPackages` and traces `pdf.worker.mjs` (from `pdf-parse` and `pdfjs-dist`) into `/api/analyze-cv`. | Implemented in `lib/pdf.js`, `app/api/analyze-cv/route.js`, and `next.config.mjs`. |
| **Days 1–3** | AI provider, model chain & ATS scoring policy | **Gemini API** (`v1beta` `generateContent`) authenticated via `x-goog-api-key` header (never URL query), `temperature: 0.2`, structured JSON `responseSchema` (`GEMINI_ATS_SCHEMA`). Primary model `gemini-flash-lite-latest` (`GEMINI_MODEL`) with fallback order `gemini-3.5-flash-lite,gemini-3-flash-preview` (`GEMINI_FALLBACK_MODELS`), adding `thinkingConfig: { thinkingLevel: 'minimal' }` on `gemini-3` preview (`/^gemini-3(?:\.0)?-/i`) models and escaping literal XML delimiter tags (`<cv_data>`, `<job_description_data>`). Enforces `DEFAULT_ATTEMPT_TIMEOUT_MS = 5,000 ms` per attempt and `DEFAULT_TOTAL_TIMEOUT_MS = 15,000 ms` total budget, with up to 1 fast second pass (`250 ms` delay) focused on flash-lite models when pass 1 encounters transient HTTP `429`/`503` within remaining deadline (non-transient 4xx and invalid JSON fail immediately with `503 TEMPORARILY_UNAVAILABLE`). Policy `2026-11-v1`: ~60/25/15 weights, integer `0..100`, 29 `ALIAS_GROUPS`, strict disjointness, no placeholder keywords, verbatim traceable `original`, zero invented metrics. | Implemented in `lib/ats.js` and `lib/contracts.js`; verified via 34 unit/integration tests and Day-5 10-layout harness. |
| **Days 3–4** | Sparse CVs & empty keyword groups | `countCandidateBullets` distinguishes real experience/project bullets from headers, skill/contact lists, and bare education/date metadata. When `< 3` bullets exist, `0..2` rewrites are permitted (`isSparse = cleanRewrites.length < 3`) without fabricating bullets while retaining valid score and keyword groups. Empty `matchedKeywords` or `missingKeywords` are permitted and labeled explicitly in `buildCvReportText`. | Implemented in `lib/contracts.js` (`FIXTURES.sparseTwo`, `sparseZero`, `emptyMatched`, `emptyMissing`) and `lib/ats.js`. |
| **Days 2–4, 8–9** | Privacy redaction, session TTL, daily quotas & storage | Server-side regex masking with the 4 §8 placeholders (`lib/redact.js`), allowlisted JSON logger (`lib/logger.js`), fixed `90`-minute (`5,400 s`) session TTL preserving expiry on updates, independent daily IP caps (`5` analyses, `3` interview starts) resetting at `Asia/Jakarta` midnight, HMAC-SHA256 IP digest (`QUOTA_HMAC_SECRET`), `15`-minute `requestId` idempotency cache, atomic reservation/release, and Upstash Redis REST (fail-closed `503`) + in-memory fallback (`lib/store.js`). `POST /api/feedback` tracks aggregate counts only. | Implemented in `lib/redact.js`, `lib/logger.js`, `lib/store.js`, `app/api/analyze-cv/route.js`, and `app/api/feedback/route.js`. |
| **Days 6–9C** | Live interview and report | The start and answer routes support both modes and languages, five committed feedback records, conflict and expiry recovery, and UTF-8 report export. | Verified locally with fictional inputs and stubbed providers. |
| **Pending (Days 9–10)** | Deployment, provider retention check & §10/§11 sign-off | Production Vercel deployment, live Upstash Redis & `QUOTA_HMAC_SECRET` configuration, Gemini API tier retention-setting verification, deployed 5 MB upload test, and full §10/§11 pilot metrics remain deferred. | **On hold** pending deployment approval and staging checks. |

---

## 5. Day 1 Provider Access, Zero-Spend Target & Vercel Transport Readiness (Verified 2026-11-25)

| Layer | Selected Choice | Zero-Infrastructure-Spend Assessment | Observed Limits & Deployment Risks |
| --- | --- | --- | --- |
| **AI Provider** | **Gemini API** (`generativelanguage.googleapis.com/v1beta`, structured JSON `responseSchema`, `x-goog-api-key`) | **Free Tier ($0)** available via Google AI Studio for Flash-Lite models (`gemini-flash-lite-latest`, `gemini-3.5-flash-lite`) without requiring a billing card; fits MVP zero-spend target. | Per-project free-tier RPM/RPD caps and transient `503` high-demand spikes observed during rapid 12-request testing. **Privacy/UU PDP caveat (verified `ai.google.dev`):** Google Free Tier may use prompts/outputs to improve Google products/models (our §8 redaction strips the 4 identifier classes first, but residual free-text details remain). Paid Tier disables model-training use — disclose active tier accurately before public launch. |
| **PDF Parser** | **`pdf-parse` `2.4.5`** (`nodejs` runtime, RAM-only) | **$0** (MIT/OSS npm package bundled server-side; zero external service). | Verified locally at exact `4,999,999` B and `5,000,000` B with the offline parser check and the `/api/analyze-cv` integration test; `5,000,001` B rejected cleanly (`413 FILE_TOO_LARGE`). |
| **Temporary State & Quotas** | **Upstash Redis REST** (fail-closed `503`) + local in-memory fallback | **$0** (Upstash Free Tier for MVP scale; zero extra npm dependency via native `fetch` REST + Lua `EVAL`). | Local fallback active while deployment is on hold; live Upstash creds + `QUOTA_HMAC_SECRET` required before production launch (`STD-LOW-01`). |
| **Hosting** | **Vercel** (on hold) | **$0** target on Vercel Hobby plan. | **Important Day 1 transport warning (verified `vercel.com`):** Vercel Serverless Functions default to a **4.5 MB** request body ceiling (`413 FUNCTION_PAYLOAD_TOO_LARGE`), which can block direct `5,000,000` B multipart uploads before reaching Node. When deployment lifts from hold, immediately run `UPLOAD_BASE_URL=https://<deployed-url> npm run test:day1` and either verify `VERCEL_SUPPORT_LARGE_REQUEST_BODY=1` (20 MiB public beta, requires 4 GB function memory — check Hobby eligibility) or revisit transport/ceiling while keeping PDF handling RAM-only (never Vercel Blob/object storage). |
