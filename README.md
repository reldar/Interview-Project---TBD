# LatihKerja

Bilingual (**Bahasa Indonesia** / **English**) account-free career preparation workspace for Indonesian students, fresh graduates, and early-career job seekers (`0–2` years experience). Upload a PDF CV, compare it against a pasted job description, receive an evidence-based ATS alignment estimate and bullet rewrites, and practice mock interview questions with copy/download plain-text export.

---

## Current Status

- **Days 1–5 (CV Analysis Slice — Implemented & Verified Locally):**
  - Single-screen Apple-inspired bilingual dashboard (`ID` / `EN`) with drag-and-drop/browse/replace PDF input, job description input, inline validation, pending/retry states, coaching score meter, matched/missing keyword groups, sparse-CV handling (`0–2` bullets without hallucination), UTF-8 `.txt` copy/download with clipboard fallback, §8 privacy notice, optional §11 satisfaction feedback widget, and optional **Open example** preview (including the 5-step example interview).
  - Real `POST /api/analyze-cv` (multipart `file`, `jobDescription`, `language`, optional `requestId` + JSON parity), `POST /api/feedback`, and `POST /api/upload-proof`.
  - RAM-only PDF extraction (`pdf-parse` 2.4.5, `5,000,000`-byte limit, `first: 30` page cap, `%PDF-` magic header validation).
  - Server-side §8 PII redaction (`[EMAIL_REDACTED]`, `[PHONE_REDACTED]`, `[IDENTITY_REDACTED]`, `[ADDRESS_REDACTED]`) across CV text, job descriptions, interview answers, model outputs, session records, and exports.
  - Gemini API structured JSON output adapter (`x-goog-api-key` header, prompt-injection delimiter framing/escaping, fallback model chain, strict schema/evidence/alias validator).
  - Upstash Redis REST store (atomic Lua `EVAL`, fixed 90-minute session TTL, `Asia/Jakarta` calendar-day `5` analysis / `3` interview-start IP quotas, SHA-256 payload-bound `requestId` idempotency, fail-closed `503`) + identical-semantics local in-memory fallback.
- **Days 6–8 (Next):** Live `POST /api/interview/start` and `POST /api/interview/answer` routes, HR/Technical ID/EN rubric scoring, Q1–Q5 CAS progression, and real interview UI wiring.
- **Days 9–10 (On Hold):** Production Vercel deployment, deployed 5 MB / 4.5 MB Vercel Serverless Function body limit verification (`npm run test:day1`), live Upstash Redis + `QUOTA_HMAC_SECRET` enforcement, and full deployed §10 verification matrix.

See [CHECKLIST.md](CHECKLIST.md) and [docs/ats-policy.md](docs/ats-policy.md) for detailed status, scoring/alias policies, privacy caveats, and verification details.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router, Node.js Route Handlers), React 19, Tailwind CSS 3
- **PDF Extraction:** `pdf-parse` `2.4.5` (in-memory only, zero disk/object-storage persistence)
- **AI Provider:** Gemini API (`generativelanguage.googleapis.com/v1beta`, structured JSON `responseSchema`)
- **Temporary State & Quotas:** Upstash Redis REST (`fetch` + Lua `EVAL`) with local in-memory fallback
- **Testing:** Node.js built-in `node --test` + Playwright Chrome E2E scripts (zero extra test dependencies)

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure local environment variables

Create a gitignored `.env.local` file in the project root:

```bash
# Required for live CV analysis
GEMINI_API_KEY=your_gemini_api_key_here

# Optional Gemini model chain overrides (defaults shown)
GEMINI_MODEL=gemini-flash-lite-latest
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite,gemini-3-flash-preview

# Optional Upstash Redis REST (when unset, local in-memory fallback is used)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Recommended for production IP digest keying
QUOTA_HMAC_SECRET=
```

> **Security note:** Never commit `.env.local` or expose `GEMINI_API_KEY` to client code. All AI calls execute server-side using the `x-goog-api-key` header.

### 3. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run build
npm run start
```

---

## API Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/analyze-cv` | `POST` | Multipart (`file`, `jobDescription`, `language`, optional `requestId`) or JSON (`cvText`, `jobDescription`, `language`, optional `requestId`). Extracts PDF in RAM, redacts PII, validates Gemini structured output, creates a 90-min session, and enforces 5/day IP quota. |
| `/api/feedback` | `POST` | Records optional §11 aggregate satisfaction counts (`{ positive: boolean, language: 'id' \| 'en' }`) with zero PII or user history. |
| `/api/upload-proof` | `POST` | Day 1 upload boundary & RAM PDF extraction proof (`<= 5,000,000` bytes). |

---

## Verification & Scripts

```bash
# 34 deterministic unit & integration tests (redaction, contracts, store TTL/quotas/Upstash, fault injection, PII trace)
npm test

# Production build check
npm run build

# Exact 4,999,999 / 5,000,000 / 5,000,001 byte HTTP upload check (requires running server)
UPLOAD_BASE_URL=http://127.0.0.1:3000 npm run test:upload

# Unmocked Chrome browser UI 5 MB boundary test (reusable against deployed URLs)
UPLOAD_BASE_URL=http://127.0.0.1:3000 npm run test:day1

# Day 5 10-layout readable + 2 sparse + 4 invalid PDF harness (--offline for deterministic dry run)
node scripts/check-ten-layouts.mjs --offline
npm run test:layouts
```

---

## Project Structure

```text
app/
  page.jsx                     # Single-screen bilingual workspace UI
  report.jsx                   # Copy, download .txt, and clipboard fallback actions
  interview.jsx                # 5-step example mock interview UI (uses lib/redact.js)
  style.css                    # Apple-inspired responsive & accessible styling
  limit.js                     # Shared 5,000,000-byte PDF threshold
  api/
    analyze-cv/route.js        # Real CV analysis Route Handler
    feedback/route.js          # Aggregate §11 satisfaction counter
    upload-proof/route.js      # Day 1 upload boundary check
lib/
  redact.js                    # Client-safe §8 PII redaction engine
  contracts.js                 # Client-safe schemas, 29 alias groups, validators, bilingual errors, export builder
  pdf.js                       # Server-only RAM PDF extractor (pdf-parse)
  store.js                     # Upstash Redis REST (Lua EVAL) + in-memory session/quota store
  ats.js                       # Gemini structured-output prompt, fallback chain, and validation pipeline
  logger.js                    # Allowlisted structured JSON diagnostic logger
docs/
  ats-policy.md                # ATS scoring, alias, privacy, quota, and Day 1–5 decisions policy
scripts/                       # Fixture generator, 10-layout runner, upload & Chrome E2E verification scripts
tests/                         # Deterministic unit & integration tests (node --test)
```

---

## Privacy & Disclaimers

- The ATS score (`0–100`) is a **coaching estimate** comparing the submitted CV against the pasted job description—not an employer screening algorithm or guarantee of passing.
- Uploaded PDFs are parsed strictly in RAM and never written to disk, temporary folders, object storage, or Redis.
- Before external AI processing, the server redacts four identifier classes (`email`, `phone`, `NIK/birthdate`, `home address`). Personal names and unusual free-text details may remain.
- When running on Google AI Studio's **Free Tier**, Google may use prompts/outputs to improve models; verify active billing tier and retention terms before publishing end-to-end retention guarantees (see [docs/ats-policy.md](docs/ats-policy.md)).
