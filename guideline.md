# LatihKerja development guideline

Build one bilingual workspace where an Indonesian job seeker can upload a CV, compare it with a target job description, improve weak bullet points, and practice five interview questions. A successful first visit ends with feedback the candidate can copy or export. The user can start immediately without creating an account.

**Source of scope:** *PRD & Guideline Pengembangan — LatihKerja.docx*, sections 1–10. This guide follows the PRD’s two-person, ten-working-day MVP. **PRD requirement** means the source specifies the behavior. **Working default** means a proposed way to implement or test it. The team may change a default while preserving the requirement. Examples use fictional candidates and roles.

## 1. What to build

| User | What they need to do | What a useful result looks like |
| --- | --- | --- |
| Final-year student or internship seeker | Apply with coursework, projects, or volunteer experience | Feedback shows how existing work relates to an internship. An HR question lets the candidate use a class project as evidence. |
| Fresh graduate from S1, D3, or SMK | Tailor a first CV to an entry-level vacancy | The candidate sees which advertised skills are evidenced in the CV, which are missing, and which bullets they can improve. |
| Early-career worker with 0–2 years of experience | Prepare for a role change or an interview in ID or EN | Technical questions use the candidate’s experience and the target role. Feedback shows how to explain decisions and results. |

| Deliver in the MVP | Defer until after the MVP |
| --- | --- |
| PDF upload up to 5 MB and a field for pasted job description text | Account registration, sign-in, and complex authentication |
| ATS match score from 0 to 100 and matched/missing keyword lists | Long-term user histories, analytics profiles, and permanent document storage |
| Three to five evidence-based bullet rewrites for a CV with sufficient source material | Job boards, job scraping, recruitment agency portals, and automatic job applications |
| Five text questions in HR or User/Technical mode, in Indonesian or English | Voice and video interviews, mentorship, and peer networking |
| Three rubric scores and an improvement tip after each answer, then a final report | Payments, subscriptions, and paywalls |
| One-click copy and summary export of analysis and responses | Additional delivery channels or integrations |

Treat the ATS score as a coaching estimate of alignment between the **submitted CV and the pasted vacancy**. Label it accordingly in both languages. The PRD supplies a score range and keyword outputs. It gives no employer-specific scoring algorithm or guarantee of passing a screening system.

## 2. The one-screen journey

Keep the steps on the same main dashboard. Reveal the next action when its prerequisites are ready. The table is also the first manual walkthrough for each language.

| Step | Candidate action | Dashboard behavior and acceptance check |
| --- | --- | --- |
| Input | Choose a language, drop or browse for one PDF, paste a job description, and select **Analyze CV Now** | Show the selected filename and size locally and let the candidate replace it. A missing file, unsupported file, or blank description has an actionable message. |
| Analysis | Wait for processing, then read the result | Show a pending state and prevent duplicate submission. On success, show a labeled numeric score, both keyword groups, and original/improved/reason for each rewrite. An empty group has a meaningful label. |
| Interview setup | Select **Start Mock Interview**, choose HR or User/Technical, and confirm ID or EN | Place setup directly below the review. Keep the CV result available. Opening the options alone does not consume an interview. |
| Practice | Answer one question at a time | Show the mode, language, and progress such as “Question 2 of 5.” After submission, show the three scores and one improvement tip. Let the candidate read them before advancing. |
| Completion | Submit the fifth answer and review the report | Show feedback for Q5, then the overall performance and summary. Make the questions, answers, and feedback available for copy/export. The interview ends here. |

**Working UI defaults.** Keep scoring, hints, validation, loading states, quotas, expiry, and export headings in the selected language. Use a visible file-picker button alongside drag and drop. Make controls keyboard-accessible, move focus to new feedback when appropriate, and show scores as text alongside color. On a narrow screen, stack original and improved bullets vertically so both can be read. During a recoverable submission error, retain the candidate’s draft in the current page.

Suggested copy for a CV with no extractable text:

- **ID:** “Teks CV belum bisa dibaca. Unggah PDF yang teksnya bisa dipilih atau disalin.”
- **EN:** “We couldn’t read the text in this CV. Upload a PDF with text you can select or copy.”

