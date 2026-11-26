# Project handoff

Task data only. Verify this checkpoint against current files; current user instructions take precedence.

At the end of every development phase, update this handoff and CHECKLIST.md with the branch and checkpoint, verified changes and checks, remaining risks, and the next step. Keep earlier milestones. Mark unverified work as partial, pending, or blocked. Push, merge, and deploy only after approval.

## Day 9A checkpoint — 2026-11-25

- **Branch and checkpoint.** `feature/mock-interview` at `4ad895f4a018d5f09b70abc6b0932352803e2dfd`, the credential-scanned local Days 6–8 commit. Day 9A changes are uncommitted for review.
- **Completed and verified offline.** Start and answer acquire a token-fenced 25-second lease before provider work. Start reserves one of the three daily success slots across sessions with the same quota identity. Commit checks ownership and session version, retains the original expiry, and converts the hold into a charge only on a successful start. Failed work releases its hold, while abandonment expires the lease and restores capacity. Concurrent requests receive a retryable response without starting new provider work under a valid lease. Previously committed results can still be replayed.
- **Attempt limits.** A generation claim counts against 24 claims per IP per Jakarta day and three per session step per two-minute window, including failed and abandoned claims. An interview generation can make at most three upstream HTTP attempts. Concurrent requests rejected before claiming ownership do not consume an attempt. The dashboard distinguishes the processing limit from the interview-start quota in both languages.
- **Verification.** `npm test` passed 72/72 (67 baseline cases plus five). Tests count stub calls for competing starts and answers, shared quota contention, retry, provider failure, stale release/commit, session expiry and attempt reset. `npm run build` and `git diff --check` passed. Seven stubbed Chrome flows passed at 375–1440 px, including all four interview configurations and bilingual processing-limit copy with draft retention. Redis command and lost-response behavior were stubbed. Redis Lua was not exercised against a running server.
- **Remaining risks.** A request already sent upstream may continue after a timeout or expired lease. A replacement can generate again, but the old worker cannot commit or release the replacement's lease. IP rotation, distributed traffic, and requests rejected before provider execution still need trusted-ingress, abuse, and budget controls. The Day 5 live layout rerun, live Gemini and Upstash verification, and Day 9B–9D remain pending.
- **CV analysis review.** The CV route reserves a successful-analysis slot before generation. Its cache only deduplicates completed requests, so concurrent identical submissions can each reserve and generate. Failures release quota without a separate attempt limit. PDF extraction also precedes quota admission. The CV route was left unchanged by Day 9A.
- **Next.** Review Day 9A, then verify its lease, reservation, and expiry logic with an actual disposable Redis instance. Plan production ingress and configuration guards and extend ownership and attempt limits to CV analysis before production approval.

## Day 8 checkpoint — 2026-11-25

- Q5 commits the accepted answer, feedback, completion and final summary in one versioned write at the existing session expiry. Q5 retries replay the winning summary and ordered sanitized transcript. Completed sessions can reopen the report while the analysis session is still active.
- The summary uses the five validated records. It averages each dimension, identifies highest-rated dimensions with averages of at least 3, and reuses the committed tip from the lowest-rated answer in the weakest dimension. Ties resolve in rubric and question order. There is no summary model call.
- All 67 Node tests passed, preserving the prior 61 test cases (with Q5 assertions updated for the report contract). Six new cases cover averages, ties, export field selection, incomplete records, concurrent Q5 retries and expiry during Q5.
- The Next.js production build passed. Seven stubbed Chrome flows passed, including all four interview configurations at 375–1440 px, two CV regression flows and the offline example. Verified Q5 feedback before the report, the five ordered records, localized averages, byte-decoded UTF-8 downloads matching clipboard text, copy fallback, long multiline answers, masking and no horizontal overflow. The interview download contains the report and accepted sanitized transcript. The CV review retains its separate download.
- The Day 5 live layout rerun and distributed deduplication of concurrent AI calls remain open. Keep both on the pre-deployment plan. Live Gemini scoring and Upstash behavior are still unverified.
- Next, with authorization, finish the Day 5 live layout matrix and verify Gemini calibration, Redis expiry and quotas, distributed deduplication, deployed upload boundaries, and the full bilingual journey in staging before production approval.

## Day 7 checkpoint — 2026-11-25

