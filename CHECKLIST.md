# LatihKerja MVP delivery checklist

At the end of each development phase, update this checklist and HANDOFF.md with verified results, branch and checkpoint, outstanding risks, and the next action. Keep prior milestones and mark incomplete or unverified checks explicitly. Push, merge, and deploy only after approval.

Source: [guideline.md](guideline.md), sections 1–12. Open boxes represent remaining work. “Proposed” identifies working defaults or review suggestions that still need team agreement. A owns backend and AI, B owns frontend and UX, and both own the deployed walkthrough.

## Paused checkpoint after independent security review

**Local remediation HOLD. Staging HOLD. Production HOLD.** This development checkpoint is based on `feature/mock-interview` at `b728e152f9ffb97fbe2cb6fb2dcac90918d9c743`. The latest independent audit supersedes the earlier pending-review entries.

- [x] Implement ATS grounding, legacy CV cache validation, labeled-name masking, and legacy interview report masking. Preserve the implementation and regression tests in this checkpoint.
- [x] Independently rerun **143/143** automated tests with zero failures or skips, plus the build, private Redis, offline PDFs, exact PDF boundaries, both Chrome suites, benchmark, credential scans, and whitespace checks.
- [x] Record the failed independent security review. Both local High remediation gates remain on HOLD.
- [ ] **Next milestone.** Reassess ATS claim provenance, structured quantities, explanation premises, and legacy cache validation. Reassess labeled-field boundaries, preserving work evidence, and masking before provider dispatch and on legacy reads. Agree on a design and acceptance criteria before implementation.
- [ ] Resolve the High ATS findings covering unsupported responsibility and explanations, quantity and currency parsing, subject and bound changes, direction, cadence, and polarity.
- [ ] Resolve the High privacy finding covering names surviving provider input, storage, replay, Q5, and export.
- [ ] Resolve the Medium findings covering erased interview evidence, legitimate and bilingual CV rewrites, wrapped PDF spans, mixed and negated vacancy requirements, equivalent CV retry with a quota hold and budget exhaustion, and shared replay keys for Redis-backed local workers.
- [ ] Carry forward the identifier-only and harness coverage findings. Repeat the local matrix and obtain a fresh independent review before changing the local HOLD.
- [ ] Resolve the High Vercel transport decision for 5,000,000-byte PDFs. Where separately authorized, verify deployed ingress and exact boundaries, trusted identity, hosted Upstash replay and cross-instance quotas, live Gemini behavior and retention settings, and the deployed verification matrix.