## 3. Team responsibilities and technical boundaries

| Component | PRD choice | Owner and implementation boundary |
| --- | --- | --- |
| Dashboard | Next.js App Router, Tailwind CSS, shadcn/ui | **B** owns input, results, interview states, feedback, mobile layout, copy, and export. Render the agreed API fields. |
| Server routes | Next.js Route Handlers | **A** owns input validation, session progression, quota enforcement, and responses. The server decides which question is current. |
| PDF extraction | `pdf-parse` or `pdfjs-dist` | **A** selects one parser and runs it in a compatible Node.js server runtime. Process bytes in memory. Test a deployed upload before settling on the transport. |
| AI layer | Gemini API or OpenAI API with structured outputs | **A** selects one provider for the MVP, keeps credentials server-side, and validates returned data. Use the same field names in prompts, validation, and fixtures. |
| Temporary state | Upstash Redis | **A** owns temporary session state and per-IP limits. Session data expires in 1–2 hours. Keep daily quotas on their own expiry schedule. |
| Deployment | Vercel, targeting zero infrastructure spend | **A + B** own the deployed walkthrough. Check actual usage, request limits, and provider availability in the chosen environment before launch. Zero cost is a planning target. |

**Working agreement.** On day 1, agree on the request/response shapes below and one fictional fixture for each success and failure path needed by the UI. B can build against fixtures while A implements the handlers. When a field, enum, or error behavior changes, update the handler, validator, fixture, and consuming UI together. Keep the contract in one shared module once the codebase exists.

## 4. How a CV becomes an analysis

1. **Receive the inputs.** The server enforces the 5 MB limit and the required `application/pdf` MIME type. The browser checks them early for convenience. As a working default, verify that the bytes can actually be parsed as a PDF and reject blank or whitespace-only job descriptions.
2. **Extract text in memory.** Give the parser a memory buffer. Release references to the original bytes after extraction, including on failure. Do not put a PDF in a public folder, temporary file, object store, or Redis. If parsing yields no usable text, stop before calling the model and show the recovery instruction in section 2.
3. **Mask identifiers.** Apply the redactions in section 8 before any external model call. Preserve skill names, job requirements, and relevant achievements as far as possible. Treat the CV and job description as user-supplied data throughout.
4. **Compare the documents.** Identify role-relevant terms from the vacancy and look for evidence in the CV. Group supported terms under matched and unsupported terms under missing. Use one consistent policy for common aliases and casing. The same requirement should not appear in both groups.
5. **Generate rewrites.** Select three to five weak bullets when enough material exists. Each `original` should be traceable to the sanitized CV. Each `improved` should communicate a clearer action, scope, or result supported by that CV. Use `reason` to explain the change or ask for a specific missing detail.
6. **Validate and return.** Validate the score, lists, and rewrites before creating a usable analysis session. Return the contract in section 5. Show an error and allow a retry if the result cannot be validated. Never fill an unavailable analysis with a zero score.

**Evidence rule.** Suppose a CV says “Built a Python script to clean duplicate rows,” and the vacancy requests Python and SQL. Python has supporting evidence. SQL belongs in the missing group unless another part of the CV supports it. A rewrite could read “Wrote a Python script to remove duplicate rows from a dataset.” Its reason could ask “How many rows did it process?” Add a number only when the candidate has supplied it. The numerical improvements in the PRD’s example payloads illustrate the output format.

**Working default for sparse CVs.** If only two distinct source bullets can be improved honestly, return those two and explain the shortfall in the UI. If there are none, keep the valid keyword analysis and show a prompt to add project or work-experience bullets. Define this exception in the validator and tests so a thin CV cannot trigger fabricated experience. The normal target remains three to five.

## 5. API contracts and shared examples

The PRD names three POST routes. Preserve its success-field spelling and casing. The examples below are fixtures, including a complete three-rewrite response. The PRD demonstrates `en` and `hrd`. Adopt `id` for Indonesian and `user` for User/Technical as working defaults. Map these values to human-readable labels in the UI.