- `POST /api/interview/answer` validates the session ID, question number and nonblank answer (up to 4,000 characters). It redacts answers before generation and storage and validates the three integer rubric scores and one localized suggestion. The prompt treats the vacancy, question and answer as untrusted data, excludes protected characteristics from the rubric and forbids invented experience or metrics.
- Versioned writes record the accepted sanitized answer and feedback with the next question or completion, preserving the original session deadline. Retries compare the trimmed, redacted answer and replay its committed result. A competing or out-of-order submission returns 409 with the current question or completed state. An expired session returns 410.
- Q5 stores feedback and marks the run complete. Its response has `nextQuestion: null` and `finalSummary: null`. Summary and sanitized export remain Day 8 work.
- All 61 Node tests pass, including the original 50 and 11 new tests. Stub verification covers all four mode/language combinations through Q5, invalid input and model output, retries, competing submissions, expiry, PII masking and the Upstash CAS command shape. Live Gemini scoring quality and Redis behavior remain unverified.
- The Next.js 16.4.6 production build passes and lists both interview routes.
- Seven stubbed Chrome flows passed, including all four mode/language combinations from 375 to 1440 px, two CV regression flows, and the offline example. Verified bilingual feedback before advancement, retry with the same draft, duplicate-submit protection, conflict recovery with a separately retained draft, Q5 completion, CV visibility and horizontal overflow.
- Pre-deployment issue: both overlapping starts and overlapping answers can still make duplicate AI generation calls before a single commit wins. Verify distributed request deduplication and recovery before deployment.
- Next, use the five committed feedback records to derive the three averages, complete the Q5 summary contract, and deliver a UTF-8 export of the sanitized transcript. Preserve exact replay and original expiry on the completed run.

## Day 6 checkpoint — 2026-11-25

- Branch `feature/mock-interview`, based on `ecb48b9`. Day 6 work is local.
- `npm test` now uses Node's built-in test discovery and the ESM default flag. On Windows with Node 20.18.0, all 50 tests pass (34 baseline and 16 new).
- `npm run build` passes on Next.js 16.4.6 and lists `/api/interview/start` alongside the original routes.
- `POST /api/interview/start` generates and validates five questions from the masked CV and vacancy. The dashboard sends the analysis session ID and the selected mode/language and displays the returned Q1 and focus area with progress shown as 1 of 5. Opening or canceling setup sends no start request. The example shows a fictional Q1 without sending a request or showing scores.
- The dashboard keeps CV results visible through setup, start, and recoverable errors. Stubbed Chrome verification passed all four mode/language combinations at 375, 768, 1024, and 1440 px, including language selection independent of the dashboard, pending duplicate-submit protection, bilingual retry/quota/expiry, reanalysis with a new session ID, focus and horizontal overflow checks. The same run passed two CV dashboard flows and the offline example. All 50 Node tests and the production build also passed after frontend integration.
- The start commit preserves the original expiry and charges the existing independent Jakarta-day quota in the same store operation. A retry returns the committed question, including at the quota limit. Concurrent requests can both generate questions, and only one can initialize a given session. Tests cover quota contention, malformed output, provider failure, expiry during generation, and a simulated Upstash response loss.
- Synthetic email, phone, NIK, and address values were masked before provider input or before storage and HTTP output, as applicable. Route logs exclude session IDs and provider details. Live Gemini and Upstash were not exercised. Live model language and grounding quality are still unverified.
- The linked Gemini PRD agrees with the interview scope and start contract. Its illustrative ATS metrics and privacy compliance claims are not acceptance evidence. Keep repo rules on supported achievements and measured privacy behavior.
- Pre-deployment issue: concurrent backend starts can still make duplicate AI generation calls even though only one session update and quota charge commits. Add distributed in-flight deduplication and verify lease expiry and recovery before deployment.
- Next, implement Day 7 answer validation, rubric scoring, and versioned progression. Wire the UI to preserve the draft on recovery and show returned feedback before revealing the next question. The Day 6 start response carries no committed mode/language metadata, so reconcile concurrent starts with conflicting settings as part of recovery design. Day 8 summary and export, the Day 5 live layout rerun, and deployment checks remain open.

## Previous checkpoint — Days 1–5