Resume with the findings, line references, and ordered instructions in [HANDOFF.md](HANDOFF.md#development-checkpoint-after-independent-security-review).

## High-severity remediation awaiting independent review

**Staging and production on HOLD.** Work is uncommitted on `feature/mock-interview` over `b728e152f9ffb97fbe2cb6fb2dcac90918d9c743`. See HANDOFF.md for the changed files, root causes, verification run, and reviewer instructions.

- [x] Reproduce the grounding and labeled-name failures in tests before changing the affected paths. Retain all 107 baseline tests and assertions.
- [x] Check ATS rewrite and explanation claims against their source bullet. Bind bilingual quantities to the action, subject, unit or currency, polarity, and bounds. Preserve neutral questions. Exercise invalid output and legacy cache validation without a session commit, success-quota charge, or extra provider validation call.
- [x] Preserve substantive prose after supported labeled names, including Indonesian titles and trailing initials. Test idempotency, bounded scanning, provider prompts, committed records, keyed replay, legacy report reads, and UTF-8 export. Keep existing records in place.
- [x] Run the local matrix. **143/143 Node tests**, production build, **10/10** private Redis groups, **16/16** offline PDFs, **3/3** parser boundaries, **7/7** real-route Chrome assertions, **7/7** workspace Chrome flows, benchmark, credential and privacy checks, and whitespace checks passed. Local HTTP and Chrome preserved the 5,000,000-byte contract.
- [ ] Independently review both High findings, including new bilingual variants and masked legacy replay and exports. Deterministic rules have limited language coverage, and free text can still contain identifiers.
- [ ] Leave the staging High open until both developers agree on Vercel transport and separately authorize deployed ingress testing. Keep the wrapped-PDF, bilingual, vacancy, combined quota and budget replay, local Redis replay key, identifier-only, and harness findings open.

## Development checkpoint before pause · 2026-11-26

**Local remediation: HOLD. Staging readiness: HOLD.** The latest independent suite passed **107/107 tests**. The completed remediation, verification results and unresolved findings are preserved below. [Detailed resume instructions](HANDOFF.md#development-checkpoint-before-pause--2026-11-26)

- [ ] On resume, verify `feature/mock-interview` against GitHub and review any teammate commits. Add failing regressions for the High ATS grounding and name masking findings, fix them, then address the wrapped-PDF, bilingual, vacancy, replay and identifier-only cases below.
- [ ] Rerun the local verification matrix and obtain an independent re-review before changing the local HOLD.
- [ ] Obtain agreement from both developers on the Vercel transport for the existing 5,000,000-byte PDF contract. Keep staging and Day 10 on HOLD pending the decision and separate authorization for deployed verification.

## Independent review of the uncommitted remediation · 2026-11-26

**Local remediation: HOLD. Staging readiness: HOLD.** Audited `feature/mock-interview` over `d021ce3`. The prior records below are historical. No Critical finding. [Severity, reproductions, runtime and coverage details](HANDOFF.md#independent-review-of-the-uncommitted-remediation--2026-11-26)

- [x] Independently reran all 107 automated cases, production build, WSL Redis, offline PDFs, parser boundaries, both Chrome suites and repeated performance checks. Confirmed the real HTTP reset after a Redis commit and the NFC/CRLF keyed replay control.
- [ ] **High, local** Reject unsupported ATS achievements in rewrites and explanations. Bind the 12-count example to receiving reports, keep EUR distinct from GBP, and reject invented spelled percentages.
- [ ] **High, local** Preserve adjacent prose after initials and mask Indonesian titles and names without exposing them to the provider or export. The `Ir.` synthetic fixture leaked its labeled name. The `K. My internship` fixture returned 400 after losing its evidence.
- [ ] **High, staging** Both developers must agree on a Vercel transport that supports the existing 5,000,000-byte PDF contract. Browser-side extraction and a reduced limit remain unimplemented. Verify deployed ingress after agreement and separate authorization.
- [ ] **Medium** Preserve complete source evidence across PDF wrapping, broaden legitimate bilingual coverage, and repair mixed required/optional and negated vacancy clauses.
- [ ] **Medium** Add the hold-plus-exhaustion replay case in memory and Redis, and make the shared-key requirement explicit for Redis-backed local workers. Independent controls recovered after the hold was released or after using a shared key.
- [ ] **Low** Reject identifier-only answers and broaden simulation oracles beyond fixture-derived rewrites and worker-injected PDF extraction.

| Independent check | Passed / failed / skipped | Time |
| --- | --- | --- |
| `npm test` | 107/0/0 | 4.077 s wall, 2.654 s TAP |
| `npm run build` | 1/0/0 | 39.459 s |
| `node --experimental-default-type=module scripts/check-redis-quotas.mjs`, private Redis 8.12.0 and four workers | 10/0/0 groups | 54.731 s |
| `npm run test:layouts -- --offline`, real parser and stubbed Gemini | 16/0/0 | 3.042 s |
| `npm run test:upload`, exact byte boundaries | 3/0/0 | 2.889 s |
| `npm run test:day1 -- --interview-replay`, localhost 3912 and stubbed Gemini | 7/0/0 | 13.861 s |
| `node --experimental-default-type=module scripts/check-workspace.cjs`, production build and intercepted APIs on localhost 3911 | 7/0/0 | 17.545 s |
| `node --experimental-default-type=module scripts/measure-evidence-cost.mjs`, three runs | 27/0/0 workload-size groups | 5.914 s |
| Focused deterministic checks, eight runs pinned to one core | 16/0/224 filtered | 3.609 s |
| Source/client credential and server-marker scans | 3/0/0 checks, zero matches in 26 client files | 0.649 s |
| `git diff --check` and `git diff --cached --check` | 2/0/0 checks | 0.149 s, no whitespace errors |

Supplemental local probes took 0.741 s, 1.047 s for the real wrapped PDF and baseline comparison, 13.677 s against WSL Redis, and 2.597 s for the 120-keyword workload across three sizes. The largest warmed standard workload took a median 3.72–3.99 ms wall time. The 120-keyword maximum took a median 7.99 ms. These timings cover local validation only. Live Gemini, live layout calibration, hosted Upstash and deployed ingress were skipped. The only audit edits are these two documents.

## Targeted local remediation over `d021ce3` · 2026-11-26

`feature/mock-interview` remains at `d021ce3ebb4381a197c47bddbbd8de469abd8a0f`. The working diff is for independent review. The prior audit and milestones are retained below. [Reproductions, implementation choices, upload options and verification](HANDOFF.md#targeted-local-remediation-over-d021ce3--2026-11-26)

**PASS for local remediation.** Staging and Day 10 have open gates.

- [x] Reproduced the fabricated ATS facts, rejected translation, incorrectly replayed distinct answers and equivalent CV retries receiving 429 before editing.
- [x] Ground exact source bullets, prevent numeric unit/action changes and recognized responsibility, credential and impact inflation, and cover supported bilingual paraphrases and adverse cases. Document limitations of deterministic grounding.
- [x] Preserve answer evidence during name masking. Use scoped replay hashes for new submissions and compatible masked evidence for older records. Verify retries, 409 conflicts, expiry and the real local handler path.
- [x] Publish a bounded canonical replay marker with the successful CV result. Test quota and budget exhaustion using memory and real Redis without new success charges or model dispatches.
- [x] Replace the wall-clock test gate with deterministic checks, measure isolated scaling, and strengthen browser, PDF matrix and disconnect assertions.
- [ ] Obtain product approval for browser-side extraction near the safe Vercel request-body ceiling while retaining 5,000,000-byte file selection, or approve a reduced 4,400,000-byte shared cap. Preserve current app and transport until approved. Staging and Day 10 remain on hold.

| Executed check | P/F/S and time | Observable result and environment |
| --- | --- | --- |
| `npm test` | 107/0/0, 3.551 s | Baseline 99 plus eight added cases. Real local handlers and validation, memory and provider/REST doubles. |
| `npm run build` | 1/0/0, 43.371 s final build | Four production API routes compiled. Public diagnostic absent. |
| `node --experimental-default-type=module scripts/check-redis-quotas.mjs` | 10/0/0 groups, 57.280 s | Real private WSL Redis 8.12.0/Lua and four Node workers. Final-slot replay, changed-payload rejection, genuine HTTP disconnect after commit and session isolation passed. Upstream services and worker PDF extraction stubbed. |
| `npm run test:layouts -- --offline` | 16/0/0, 2.169 s | Real parser and metered handler, ten readable and two sparse 200s, four invalid 422s, and expected keyword sets. Gemini transport stub. |
| `npm run test:upload` | 3/0/0, 2.147 s | Real parser accepted both valid sizes and rejected 5,000,001 B. |
| `npm run test:day1 -- --interview-replay` on localhost 3912 | 7/0/0, 15.065 s | Six browser/server boundary checks and the added Chrome recovery flow. Both valid upload sizes worked. A committed answer was recovered with a single scoring dispatch and conflict returned 409. Real browser/parser/handlers with a local Gemini transport stub. |
| `node --experimental-default-type=module scripts/check-workspace.cjs` on localhost 3911 | 7/0/0, 17.707 s | Seven production-build Chrome flows with intercepted APIs. The final harness verifies the keyboard file chooser via Chrome protocol events and checks independent rubric averages. |
| Focused ATS bounds and marker-bearing redaction checks, eight concurrent runs pinned to one CPU | 16/0/224, 5.217 s | All selected functional checks passed under contention. Unrelated cases filtered. |
| `node --experimental-default-type=module scripts/measure-evidence-cost.mjs`, three runs | 27/0/0 workload-size groups, 6.398 s | Largest-input valid median 3.76–4.51 ms wall and 3.90–4.70 ms CPU. Local synthetic evidence/redaction workload. |
| Worktree and generated-client `rg` credential and marker scans | 3/0/0 checks, 0.298 s | No known credential patterns or server credential markers found. Scanned 26 built client files. |
| `git diff --check` and `git diff --cached --check` | 2/0/0 checks | No whitespace errors. |

Live layouts, Gemini, hosted Upstash and deployment checks remain open. Local runs do not establish deployed latency, live rewrite quality or complete redaction. No upload product change was made.

## Independent staging audit of `d021ce3` · 2026-11-26

**HOLD for staging preparation and Day 10.** Audited `feature/mock-interview` at `d021ce3ebb4381a197c47bddbbd8de469abd8a0f` over `591f411`. The branch started clean and matched the upstream ref and GitHub branch tip (0 ahead, 0 behind). [Ranked findings, reproduction evidence, and coverage limits](HANDOFF.md#independent-staging-audit-of-d021ce3--2026-11-26)

| Independently executed command | P/F/S and time | Expected and actual behavior, environment and limits |
| --- | --- | --- |
| `npm test` | 99/0/0, 2.383 s TAP | All expected outcomes passed with real local handlers and validators, memory and mocked provider/REST responses. No deployed transport. |
| `node --experimental-default-type=module --test --test-concurrency=1` | 99/0/0, 3.798 s | All cases passed serially, including timing assertions. Same local doubles. |
| `npm run build` | 2/0/0 runs, 25.921 s timed rerun | Both real local production builds passed and listed all four expected API routes. Upload diagnostic absent. Runtime credentials and ingress remain separate checks. |
| `node --experimental-default-type=module scripts/check-redis-quotas.mjs` | 8/0/0 groups, 40.091 s timed rerun | Verified private socket, vote/TTL, CV and interview fencing, budget accounting and contention, equivalent PDF replay and Jakarta rollover. Real WSL Ubuntu Redis 8.12.0 and four workers with stubbed transport and Gemini. No hosted REST/TLS or real disconnect after commit. |
| `node --experimental-default-type=module scripts/check-ten-layouts.mjs --offline` | 16/0/0, 1.116 s | Expected and got 10 readable plus 2 sparse HTTP 200s and 4 invalid HTTP 422s with zero provider calls. Real parser/route, fixture-derived model and memory. Local timings exclude browser and live provider. Expected skills, translations and semantic quality need independent checks. |
| `NODE_OPTIONS=--experimental-default-type=module npm run test:upload` | 3/0/0, 1.864 s | Real parser accepted 4,999,999 and 5,000,000 B and rejected 5,000,001 B. Simple padded PDFs. No browser or ingress. |
| `npm run test:day1` on local `next dev --webpack` at port 3912 | 6/0/0, 12.382 s | Expected and got diagnostic 404, server oversize 413, two localized browser oversize rejections without upload, and 200/visible score at both valid sizes. Real Chrome, HTTP, parser and handler with local memory and a Gemini fetch stub that inspected extracted text. Vercel, live model and hosted store remain unverified. |
| `node --experimental-default-type=module scripts/check-workspace.cjs` on local `next start` at port 3911 | 7/0/0, 22.294 s | Two CV flows, all four live-mode combinations through Q5 and the offline example passed. Real Chrome and built UI with intercepted APIs. Keyboard, accessibility tree, bilingual recovery, interrupted-response stubs and downloads exercised. No real simultaneous browser users, server disconnect or screen-reader speech. |
| `node --experimental-default-type=module --test --test-name-pattern='STD-MED-01: rejects\|security regressions: linear EMAIL_RE' tests/unit-cv-evidence-ownership.test.mjs tests/unit-redact-contracts.test.mjs` | Normal 20/0/240 over 10 runs, 2.823 s. Single-core contention 11/5/192 over 8 runs, 3.403 s. | Real validator and redactor. Both functional rejections preceded the timed check. The ATS timing assertion failed at 149.25–510.12 ms in five loaded runs. Redaction timing passed. Skips are filtered cases. |
| `git diff --check 591f411..HEAD`, `git diff --check`, `git diff --cached --check`, tracked/client credential and bundle-marker scans | 6/0/0 checks, 0.243 s Git and 0.309 s scans | No whitespace errors or matched secrets across 53 tracked files and 26 generated client files. Hosted environment values, logs and arbitrary secret formats remain unverified. |

The two PDF commands without Node's ESM flag and two early boundary server startup attempts failed before any cases ran. These attempts are preserved in the handoff. Live `npm run test:layouts` was skipped (0/0/16), and live Gemini, hosted Upstash, deployed ingress and the Day 10 matrix remain open. The historical temporary axe runner and screen-reader speech were not rerun. Five independent color calculations cleared their applicable contrast thresholds.

Inline `node --experimental-default-type=module --input-type=module` probes used synthetic data and local model/storage doubles. ATS and equivalent-retry behavior missed 11 audit expectations (1.014 s and 0.436 s). Interview replay failed and export exclusion passed (0.390 s). Masking and contrast returned 6/2/0 (0.715 s). Interview start recovered as expected after three budget denials with zero dispatches (one group, 0.675 s). The handoff preserves the individual expected and actual outputs.

- [x] Confirm the branch, compare all changes since `591f411`, execute the existing offline/local suites and record their boundaries.
- [ ] **High** Fix ATS original/claim grounding, sparse rewrite enforcement and supported bilingual translations. Regress fabricated metrics, changed metric units and unsupported qualitative outcomes.
- [ ] **High** Correct name masking and replay identity so different answers remain distinct and the candidate's evidence survives in both languages.
- [ ] **High** Resolve the 5 MB product promise against the documented Vercel default and verify the chosen transport and plan.
- [ ] **Medium** Preserve equivalent CV replay after quota/budget exhaustion. Cover negated and ambiguous skills, residual PII and prompt-dependent score integrity. Bring the live layout runner under production dispatch accounting.
- [ ] **Low** Make timing and simulator oracles independent, show the feedback reset time, and align README and policy with the current runtime/configuration. Add a real local browser-to-handler/Redis path with simultaneous users, duplicate submissions and an interrupted connection after commit.
- [ ] **Next** Remediate and independently rerun the local release candidate. Resolve the recorded product-scope decision. Once separately authorized, run staging ingress, hosted Redis, provider configuration/privacy, and then the Day 10 deployment matrix with fictional inputs.

## Day 9B · Targeted remediation & independent review follow-up

**Local remediation & review follow-up PASS (ready for Day 9C).** Branch `feature/mock-interview`, committed over `591f411601fd688029d8bdca992e3265473d24d7`.

- [x] Reproduced both High findings before implementation (`591f411`). Fenced canonical CV reservation and session publication, and corrected the release-after-commit mock.
- [x] Independent review verified canonical CV ownership (`High #1`) and remediated follow-up Day 9B blockers: replaced closed 67-word `groundedRewrite` allowlist with principled EN/ID/cross-language evidence & anti-hallucination guards (`SPEC-HIGH-01`/`SPEC-HIGH-02`), added O(n) pre-tokenization and keyword/rewrite length caps (`STD-MED-01`), fixed `scripts/check-ten-layouts.mjs --offline` (`SPEC-MED-01`), cleared stale `requestIdRef` on `200 OK` in `app/page.jsx` (`SPEC-MED-02`), hardened XML delimiter escaping (`STD-LOW-01`), stripped `app/interview.jsx` UTF-8 BOM (`STD-LOW-02`), and added Lua skew/`undefined`-commit guards (`STD-LOW-03`).
- [x] **96/96 Node tests** (twice back-to-back with cleared credentials), `scripts/check-ten-layouts.mjs --offline` (**10/10** readable + **2/2** sparse + **4/4** invalid), production build, `scripts/check-upload.mjs` (3/3), **7/7** stubbed Chrome flows (`375–1440 px`), credential/bundle/log scans, and `git diff --check` passed. *(Note: real Redis Lua script `scripts/check-redis-quotas.mjs` was not re-run on macOS because `redis-server` is unavailable on this host—rerun on WSL Redis / staging before release.)* See [Day 9B independent review & follow-up remediation](HANDOFF.md#day-9b-independent-review--follow-up-remediation--2026-11-26).

## Day 9B · Independent audit

**Resolved locally (ready for Day 9C).** Originally audited `feature/mock-interview` at `d8efc366f56e66e0c45a2e006be7ec6cf58134cc`, then re-audited and remediated over `591f411`. See [the audit record](HANDOFF.md#day-9b-independent-audit) for original references and reproductions.

- [x] **Audit and local verification** — Reviewed the original CV slice, Days 6–9B, and all 87 baseline test cases. **87/87 tests, the production build, seven stubbed Chrome flows, the four-worker Redis Lua harness and `git diff --check` passed.** Credential scans found no matching secret patterns in tracked files or generated client assets.
- [x] **New high-severity CV findings** — Atomically claim the canonical replay identity across equivalent uploads before Gemini dispatch (`591f411`, verified PASS). Require evidence for ATS rewrite claims and reported matches without rejecting honest EN/ID/cross-language rewrites (remediated over `591f411`, verified **96/96** tests + offline ten-layout harness).
- [x] **Day 9C · Verified locally** — Preserve live drafts and committed feedback across mode changes and interrupted requests (reproduced on 375 px Chrome), show active mode/language during Q1–Q5, and improve bilingual recovery and practical privacy safeguards. Pushed on feature/mock-interview over bd5b899; 97 Node tests, production build and seven stubbed Chrome flows passed. Independent review and deployment checks remain open.
- [x] **Day 9C replay review** — Independently reviewed 61d1a6a. Local follow-up preserves first-person answer evidence after a labeled name, replays compatible older records, validates optional replay metadata before clearing drafts, and corrects same-question conflict instructions. A second review verified and prompted fixes for comma-formatted names, adjacent skills, profile links and draft-lifetime copy. 98 Node tests and seven stubbed Chrome flows passed. Production review, live checks, and the product-scope decision remain separate.
- [x] **Day 9D · Upload diagnostic removed locally** — The local production build at `61d1a6a` plus working-tree changes returns 404 for the former route. Offline parser and normal analysis boundary tests, 98 Node tests, the production build and seven stubbed Chrome flows passed.
- [x] **Day 9D · Satisfaction feedback protected locally** — One vote per live CV session and a shared ten-attempt limit per network address per minute. Verified 99 Node tests, seven stubbed Chrome flows, a production build and the private Redis 7.2.17 harness across four workers.
- [ ] **Before public release** — Review residual PII, prompt grounding, provider settings, free-tier capacity and accessibility. Live Upstash, deployed Vercel ingress and upload limits, live Gemini evaluation and the Day 5 ten-layout rerun remain pending.

## Day 1 · Prove the upload path and agree on contracts (§§1–5, 12)

- [x] **Both** — Walk through one account-free visit from language selection to copied or downloaded feedback. Cover internship seekers, fresh graduates, and workers with 0–2 years of experience. Use fictional CVs and vacancies. *(Verified locally in Chrome 375–1440px in ID & EN; deployed Vercel walkthrough tracked under Day 10.)*
- [ ] **A** — Set up Next.js App Router, Node Route Handlers, server-only credentials, and a Vercel smoke deployment. Choose one parser (pdf-parse or pdfjs-dist) and one structured-output provider (Gemini or OpenAI). Check provider access and cost against the zero-infrastructure-spend target. *(Local Next.js 16 + `pdf-parse` 2.4.5 + Gemini API structured outputs via server-only `.env.local` + Free-Tier zero-spend & retention audit documented in `docs/ats-policy.md` §5 complete; Vercel smoke deployment remains on hold.)*
- [ ] **Both** — Agree on the exact 5 MB boundary (proposed 5,000,000 bytes). Send real PDFs just below, at, and above it through the deployed browser UI. The first two must reach the RAM parser and the third must get a size error. Include multipart overhead. If hosting blocks a valid file, resolve transport before integrating uploads. *(Agreed `5,000,000` bytes + `65,536` overhead; unmocked Chrome UI test `scripts/check-day1-browser-boundary.cjs` passed locally for `4,999,999` B -> live Gemini HTTP 200 `score=65` + RAM parse, `5,000,000` B -> passed RAM parser + redaction, `5,000,001` B -> client & server `413 FILE_TOO_LARGE` in ID/EN; deployed Vercel check + 4.5 MB platform ceiling verification remain on hold — rerun `UPLOAD_BASE_URL=https://... npm run test:day1` once deployed.)*
- [x] **Both** — Agree on the three POST routes, exact field casing, enums, schemas and bilingual recovery states from §5. Prepare shared fictional success and failure fixtures. Decide text limits and retry identity. Proposed multipart fields are file, jobDescription and language. If exposing JSON, apply the same text limits, masking and quotas. Invoke analysis once per request. *(Frozen in `lib/contracts.js` & `docs/ats-policy.md`; multipart + JSON parity & SHA-256 payload-bound `requestId` verified.)*
- [x] **B** — Build the one-dashboard shell with Tailwind and shadcn/ui. Stage input, analysis, setup, one question at a time, feedback and completion. Make the fixture journey usable in ID and EN while A builds the routes. *(Apple-inspired bilingual shell in `app/page.jsx`, `app/interview.jsx`, `app/report.jsx`, `app/style.css` verified in Chrome 375–1440px.)*

## Day 2 · Read the PDF and remove identifiers (§§2–4, 8)

- [x] **B** — Support drop, browse and replace for one PDF. Show local filename and size, language selector and pasted vacancy. Give a field-specific message for missing file, invalid type, oversize or whitespace-only description. *(Verified in `app/page.jsx` via Playwright Chrome ID/EN with `aria-invalid`/`aria-describedby` focus.)*
- [x] **A** — Enforce size and application/pdf on the server and check parseability. Process bytes in RAM and release them on success and failure. Reject corrupt, protected and image-only PDFs before a model call or session creation. Offer a selectable-text PDF recovery message in the selected language. *(Verified via `lib/pdf.js`, `app/api/analyze-cv/route.js`, 4 invalid PDF fixtures -> `422 PDF_UNREADABLE` with exact §2 ID/EN copy and 0 provider/quota/session side effects.)*
- [x] **A** — Apply server-side regex redaction before external processing. Use the four §8 placeholders for email, phone, identity including NIK/birthdate, and home address. Check mixed-language labels, multiline addresses and phone variants while preserving skills, graduation years and employment dates. *(Verified via `lib/redact.js`, `tests/unit-redact-contracts.test.mjs`, and security audit ReDoS/residual-PII regressions.)*
- [x] **Both** — Agree on the proposed extension to vacancy text, answers and free-text results. Trace synthetic identifiers through provider input, Redis, displayed results, logs and export. Keep raw PDF and extracted text out of persistent storage. *(Verified in `tests/integration-analyze-cv.test.mjs` synthetic PII trace across provider input, store, allowlisted logs, and export; live interview answer routes will reuse `redactPii` in Days 6–8.)*

## Days 3–5 · Deliver and measure CV analysis (§§2–5, 9–11)

- [x] **Day 3 · A** — Document the ATS scoring and alias policy. Validate an integer 0–100, disjoint matched/missing string lists and original/improved/reason for each rewrite. Check originals against sanitized source. Rewrites must preserve experience, responsibility and metrics. Ask for missing evidence in the reason. *(Documented in `docs/ats-policy.md`; enforced in `lib/contracts.js` & `lib/ats.js`; verified in unit/integration tests.)*
- [x] **Day 3 · B** — Label the score as an estimate for this CV and vacancy in both languages. Render empty keyword groups, long bullets and 3–5 rewrites when supported. Agree sparse-CV handling and test zero, one and two eligible bullets. Preserve valid keyword results and explain the shortfall. *(Verified in `app/page.jsx`, `lib/contracts.js`, unit tests, and Chrome E2E.)*
- [x] **Day 4 · A** — Connect POST /api/analyze-cv to extraction, masking, validated model output and temporary session creation. Issue an opaque sessionId only on success. Have session storage available now for integration. Keep daily quota expiry independent. *(Implemented in `app/api/analyze-cv/route.js` & `lib/store.js` with Upstash Redis REST + in-memory fallback; live Upstash deployment verification tracked under Day 9.)*
- [x] **Day 4 · B** — Connect submit, pending, result and retry on the same dashboard. Prevent duplicate clicks and retain recoverable input. Exercise missing fields, malformed provider JSON, out-of-range scores, timeout and store failure. Never display a fabricated zero score. *(Verified via `app/page.jsx`, `tests/integration-analyze-cv.test.mjs`, and `scripts/check-workspace.cjs`.)*
- [ ] **Day 5 · Both** — Record expected/actual extraction order, preserved skill and bullet, identifier masking, display or recovery, failures and submit-to-visible latency for ten readable layouts: single-column, two-column, sidebar, tables, heavy header/footer, multi-page, education-first, project-heavy, Indonesian and mixed ID/EN. Track invalid files separately. *(Extraction/masking/landmarks/invalid-PDFs passed 10/10 + 2/2 sparse + 4/4 invalid deterministically and offline; live Gemini passed 9/10 readable + 2/2 sparse across runs with 1.8–3.1s healthy single-model latency, but `08-project-heavy` and the `< 8s` distribution target were impacted by upstream Google 503/429 congestion—needs one clean live rerun off peak.)*

## Days 6–8 · Complete five questions and export the result (§§2, 5–7)

- [x] **Day 6 · A** — Prepare five varied, role-level questions in HR and User/Technical modes. Ground questions in the CV and vacancy. Use hypotheticals for missing skills. Review Q1 for HR/ID, HR/EN, Technical/ID and Technical/EN. *(Prompt, validator, and all four fictional Q1 fixtures verified with a stub provider. Live model quality remains unverified.)*
- [x] **Day 6 · B** — Keep analysis visible during setup. Confirm mode/language, show Q1 and focus area, and show progress as question 1 of 5. Opening or canceling setup sends no start request. *(All four configurations verified with stubbed Chrome responses at 375–1440 px. Verified bilingual pending, retry, quota and expiry recovery, fresh-session reanalysis, and duplicate-submit protection. Answer entry, feedback, and advancement are Day 7 work.)*
- [x] **Day 7 · A** — Implement POST /api/interview/start and /api/interview/answer against an active session. Fix mode and language for the run. Validate one integer 1–5 each for clarity, job relevance and evidence/impact plus one actionable tip. Use §6 anchors, STAR for behavioral answers and reasoning/trade-offs/verification for hypotheticals. *(All four configurations and validation verified with stub providers. Live scoring calibration remains unverified.)*
- [x] **Day 7 · Both** — Commit feedback and the next question together. Show the tip before advancing. Replay the same answer and preserve the first accepted answer on conflict. A 409 supplies the current question or completed state. Preserve the draft for recovery and keep the current question available when generation fails. *(Verified with deterministic API tests and stubbed Chrome flows across all four configurations. Q5 shows the last feedback and completion. The report and export remain Day 8 work.)*
- [x] **Day 8 · Both** — Commit Q5 feedback and final summary together, with no Q6. Show Q5 feedback before the summary. Calculate the three averages from all five validated records and display one decimal. Derive strengths from scores and reuse a committed tip as the improvement priority. *(Verified with deterministic tests, concurrent Q5 replay, expiry tests and all four stubbed browser runs.)*
- [x] **Day 8 · B** — Provide one-click copy and UTF-8 download for analysis and completed practice, with selectable text if clipboard access fails. *(The existing CV download remains available from the CV review. Interview copy and download use the sanitized results sent with the completed response and make no additional model call.)*
- [x] **Day 8 · Both** — Verify ID and EN interview downloads against displayed and committed results. *(Chrome decoded actual downloads as UTF-8 and matched clipboard text. Verified five ordered records, localized averages, long answers, line breaks, contact masking and session-token exclusion. Interview exports contain the interview report and transcript. CV export continues separately and was regression-tested.)*

## Days 9–10 · Verify the deployed build (§§5, 8–12)

- [x] **Day 9A · Local implementation and verification** — Acquire fenced ownership before interview generation, reserve start quota, and bound failed attempts. Verified one provider invocation under supported concurrency, replay, shared quota contention, lease expiry and stale-worker protection. **72 tests, seven stubbed Chrome flows and the production build passed.** Reviewed local checkpoint `a6fdb28` on `feature/mock-interview` follows the Days 6–8 checkpoint `4ad895f`.
- [ ] **Day 9A · Production parity pending** — Execute the Redis Lua paths against a disposable Redis instance and verify multi-worker contention, lease loss and quota reset. A timed-out call may continue upstream after lease expiry even though its worker cannot commit. No live Gemini or Upstash verification was performed.
- [x] **Day 9B · Local implementation and verification** — Gate CV parsing with leased admission, cap failed attempts, meter CV and interview HTTP attempts against configurable service budgets, require valid production configuration and trusted Vercel ingress, and bound interview JSON. **80 tests, seven stubbed Chrome flows and the production build passed.** Day 9B is uncommitted over reviewed checkpoint `a6fdb28`.
- [x] **Day 9B · Review and quota remediation** — Reproduced expiry retaining success capacity and budget-only denials exhausting daily admissions. Split expiring holds from committed successes, fenced commit and release by token, removed budget-only admission debits, and added bounded intake checks. **87 Node tests, seven stubbed Chrome flows, the production build, and `git diff --check` passed.** The prior 80 cases remain intact. Redis Lua execution and multi-worker behavior are still pending.
- [x] **Day 9B · Verification recheck** — On `feature/mock-interview` at Day 9A checkpoint `a6fdb28`, all **87** tests, the production build and whitespace checks passed again. The credential-pattern scan found no matches. No code changes were made during the recheck.
- [x] **Day 9B · Local Redis environment** — Resolved the earlier missing-runtime blocker with the approved WSL 2, Ubuntu and Redis Open Source installation.
- [x] **Day 9B · WSL installer launched** — User approved WSL 2, Ubuntu and Redis Open Source. Microsoft’s elevated installer returned exit code 0 with Ubuntu launch disabled.
- [x] **Day 9B · Restart completed** — Windows was restarted with approval, the hypervisor became active, and the Ubuntu setup resumed.
- [x] **Day 9B · Post-restart recovery** — Confirmed the checkpoint and uncommitted Day 9B files, an active Windows hypervisor, and default WSL version 2. `git diff --check` passed and the **87 baseline tests** passed again.
- [x] **Day 9B · Ubuntu registered** — Microsoft’s web-download installation succeeded, and Windows lists Ubuntu as a WSL 2 distribution. Opened the Ubuntu terminal for private account setup.
- [x] **Day 9B · Ubuntu account and Redis verification** — Installed Redis Open Source 8.12.0. Actual Lua passed against a disposable Unix-socket instance with TCP disabled and four independent workers. Verified both quota defects, reservation and ownership fencing, retry accounting, and accelerated Jakarta rollover. Removed the disposable instance after verification. **87 baseline tests and the production build passed.**
- [ ] **Day 9B · Staging verification pending** — Verify Upstash behavior, the direct Vercel header trust boundary, both shared budget windows across deployed instances, and provider free-tier settings. Day 9C–9D and deployment are pending.

Historical local test totals were **34** for the CV checkpoint, **50** for Day 6, **61** for Day 7, **67** for Day 8, **72** for Day 9A, and **80** then **87** for Day 9B. See HANDOFF.md for the changes and verification limits at each milestone.

- [ ] **Day 9 · A** — Configure Upstash Redis session expiry within 1–2 hours (proposed fixed 90 minutes from analysis). Isolate two sessions, preserve expiry on updates and verify that a late model result cannot recreate an expired session.
- [ ] **Day 9 · A** — Enforce independent daily caps of five analyses and three interview starts per IP. Proposed design uses trusted deployment metadata, keyed digests, atomic reservations, release on failure, logical retry IDs and Jakarta calendar-day reset. Exercise concurrency at the last slot, retry after response loss, duplicate active start and daily reset. Answers remain available after the start cap. Session expiry cannot replenish either allowance.
- [x] **Day 9 · B · Local recovery verified** — Exercise all eight §5 recovery cases in ID and EN: invalid input, oversize, wrong type, unreadable PDF, expired session, question conflict, quota and temporary outage. Name the exhausted action and known reset time. Preserve recoverable drafts. Inspect parse/provider failure logs for raw tokens, request bodies, answers and credentials. Local coverage uses seven ID/EN Chrome flows with API stubs plus the synthetic-input Node integration checks. The deployed matrix remains open.
- [x] **Day 9 · B · Local browser accessibility verified** — Complete browse → analyze → answer → advance → copy/export on a narrow screen and by keyboard. Stack rewrites vertically, label controls, show scores in text, check focus at new feedback and avoid horizontal scrolling. Suggested checks include visible focus, contrast and screen-reader announcements for errors and copy status. Local Chrome verified keyboard file selection and analysis in ID/EN, plus answer → advance → copy and export at 375 px. Local contrast passed across 29 axe scans and computed control-color checks. Chrome’s accessibility tree verified persistent alerts, polite survey and copy status, and localized error descriptions. VoiceOver speech testing was skipped at the user’s request. Deployed accessibility remains open.
- [ ] **Day 10 · Both** — Run the entire §10 matrix on Vercel, including all four mode/language combinations through Q5. Try stale and post-completion submissions. Record deployed revision, fixtures, observed results, failures and untested cases. A feature is done when the dashboard action and its recovery work, the contract matches and the owner records evidence.
- [ ] **Both** — Review privacy wording against exercised masking cases and provider retention settings. Explain residual identifiers accurately. Keep accounts, permanent histories/storage, job sourcing/applications, voice/video, mentoring/networking, payments and extra integrations outside the MVP.

## Measurement and decisions (§§11–12)

- [ ] **Both** — Assign a measurement owner and observation window. Report CV evaluation from upload submission to visible validated result. Give sample count, layout, failures, distribution and count under 8 seconds. The guideline supplies no percentile gate.
- [ ] **Both** — Track five-question completions with the summary shown divided by successful Q1 starts for the same cohort. Deduplicate runs and allow active sessions to finish. Target above 70%.
- [ ] **Both** — Collect optional post-session feedback. Report positive submissions divided by all feedback submissions, the response count, and whether the result exceeds 80%. Zero responses leaves satisfaction unknown. Use aggregate or time-boxed pilot counts without personal histories.
- [ ] **Both** — Record decisions as they come due: transport/byte threshold on day 1, parser/provider/scoring on days 1–3, sparse and empty states on days 3–4, mode enums/Q5 schema/averaging/export on days 6–8, TTL/reset/retries on days 8–9 and privacy/measurement wording before launch. When changing a default, update examples, handler, validator, fixture, UI and acceptance checks together.