### POST /api/analyze-cv

The PRD shows a JSON text contract and also requires a server-parsed PDF. **Working transport choice:** accept a multipart form on this route for the browser upload, using `file`, `jobDescription`, and `language`. After validation and parsing, call the same analysis function that handles the PRD’s JSON shape below. If JSON is exposed to clients, it receives the same text limits, redaction, and quota checks. A multipart request should invoke the service in-process once. The team should verify the full 5 MB upload on the deployed route on day 1. If a host request ceiling interferes, revisit the transport while keeping the same user limit, memory-only handling, and results contract.

**Text request from the PRD**

```json
{"cvText":"Built a Python script to clean duplicate rows. Helped make weekly reports in Excel. Wrote instructions for the reports.","jobDescription":"Data intern. Python, Excel and SQL required.","language":"en"}
```

**200 response**

```json
{
  "sessionId": "sess_example",
  "atsScore": 68,
  "matchedKeywords": ["Python", "Excel"],
  "missingKeywords": ["SQL"],
  "rewrites": [
    {"original":"Built a Python script to clean duplicate rows.","improved":"Wrote a Python script to remove duplicate rows.","reason":"Names the tool and the operation. Add dataset size if known."},
    {"original":"Helped make weekly reports in Excel.","improved":"Contributed to weekly reporting in Excel.","reason":"Keeps the reporting frequency and your level of responsibility."},
    {"original":"Wrote instructions for the reports.","improved":"Documented how to prepare the reports.","reason":"Clarifies the purpose of the instructions. Mention the audience if known."}
  ]
}
```

Validate an integer `atsScore` from 0 through 100, string arrays for both keyword groups, and nonblank strings for each rewrite field. The server issues the opaque `sessionId` after a successful analysis. The client reuses it for both interview routes.

### POST /api/interview/start

```json
{"sessionId":"sess_example","mode":"hrd","language":"en"}
```

```json
{"questionNumber":1,"questionText":"Tell me about a time you helped someone use one of your weekly reports.","focusArea":"Communication and teamwork"}
```

Require a live analysis session, a supported mode and language, and remaining interview quota. Initialize Q1 using the sanitized CV and vacancy. Display the returned question and focus area. **Working default:** if the same session already has an active interview, a duplicate start returns its current question and consumes no second quota unit. Keep mode and interview language fixed for the active run.

### POST /api/interview/answer

```json
{"sessionId":"sess_example","questionNumber":1,"userAnswer":"I wrote instructions for the weekly report so my teammate could prepare it."}
```

**200 response for Q1–Q4**

```json
{
  "feedback":{"clarityScore":4,"relevanceScore":4,"impactScore":3,"suggestion":"Explain which step confused your teammate and how you checked whether the instructions helped."},
  "nextQuestion":{"questionNumber":2,"questionText":"How did you decide which tasks to prioritize while preparing the report?"},
  "finalSummary":null
}
```

**200 response for Q5.** The PRD requires a final report but leaves its exact shape open. Use this working contract for frontend/backend integration. The averages summarize all five answers. Keep the five question/answer/feedback records available in the current session for export.

```json
{
  "feedback":{"clarityScore":4,"relevanceScore":5,"impactScore":3,"suggestion":"Add one observed outcome from the example."},
  "nextQuestion":null,
  "finalSummary":{
    "questionsAnswered":5,
    "averageScores":{"clarity":4.0,"relevance":4.2,"impact":3.2},
    "strengths":["You explained your role and tied your examples to the vacancy."],
    "nextSteps":["Practice closing each answer with a result you can verify."]
  }
}
```

### Error behavior

The PRD leaves error codes open. Use the following mapping as the working contract. A consistent error body such as `{"error":{"code":"SESSION_EXPIRED"}}` lets B render localized recovery instructions. Avoid returning exceptions, provider payloads, CV excerpts, or identifiers in error details.