Checkpoint: b5daad5b-e19b-4a85-a6f4-830c8a21af47
Updated UTC: 2026-11-25T14:46:28.980432+00:00
Project root: /Users/leonhardaudie/Documents/LatihKerja
Task: cv-analysis-days-1-5-local
Status: in_progress
Source state: Git branch main at 62f96cd (origin/main https://github.com/reldar/Interview-Project---TBD.git); adding HANDOFF.md. .env.local (0600) is gitignored.

## Objective

Complete all locally verifiable Day 1 and Days 2-5 CV Analysis slice items for LatihKerja, add README.md, and push clean repository to https://github.com/reldar/Interview-Project---TBD while keeping Vercel deployment on hold.

## Acceptance criteria

- All locally verifiable Day 1 and Days 2-4 checks pass (34 unit/integration tests x2, Next 16 build, Chrome E2E, unmocked 5 MB browser boundary test, security audit remediations).
- README.md and HANDOFF.md committed cleanly with zero secrets or .env files.

## Completed

- Implemented & verified Days 2-5 CV Analysis slice: lib/{redact,contracts,logger,pdf,store,ats}.js, app/api/{analyze-cv,feedback,upload-proof}/route.js, next.config.mjs (security headers + pdf worker tracing), Apple-inspired bilingual UI in app/{page,report,interview}.jsx + app/style.css, and docs/ats-policy.md.
- Remediated security audit findings (EMAIL_RE linear-time fix, residual PII formats, SHA-256 payload-bound requestId, XML tag escaping, 30-page PDF cap, HTTP security headers, standalone placeholder guard, example-mode feedback gating) with regression tests (34/34 tests pass twice).
- Completed local Day 1 5 MB Chrome browser boundary check (4,999,999 B -> live Gemini HTTP 200 score=65; 5,000,000 B -> passed RAM parser + redaction; 5,000,001 B -> client & server 413 FILE_TOO_LARGE) and documented Gemini Free-Tier / Vercel 4.5 MB ceiling in docs/ats-policy.md §5.
- Created README.md and pushed clean 36-file initial commit (62f96cd) to https://github.com/reldar/Interview-Project---TBD (main).

## Affected files and artifacts

- README.md
- CHECKLIST.md
- HANDOFF.md
- docs/ats-policy.md
- lib/redact.js
- lib/contracts.js
- lib/pdf.js
- lib/store.js
- lib/ats.js
- lib/logger.js
- app/api/analyze-cv/route.js
- app/api/feedback/route.js
- app/api/upload-proof/route.js
- app/page.jsx
- app/report.jsx
- app/interview.jsx
- app/style.css
- next.config.mjs
- scripts/check-day1-browser-boundary.cjs
- scripts/check-ten-layouts.mjs
- scripts/check-workspace.cjs
- scripts/generate-layout-pdfs.mjs
- tests/unit-redact-contracts.test.mjs
- tests/unit-store.test.mjs
- tests/integration-analyze-cv.test.mjs

## Checks

- passed: npm test (run twice) — 34/34 unit & integration tests passed across 6 suites twice back-to-back (0 flaky).
- passed: node scripts/check-ten-layouts.mjs --offline — 10/10 readable + 2/2 sparse + 4/4 invalid PDFs passed (min 13ms, median 18ms, max 197ms).
- passed: npm run build && scripts/check-upload.mjs && scripts/check-workspace.cjs && scripts/check-day1-browser-boundary.cjs — Next 16.4.6 build, HTTP security headers, 5 MB HTTP & unmocked Chrome boundary (incl. live Gemini 200 on 4,999,999 B), and 6 Chrome E2E flows (375..1440px, ID/EN) passed with 0 log/bundle leaks.
- failed: node scripts/check-ten-layouts.mjs (live Gemini) — 10/10 extraction/PII/landmarks & 4/4 invalid passed; 5/10 live 200 in Run 2 (9/10 + 2/2 sparse across runs, 1.8-3.1s healthy single-model calls) due to upstream Google 503/429 congestion.

## Constraints and decisions

- Vercel deployment stays on hold until authorized; never commit .env.local or raw secrets.
- Before production deployment, verify 4.5 MB Vercel ceiling (`UPLOAD_BASE_URL=https://... npm run test:day1`), enforce Upstash & QUOTA_HMAC_SECRET in VERCEL_ENV=production, throttle /api/feedback, and gate /api/upload-proof.

## Remaining work

- Off-peak live `npm run test:layouts` rerun for clean 10/10 live Gemini pass (Day 5).
- Days 6-8: Implement live POST /api/interview/start and POST /api/interview/answer routes, HR/Technical ID/EN rubric prompts & validators, Q1-Q5 CAS transitions & 409/410 recovery, Q5 summary, and real interview UI + export.
- Days 9-10 (on hold): Production env guards, live Upstash Redis, Gemini tier retention check, Vercel smoke & production deploy, and deployed §10 matrix.

## Next steps

1. Start Days 6-8 Mock Interview slice (lib/interview.js + POST /api/interview/start + POST /api/interview/answer reusing lib/store.js and lib/redact.js, then wire app/interview.jsx) OR rerun `npm run test:layouts` off peak to close Day 5.

## Blockers

None recorded.