| Condition | Suggested status and code | Next action in the UI |
| --- | --- | --- |
| Blank required input or invalid enum | 400 · `INVALID_INPUT` | Highlight the field and retain the other entries. |
| File exceeds the shared 5 MB threshold | 413 · `FILE_TOO_LARGE` | Ask for a smaller PDF. |
| Wrong file type | 415 · `UNSUPPORTED_FILE` | Ask for a PDF. |
| Protected, damaged, image-only, or unreadable PDF | 422 · `PDF_UNREADABLE` | Request a readable, text-based copy. |
| Interview request after expiry | 410 · `SESSION_EXPIRED` | Explain that the temporary session ended and offer a new analysis. |
| Out-of-order answer or conflicting resubmission | 409 · `QUESTION_CONFLICT` | Keep the draft and show the server’s current step. |
| Daily limit reached | 429 · `QUOTA_REACHED` | Name the affected action and give the reset time if known. |
| Provider timeout, invalid model response, or unavailable session store | 503 · `TEMPORARILY_UNAVAILABLE` | Preserve current progress and offer a retry. |

## 6. Interview progression and scoring

**HR mode** draws from motivation, culture fit, teamwork, conflict, and career development. Use a CV detail and a role requirement to ground the question when possible. For the data intern fixture, an HR question could ask how the candidate explained a report to a teammate.

**User/Technical mode** draws from domain skills, problem solving, architecture or design choices, tools, and case scenarios. For the same fixture, ask how the candidate decided which rows were duplicates. If the vacancy lists a missing skill, use a clearly hypothetical question so the candidate can discuss how they would approach it. Match difficulty to the target role and vary the five questions.

**Working state model**

| Current state | Event | Server behavior |
| --- | --- | --- |
| Analysis ready | Valid start | Set mode/language, create Q1, consume one interview start. |
| Awaiting answer N | Valid answer to N, with N from 1 to 4 | Score the answer, save the feedback and Q(N+1) together, and return them. The client reveals Q(N+1) after feedback. |
| Awaiting answer 5 | Valid fifth answer | Save fifth feedback and the final summary together, then mark the interview complete. |
| Same answer is retried after response loss | Same session, number, and answer | Return the previously committed result. A retry must not skip a question or change the score. |
| Two different answers arrive for one question | One submission has already committed | Keep the first accepted answer and return a conflict for the other. |
| Generation or validation fails | No complete result available | Leave the current question available for retry. |
| Session expires | Interview action arrives | Discard expired context and show the expiry recovery state. |

Enforce the current question number on the server. As a working implementation, commit a transition conditionally against the expected session version and give it the same expiry as the session. Disable repeat clicks on the client for feedback speed. Server-side checks must also handle concurrent submissions and dropped connections.

### Per-answer rubric

The PRD requires one integer from 1 to 5 for each dimension and one concise improvement tip. Use these working calibration anchors. Use 2 and 4 when evidence falls between neighboring anchors.

| Dimension | 1 | 3 | 5 |
| --- | --- | --- | --- |
| **Communication clarity** | The listener cannot follow the answer or identify the candidate’s point. | The main point is understandable, with a gap in sequence or ownership. | The answer explains the situation and the candidate’s actions in a clear, logical order. |
| **Job relevance** | The answer misses the question and target role. | It addresses the question but connects loosely to the role or its constraints. | It directly answers the question and connects the example or reasoning to a concrete job requirement. |
| **Concrete evidence and impact** | No specific action or outcome is given. | An action is described, with limited detail about its outcome. | A specific action and credible result support the claim. Use a verified metric where available, or an observable qualitative outcome. |

For behavioral questions, use STAR (Situation, Task, Action, Result) to identify the missing piece. For a hypothetical technical question, assess the proposed reasoning, trade-offs, and how the candidate would check the outcome. Keep feedback in the chosen language and suggest one actionable change for the next attempt. Compute the final per-dimension averages from the five validated score records. As a display default, round only the final averages to one decimal place.

## 7. Copy and export

Provide one-click copy for the analysis and completed interview. A working default for export is a downloadable UTF-8 plain-text report generated from the current results. This keeps the feature usable on mobile and needs no permanent server file.

| Report section | Include |
| --- | --- |
| CV review | ATS match score out of 100, matched/missing keywords, original and improved bullets, and reasons |
| Interview overview | Selected mode, language, question count, overall rubric results, strengths, and next steps |
| Practice transcript | Five questions in order, the corresponding answers, three scores out of five, and the tip for each answer |

Export sanitized text. Omit the original PDF, contact details, internal session IDs, and provider metadata. Copy and export should work from the results already displayed without another model call. If clipboard permission fails, offer selectable text or the download. Verify Indonesian text, line breaks, empty keyword groups, and long answers in an actual exported file.

## 8. Privacy, session lifetime, and quotas

The PRD identifies Indonesia’s UU PDP as the project’s privacy context. Implement and test the controls below. Describe their measured behavior accurately in the UI and portfolio. A successful masking test demonstrates coverage of that fixture. A claim about legal compliance or an external provider’s retention requires separate evidence.

| Data | Required or proposed handling | Verification |
| --- | --- | --- |
| Raw PDF and extracted text | **PRD:** parse the PDF in RAM, release it after parsing, and mask identifiers before external processing. **Default:** keep raw extracted text request-local and discard it after sanitization. | Inspect successful and failed upload paths. A test provider should receive only sanitized text. |
| Email | Replace with `[EMAIL_REDACTED]`. | Use a fictional address such as `sample@example.com` in a dedicated fixture. |
| Phone | Replace with `[PHONE_REDACTED]`. | Test fictional local and international formats, including spaces and hyphens. |
| NIK, national ID, birthdate | Replace with `[IDENTITY_REDACTED]`. | Test labeled identifiers and dates of birth alongside a graduation year and employment dates that should survive. |
| Home address | Replace with `[ADDRESS_REDACTED]`. | Test Indonesian and English address labels, line breaks, and a nearby job title that should survive. |
| Job description, interview answers, and model output | **Default:** extend the same masking to pasted text and answers before provider calls or session storage. Filter free-text results for identifiers before display/export. | Put a synthetic contact detail in each input independently and inspect the provider request, session record, and export. |
| Temporary session | **PRD:** Redis expiry of 1–2 hours. **Default:** use a fixed 90-minute expiry starting at analysis creation. Retain only sanitized context, results, and the interview state needed until then. | Advance a test clock across expiry and confirm subsequent requests cannot recover the session. Ensure updates preserve the expiry. |
| Logs and diagnostics | **Default:** record route, outcome code, elapsed time, and aggregate counts. Keep document text, answers, request bodies, credentials, and raw session tokens out of logs. | Trigger parsing and provider failures and inspect log output using synthetic inputs. |

Use server-side regex masking as specified in the PRD. Include mixed Indonesian/English fixtures and inspect both missed identifiers and accidental removal of technical evidence. Names, unusual address formats, and identifying details in free text may survive these four redactions. Describe exactly which identifiers are masked in user-facing privacy copy. Check the chosen model provider’s retention settings before publishing any end-to-end retention promise.

### Daily limits

The PRD sets **5 CV analyses and 3 mock interview starts per IP per day**. These are independent allowances. The five answers within an interview share its start allowance. A session expiring must not reset either daily allowance.

Working defaults for A and B to agree before integration:

- Derive the client address from trusted deployment metadata. Use a server-keyed digest as the quota key, with separate counters for analysis and interview start. Keep raw addresses out of product telemetry.
- Use an explicit reset rule. A calendar day in Asia/Jakarta is a practical choice for the target audience. Display a matching local reset time for a quota error.
- Validate inputs before reserving quota or calling the model. Reserve capacity atomically so simultaneous requests cannot exceed the cap. Commit a successful operation once. Release a failed reservation when no usable result was produced.
- Reuse a logical request identifier for retries if the UI can submit the same analysis more than once. Record the result of a completed operation temporarily so a lost HTTP response cannot consume a second unit.
- Show which limit was hit. Someone on a shared campus network may hit a per-IP limit even on their first visit. Upload validation errors, revealing interview options, and answer submissions should consume no interview starts.

## 9. Ten-day delivery plan

The schedule and ownership follow PRD section 9. Each day's handoff below is a proposed way to tell whether the next task can begin. A owns backend/AI and B owns frontend/UX.

| Day | A | B | Handoff or acceptance evidence |
| --- | --- | --- | --- |
| 1 | Set up Next.js, server environment variables, provider access, and a deployment smoke test. | Set up Tailwind, shadcn/ui, the single-page shell, and bilingual controls. | Together agree API fixtures, error codes, and upload transport. Verify the chosen deployment can accept a file at the agreed 5 MB boundary. |
| 2 | Implement in-memory PDF extraction and masking. | Implement file drop/browse, replace, size validation, and job-description input. | Demonstrate readable, oversized, and unreadable fixtures. The model-bound text for the readable fixture is sanitized. |
| 3 | Build the ATS prompt and output validator. | Render score, keyword groups, and rewrites using fixtures. | Review one English and one Indonesian result together. Check empty groups, long bullets, and source evidence. |
| 4 | Wire the analysis route to the real pipeline. | Connect submit, loading, result, error, and retry states. | An upload reaches the analysis view on the same dashboard. A failed call can be retried. |
| 5 | Inspect extraction, redaction, and output for ten sample layouts. | Walk each sample through the dashboard and record recovery or display issues. | Keep a ten-row test record with expected/actual outcomes and observed end-to-end timings. |
| 6 | Build question prompts for both modes and languages. | Build the five-step interview UI with staged fixtures. | Review sample Q1s in all four mode/language combinations for role and language fit. |
| 7 | Implement interview start/answer routes, rubric validation, and progression. | Implement per-answer feedback, tips, retry, and next-question controls. | A submitted answer returns three valid scores and one tip. A duplicate submission advances the session only once. |
| 8 | Integrate all five transitions and final aggregation. | Connect Q5 feedback, final summary, copy, and export. | Complete one uninterrupted run. Match each exported answer and summary average to the five stored feedback records. |
| 9 | Configure Redis expiry and per-IP limits in the deployment environment. | Refine mobile layout, bilingual errors, copy confirmation, and clipboard fallback. | Demonstrate a quota error, an expired session, and a successful mobile export. |
| 10 | Verify deployment settings, provider configuration, and backend recovery paths. | Perform the final user walkthrough and resolve launch-blocking UX issues. | Together run section 10 on the Vercel deployment, record outstanding issues, and confirm which targets were actually measured. |

## 10. Test matrix and release checks

Use fictional CVs, vacancies, and responses. For the day-5 ten-layout check, build a set with known text landmarks so extraction errors are visible. Suggested layouts are single-column, two-column, sidebar, table-based, header/footer-heavy, multi-page, education-first, project-heavy, Indonesian-language, and mixed ID/EN. Put a skill, a bullet, and a synthetic identifier in each. Check reading order, retained evidence, and redaction. Keep invalid-file cases separate from these ten readable layouts.

| Area | Exercise | Expected result |
| --- | --- | --- |
| Upload boundary | Submit a PDF just below, exactly at, and just above the chosen 5 MB threshold from the deployed UI. | The first two reach parsing. The third gets a size error. Browser and server agree on the byte threshold. |
| Input recovery | Try a blank JD, mislabeled file, corrupt PDF, password-protected PDF, and scanned PDF without extractable text. | Each has an actionable recovery state. No analysis session or model call is created for a rejected input. |
| ATS accuracy | Use a known CV/JD pair with matched skills, a missing skill, and a bullet with no metric. | Lists distinguish evidence from gaps. The rewrite preserves facts. Score is in range. |
| Output validation | In a provider stub, omit a required field, return an out-of-range score, and return malformed JSON. | No invalid result reaches the UI. Progress and quota follow the documented failure behavior. |
| Interview coverage | Complete HR/ID, HR/EN, User/ID, and User/EN runs. | Each run has five contextual questions in the selected language, five feedback records, and one final report. |
| Order and retry | Double-submit, retry after a lost response, send a stale question number, and submit again after Q5. | No skipped step, overwritten answer, duplicate quota charge, or Q6. Already committed results remain consistent. |
| Session separation and expiry | Use two separate session IDs and advance one beyond its TTL. | Inputs and results stay isolated. The expired session offers recovery. Its expiry does not restore the daily allowance. |
| Quotas | Exhaust five analyses and three starts separately, including simultaneous requests near a limit. | The next action of that type receives 429. Answers to a previously started live interview remain available. |
| Mobile and keyboard | Use browse, analyze, answer, advance, copy, and export on a narrow viewport and by keyboard. | Controls are reachable and labeled, feedback is readable, and horizontal scrolling is unnecessary for the main journey. |
| Export and privacy | Compare the file with the displayed analysis and all five answers. Inspect provider input, session records, and logs with test identifiers. | Export contains all intended sections and both language variants work. Sensitive fields follow the handling rules in section 8. |

**Definition of done for a feature:** the intended user can complete its main action through the dashboard, its documented failure state is recoverable, frontend and backend agree on the contract, and the owner records the relevant checks. For launch, complete the entire path on the deployed build. Mark untested cases and unmet targets explicitly.

## 11. Measuring success

| PRD metric | Calculation or timing boundary | Evidence to retain |
| --- | --- | --- |
| CV evaluation **under 8 seconds** end to end | Start when the user submits the upload. Stop when the validated result is visible. Include upload, extraction, redaction, model call, validation, and rendering. | Record sample count, layout, latency, and failures. Report the distribution and how many met the target. The PRD specifies no percentile. |
| Interview completion **above 70%** | Completed five-question runs that reach the summary divided by started runs, times 100. Use the same cohort and allow time for active sessions to finish. | Count a start when Q1 is successfully issued and a completion when the summary is shown. Count each run once. |
| Positive satisfaction **above 80%** | Positive post-session feedback submissions divided by all submitted feedback, times 100. | Use a small optional feedback widget. Report the total responses with the percentage. Zero responses means there is no satisfaction estimate yet. |

Prefer aggregate counts or a time-boxed pilot tally. The PRD excludes long-term individual histories. Keep CVs, answers, and contact data out of measurement. The PRD’s résumé bullets illustrate possible future claims. Report measured latency, schema pass rates, masking coverage, and accessibility results with their test conditions. The “under 5 seconds” résumé example is distinct from the product’s under-8-second end-to-end target.

## 12. Decisions to record during implementation

| When | Decision | Working starting point | Evidence that settles it |
| --- | --- | --- | --- |
| Day 1 | Upload encoding and exact byte threshold | Multipart browser upload, in-memory Node parser, shared size constant. Interpret 5 MB as 5,000,000 bytes unless the team records a different convention. | A boundary-size PDF succeeds through the deployed dashboard. |
| Days 1–3 | Parser, model provider, and ATS scoring policy | Choose one parser and one provider. Document how the score balances job requirements, CV evidence, and common aliases. | The same fictional CV/JD pair produces intelligible, comparable feedback in ID and EN. |
| Days 3–4 | Sparse CVs and empty keyword groups | Use the exceptions in section 4 and the empty states in section 2. | A short CV with only two bullets produces useful feedback without invented content. |
| Days 6–8 | Mode enum, Q5 schema, aggregation, export format | Use `hrd`/`user`, the Q5 fixture in section 5, per-dimension averages, and UTF-8 plain text. | The handler, UI, and exported report agree on the same completed run. |
| Days 8–9 | Exact session TTL, quota reset, retries | Use 90 minutes from analysis, a Jakarta calendar-day reset, and one logical charge per successful operation. | Expiry, reset, and concurrent-retry tests match the user-visible messages. |
| Before launch | Measurement and privacy wording | Document observed results, the chosen provider settings, and which masking cases were exercised. | Both teammates can trace each public claim to a test, configuration, or measured result. |

When the team changes a default, update the affected example, acceptance check, and corresponding code in the same change. Use the original PRD section to resolve scope questions: sections 1–4 cover users and flow, 5–7 cover rubrics and architecture/contracts, 8 covers privacy and access, 9 assigns the sprint, and 10 sets product metrics.
