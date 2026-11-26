// Browser verification for the dashboard with all API calls stubbed.
// Optionally pass a PDF path as argv[2] to use it instead of the synthetic file.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseUrl = process.env.UPLOAD_BASE_URL || 'http://localhost:3000';
const pdf = process.argv[2] || {
  name: 'fixture.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\nsynthetic upload for intercepted analysis'),
};
const sessionId = 'sess_e2e_secret_token_should_not_export';
const analysis = { sessionId, atsScore: 76, matchedKeywords: ['Python', 'Excel'], missingKeywords: ['SQL'], rewrites: [] };
const jd = 'Data intern requiring Python, Excel, and SQL.';

async function blockUnexpectedApis(page) {
  await page.route('**/api/**', (route) => route.abort());
}

function extractMultipartRequestId(route) {
  const bodyBuf = route.request().postDataBuffer() || Buffer.from('');
  const bodyStr = bodyBuf.toString('utf8');
  const match = bodyStr.match(/name="requestId"\r\n\r\n([^\r\n]+)/);
  return match ? match[1] : null;
}

async function tabTo(page, control) {
  await control.waitFor();
  for (let tabs = 0; tabs < 24 && !await control.evaluate((node) => node === document.activeElement); tabs += 1) {
    await page.keyboard.press('Tab');
  }
  assert.ok(await control.evaluate((node) => node === document.activeElement), 'Control must be reachable by Tab');
  assert.ok(await control.evaluate((node) => {
    const style = getComputedStyle(node.closest('.browse') ?? node);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
  }), 'Keyboard focus must have a visible outline');
  assert.ok(await control.evaluate((node) => {
    const target = node.closest('.browse') ?? node;
    const { left, top, width, height } = target.getBoundingClientRect();
    return target.contains(document.elementFromPoint(left + width / 2, top + height / 2));
  }), 'The focused control must be visible in the viewport and clear of overlays');
}

async function browserAccessibilityNode(client, selector) {
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `Expected ${selector} in the DOM`);
  const { node } = await client.send('DOM.describeNode', { nodeId });
  const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId });
  const accessible = nodes.find((item) => item.backendDOMNodeId === node.backendNodeId);
  assert.ok(accessible && !accessible.ignored, `Expected ${selector} in the accessibility tree`);
  return accessible;
}

async function assertLiveRegion(client, selector, role, priority) {
  const node = await browserAccessibilityNode(client, selector);
  const property = (name) => node.properties?.find((attribute) => attribute.name === name)?.value.value;
  assert.equal(node.role.value, role);
  assert.equal(property('live'), priority);
  assert.equal(property('atomic'), true);
  return node.nodeId;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { INTERVIEW_FIXTURES } = await import('../lib/interview-fixtures.js');
    const { buildInterviewSummary } = await import('../lib/interview-report.js');
    // 1. Deterministic real-analysis UI + recovery + keyboard + §11 feedback + export check (ID & EN, narrow & desktop).
    for (const [width, en] of [[375, false], [1440, true]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      await blockUnexpectedApis(page);
      const votes = [];
      await page.route('**/api/feedback', (route) => {
        votes.push(route.request().postDataJSON());
        if (votes.length === 1) return route.fulfill({ status: 429, json: { error: { code: 'QUOTA_REACHED' } } });
        if (votes.length === 3) return route.fulfill({ status: 410, json: { error: { code: 'SESSION_EXPIRED' } } });
        return route.fulfill({ json: { total: 1, positive: 1, satisfactionRate: 100 } });
      });

      const capturedRequestIds = [];
      let attempt = 0;
      await page.route('**/api/analyze-cv', async (route) => {
        if (route.request().postDataBuffer()?.includes(Buffer.from('filename="unreadable.pdf"'))) {
          return route.fulfill({ status: 422, json: { error: { code: 'PDF_UNREADABLE' } } });
        }
        attempt += 1;
        const requestId = extractMultipartRequestId(route);
        if (requestId) capturedRequestIds.push(requestId);

        if (attempt === 1) {
          // Simulate transient 503 to verify draft preservation, no 0/100 score, and retry with same requestId.
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }),
          });
          return;
        }
        if (attempt === 3 || attempt === 4) {
          await route.fulfill({
            status: 429,
            json: { error: {
              code: 'QUOTA_REACHED',
              action: attempt === 3 ? 'aiBudget' : 'cvIntake',
              resetAt: '2026-11-26T17:00:00Z',
            } },
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: attempt === 2 ? sessionId : sessionId + '_new',
            atsScore: 76,
            matchedKeywords: ['Python', 'Excel'],
            missingKeywords: ['SQL'],
            rewrites: [
              {
                original: 'Built a Python script to clean duplicate rows across weekly CSV exports.',
                improved: 'Wrote a Python script to deduplicate recurring weekly CSV exports.',
                reason: en
                  ? 'Clarifies the deduplication action. Mention row count if known.'
                  : 'Memperjelas tindakan deduplikasi. Sebutkan jumlah baris jika diketahui.',
              },
              {
                original: 'Helped make weekly reports in Excel.',
                improved: 'Contributed to weekly reporting workbooks in Excel.',
                reason: en
                  ? 'Preserves your supporting role and cadence.'
                  : 'Menjaga peran dukungan dan frekuensi pelaporan.',
              },
            ],
          }),
        });
      });

      await page.goto(baseUrl);
      if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();
      const accessibility = await page.context().newCDPSession(page);
      await accessibility.send('Accessibility.enable');
      const pdfAlert = await assertLiveRegion(accessibility, '#pdf-error', 'alert', 'assertive');
      const jdAlert = await assertLiveRegion(accessibility, '#jd-error', 'alert', 'assertive');
      const analyze = page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' });
      const picker = page.locator('#pdf');
      const vacancy = page.locator('#jd');

      // Inline client validation before uploading anything.
      await tabTo(page, analyze);
      await page.keyboard.press('Enter');
      await page.locator('#pdf-error').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'pdf');
      assert.equal(await assertLiveRegion(accessibility, '#pdf-error', 'alert', 'assertive'), pdfAlert);
      const fileDescription = await browserAccessibilityNode(accessibility, '#pdf');
      assert.match(fileDescription.description?.value, en ? /Choose one readable PDF/ : /Pilih satu berkas PDF/);
      for (const [file, copy] of [
        [{ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional CV') },
          en ? /Unsupported file format/ : /Format berkas belum didukung/],
        [{ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5_000_001) },
          en ? /exceeds the 5 MB limit/ : /melebihi batas 5 MB/],
      ]) {
        await picker.setInputFiles(file);
        await page.locator('#pdf-error').getByText(copy).waitFor();
        assert.equal(await picker.getAttribute('aria-invalid'), 'true');
        assert.match(await picker.getAttribute('aria-describedby'), /\bpdf-error\b/);
      }
      assert.equal(attempt, 0);

      // Upload valid PDF + blank JD -> JD field-specific error + focus on #jd.
      await tabTo(page, picker);
      // Enable interception before sending the key so Chrome cannot open a native dialog first.
      await accessibility.send('Page.enable');
      await accessibility.send('Page.setInterceptFileChooserDialog', { enabled: true });
      try {
        const [[chooser]] = await Promise.all([
          once(accessibility, 'Page.fileChooserOpened', { signal: AbortSignal.timeout(5000) }),
          page.keyboard.press('Enter'),
        ]);
        const { node } = await accessibility.send('DOM.describeNode', { backendNodeId: chooser.backendNodeId });
        assert.equal(node.localName, 'input');
        assert.ok(node.attributes.some((attribute, index) => attribute === 'id' && node.attributes[index + 1] === 'pdf'));
      } finally {
        await accessibility.send('Page.setInterceptFileChooserDialog', { enabled: false });
      }
      await picker.setInputFiles(pdf);
      await tabTo(page, analyze);
      await page.keyboard.press('Enter');
      await page.locator('#jd-error').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'jd');
      assert.equal(await assertLiveRegion(accessibility, '#jd-error', 'alert', 'assertive'), jdAlert);
      const jdDescription = await browserAccessibilityNode(accessibility, '#jd');
      assert.match(jdDescription.description?.value, en ? /Paste a non-empty job description/ : /Tempel deskripsi lowongan/);

      await picker.setInputFiles({ name: 'unreadable.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
      await vacancy.fill(jd);
      await tabTo(page, analyze);
      await page.keyboard.press('Enter');
      await page.locator('#api-error').getByText(en ? /We couldn’t read the text/ : /Teks CV belum bisa dibaca/).waitFor();
      await assertLiveRegion(accessibility, '#api-error', 'alert', 'assertive');
      assert.equal(await vacancy.inputValue(), jd);
      assert.equal(await picker.getAttribute('aria-invalid'), 'true');
      assert.match(await picker.getAttribute('aria-describedby'), /\bapi-error\b/);
      assert.equal(await page.locator('[role="meter"]').count(), 0);

      // Fill JD -> submit -> 503 alert (draft retained, zero fabricated score).
      await picker.setInputFiles(pdf);
      await tabTo(page, analyze);
      await page.keyboard.press('Enter');
      await page.locator('#api-error').waitFor();
      assert.equal(await page.locator('#jd').inputValue(), 'Data intern requiring Python, Excel, and SQL.');
      assert.equal(await page.locator('[role="meter"]').count(), 0);

      // Click Retry -> must send identical requestId and render real results + move focus to #analysis-heading.
      await tabTo(page, page.getByRole('button', { name: en ? 'Retry' : 'Coba lagi' }));
      await page.keyboard.press('Enter');
      await page.locator('[role="meter"]').waitFor();
      assert.equal(capturedRequestIds.length, 2);
      assert.equal(capturedRequestIds[0], capturedRequestIds[1], 'Retry must reuse logical requestId');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'analysis-heading');
      assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');

      // Sparse-CV shortfall notice visible (2 rewrites < 3).
      assert.equal(await page.locator('.noticeCard').count(), 1);

      // Verify clipboard fallback & download .txt omit sessionId.
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('denied')) },
        })
      );
      await page.getByRole('button', { name: en ? 'Copy' : 'Salin', exact: true }).first().click();
      const fallbackText = await page.locator('textarea.copyFallback').inputValue();
      const fallback = await browserAccessibilityNode(accessibility, '.copyFallback');
      assert.match(fallback.description?.value, en ? /Clipboard unavailable/ : /Papan klip tidak tersedia/);
      assert.ok(fallbackText.includes('76/100'));
      assert.ok(!fallbackText.includes('sess_e2e_secret_token'));

      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: en ? 'Download .txt' : 'Unduh .txt' }).first().click();
      const download = await downloading;
      const exported = await fs.readFile(await download.path(), 'utf8');
      assert.ok(exported.includes('76/100'));
      assert.ok(!exported.includes('sess_e2e_secret_token'));

      const helpful = page.getByRole('button', { name: en ? 'Helpful' : 'Membantu', exact: true });
      const voteStatus = await assertLiveRegion(accessibility, '.feedbackCard [role="status"]', 'status', 'polite');
      await helpful.click();
      await page.locator('.feedbackError').getByText(en ? /Too many feedback attempts/ : /Terlalu banyak percobaan/).waitFor();
      assert.equal(await assertLiveRegion(accessibility, '.feedbackError', 'status', 'polite'), voteStatus);
      await helpful.click();
      await page.locator('.feedbackThanks').waitFor();
      assert.equal(await assertLiveRegion(accessibility, '.feedbackThanks', 'status', 'polite'), voteStatus);
      assert.deepEqual(votes, Array.from({ length: 2 }, () => ({ sessionId, positive: true, language: en ? 'en' : 'id' })));

      for (const copy of [
        en ? 'AI processing is at capacity' : 'Kapasitas pemrosesan AI penuh',
        en ? 'Too many CV requests' : 'Terlalu banyak permintaan CV',
      ]) {
        await analyze.click();
        await page.locator('#api-error').getByText(copy, { exact: false }).waitFor();
        assert.equal(await page.locator('#jd').inputValue(), jd);
        assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');
      }
      const recovered = page.waitForResponse((response) => response.url().endsWith('/api/analyze-cv') && response.status() === 200);
      await analyze.click();
      await recovered;
      await page.locator('#api-error').waitFor({ state: 'hidden' });
      await helpful.click();
      await page.locator('.feedbackError').getByText(en ? /session has expired/ : /Sesi analisis CV sudah berakhir/).waitFor();
      assert.equal(votes.at(-1).sessionId, sessionId + '_new');
      assert.equal(await helpful.count(), 0);
      assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');
      assert.equal(capturedRequestIds.length, 5);
      assert.notEqual(
        capturedRequestIds[2],
        capturedRequestIds[1],
        'New analysis after 200 OK must generate a fresh requestId'
      );
      assert.equal(
        new Set(capturedRequestIds.slice(1)).size,
        4,
        'Each new submission after 200 OK must send a distinct requestId'
      );

      // Ensure errors and their recovery do not introduce horizontal overflow.
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
      console.log('passed-real-flow', width, en ? 'EN' : 'ID');
      await page.close();
    }

    // 2. Interview start with UI language and interview language independently selected.
    for (const [width, uiEn, language, mode] of [
      [375, false, 'id', 'hrd'],
      [768, false, 'en', 'hrd'],
      [1024, true, 'id', 'user'],
      [1440, true, 'en', 'user'],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await blockUnexpectedApis(page);
      let analyses = 0;
      const analyzeRequestIds = [];
      await page.route('**/api/analyze-cv', (route) => {
        analyses += 1;
        const requestId = extractMultipartRequestId(route);
        if (requestId) analyzeRequestIds.push(requestId);
        return route.fulfill({ json: { ...analysis, sessionId: `${sessionId}_${analyses}` } });
      });
      const starts = [];
      const questions = INTERVIEW_FIXTURES[mode][language].questions;
      const question = questions[0];
      const answers = [];
      const committed = [];
      const rawEmail = 'candidate@example.org';
      const longAnswer = `Saya mencatat tahapan — résumé.\n${'Rincian langkah kerja sama. '.repeat(20)}\nEmail: ${rawEmail}`;
      const suggestion = language === 'en' ? 'Explain how you verified the result.' : 'Jelaskan cara kamu memeriksa hasilnya.';
      let lostFinal;
      let releaseAnswer;
      const heldAnswer = new Promise((resolve) => { releaseAnswer = resolve; });
      await page.route('**/api/interview/answer', async (route) => {
        const body = route.request().postDataJSON();
        if (body.userAnswer === 'Recovery check') {
          if (width === 768) return route.fulfill({ status: 409, json: { error: {
            code: 'QUESTION_CONFLICT', currentQuestion: question, completed: false,
          } } });
          return route.fulfill({ json: {
            feedback: { clarityScore: 4, impactScore: 3, relevanceScore: 5, suggestion },
            nextQuestion: questions[1], resumeQuestion: false, finalSummary: null,
          } });
        }
        answers.push(body);
        if (lostFinal) {
          assert.deepEqual(body, answers.at(-2));
          return route.fulfill({ json: lostFinal });
        }
        if (answers.length === 1) return width === 375 || width === 768 || width === 1024
          ? route.fulfill({
            status: 429,
            json: { error: { code: 'QUOTA_REACHED', action: width === 768 || width === 1024 ? 'aiBudget' : 'interviewGeneration', resetAt: '2026-11-26T17:00:00Z' } },
          })
          : route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE' } } });
        if (answers.length === 2) await heldAnswer;
        if (width === 375 && body.questionNumber === 2) {
          committed.push({
            questionNumber: 2, questionText: questions[1].questionText,
            userAnswer: 'Jawaban diterima dari tab lain.',
            feedback: { clarityScore: 3, relevanceScore: 4, impactScore: 2, suggestion },
          });
          return route.fulfill({
            status: 409,
            json: { error: { code: 'QUESTION_CONFLICT', currentQuestion: questions[2], completed: false } },
          });
        }
        const feedback = {
          clarityScore: body.questionNumber === 5 ? 5 : 4,
          relevanceScore: 5,
          impactScore: body.questionNumber === 5 ? 2 : 3,
          suggestion,
        };
        committed.push({
          questionNumber: body.questionNumber,
          questionText: questions[body.questionNumber - 1].questionText,
          userAnswer: body.userAnswer.replace(rawEmail, '[EMAIL_REDACTED]'),
          feedback,
        });
        const completed = body.questionNumber === 5;
        const payload = {
            feedback,
            nextQuestion: questions[body.questionNumber] ?? null,
            finalSummary: completed ? buildInterviewSummary(committed, language) : null,
            ...(completed ? { mode, transcript: committed } : {}),
        };
        if (completed && width === 1440) {
          lostFinal = payload;
          return route.abort('connectionreset');
        }
        await route.fulfill({ json: payload });
      });
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route('**/api/interview/start', async (route) => {
        starts.push(route.request().postDataJSON());
        if (starts.length === 1 && width === 375) return route.abort('connectionreset');
        if (starts.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE' } } });
        if (starts.length === 2) return route.fulfill({
          status: 429,
          json: { error: { code: 'QUOTA_REACHED', action: 'interviewStart', resetAt: '2026-11-26T17:00:00Z' } },
        });
        if (starts.length === 3) return route.fulfill({ status: 410, json: { error: { code: 'SESSION_EXPIRED' } } });
        await held;
        await route.fulfill({ json: question });
      });

      await page.goto(baseUrl);
      if (uiEn) await page.getByRole('button', { name: 'EN', exact: true }).click();
      await page.locator('#pdf').setInputFiles(pdf);
      await page.locator('#jd').fill(jd);
      await page.getByRole('button', { name: uiEn ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      const panel = page.locator('.interviewBridge');
      const setup = panel.getByRole('button', { name: uiEn ? 'Set up interview' : 'Siapkan wawancara' });
      await setup.click();
      await panel.getByRole('button', { name: uiEn ? 'Cancel' : 'Batal' }).click();
      await setup.waitFor();
      assert.equal(starts.length, 0);

      const en = language === 'en';
      async function activate(control) {
        if (width === 375) {
          await tabTo(page, control);
          await page.keyboard.press('Enter');
        } else {
          await control.click();
        }
      }
      const start = panel.getByRole('button', { name: en ? 'Start interview' : 'Mulai wawancara', exact: true });
      async function selectSettings() {
        await setup.click();
        await panel.getByRole('combobox', { name: uiEn ? 'Interview language' : 'Bahasa wawancara' }).selectOption(language);
        await panel.getByRole('combobox', { name: en ? 'Interview mode' : 'Jenis wawancara' }).selectOption(mode);
      }
      await selectSettings();
      assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');
      await start.click();
      await panel.getByText(en ? /Could not start the interview/ : /Wawancara belum bisa dimulai/).waitFor();
      await panel.getByRole('button', { name: en ? 'Retry' : 'Coba lagi' }).click();
      await panel.getByText(en ? /Daily mock interview start limit reached/ : /Batas harian mulai simulasi wawancara/).waitFor();
      assert.match(await panel.getByRole('alert').innerText(), /WIB/);
      await start.click();
      await panel.getByText(en ? /preparation session has expired/ : /Sesi persiapan 90 menit sudah berakhir/).waitFor();
      assert.equal(await start.isDisabled(), true);
      assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');
      await panel.getByRole('button', { name: en ? 'Run a new CV analysis' : 'Analisis CV ulang' }).click();
      await selectSettings();

      await start.click();
      await panel.getByRole('status').filter({ hasText: en ? /Preparing interview questions/ : /Menyiapkan pertanyaan wawancara/ }).waitFor();
      assert.equal(await start.isDisabled(), true);
      await panel.locator('form').dispatchEvent('submit', { bubbles: true, cancelable: true });
      release();
      const questionHeading = panel.getByRole('heading', { name: question.questionText });
      await questionHeading.waitFor();
      await panel.getByText(question.focusArea, { exact: false }).waitFor();
      await panel.getByText(en ? 'Question 1 of 5' : 'Pertanyaan 1 dari 5').waitFor();
      assert.equal(await questionHeading.evaluate((node) => node === document.activeElement), true);
      assert.equal(await panel.locator('progress').getAttribute('max'), '5');
      await panel.getByText((mode === 'hrd' ? 'HR' : en ? 'Technical' : 'Teknis') + ' · ' + (en ? 'English' : 'Bahasa Indonesia'), { exact: true }).waitFor();
      const draft = panel.locator('#interview-answer');
      const submitAnswer = panel.getByRole('button', { name: en ? 'Submit answer' : 'Kirim jawaban' });
      const next = panel.getByRole('button', { name: en ? 'Next question' : 'Pertanyaan berikutnya' });
      const feedbackHeading = panel.getByRole('heading', { name: en ? 'Answer feedback' : 'Umpan balik jawaban' });
      if (width === 768 || width === 1024) {
        await draft.fill('Recovery check');
        await submitAnswer.click();
        await panel.getByRole('alert').waitFor();
        assert.equal(await draft.inputValue(), 'Recovery check');
        if (width === 768) assert.match(await panel.getByRole('alert').innerText(), /still in the editor/);
        else await panel.getByRole('button', { name: 'Coba lagi' }).waitFor();
      }
      if (width === 375) {
        await tabTo(page, draft);
        await page.keyboard.insertText('First answer draft');
      } else {
        await draft.fill('First answer draft');
      }
      const openExample = page.getByRole('button', { name: uiEn ? 'Open example' : 'Buka contoh' });
      const back = page.getByRole('button', { name: uiEn ? 'Back to your CV review' : 'Kembali ke hasil CV kamu' });
      await openExample.click();
      await back.click();
      assert.equal(await draft.inputValue(), 'First answer draft');
      await activate(panel.getByRole('button', { name: width === 1024 ? 'Coba lagi' : en ? 'Submit answer' : 'Kirim jawaban' }));
      await panel.getByRole('alert').waitFor();
      assert.equal(await draft.inputValue(), 'First answer draft');
      const retry = panel.getByRole('button', { name: en ? 'Retry' : 'Coba lagi' });
      if (width === 375 || width === 768 || width === 1024) {
        const expected = width === 375 ? /Batas pemrosesan wawancara/
          : en ? /AI processing is at capacity/ : /Kapasitas pemrosesan AI penuh/;
        assert.match(await panel.getByRole('alert').innerText(), expected);
        await submitAnswer.click();
      } else {
        await retry.click();
      }
      await panel.getByRole('status').filter({ hasText: en ? 'Evaluating your answer' : 'Menilai jawaban' }).waitFor();
      assert.equal(await draft.isDisabled(), true);
      await panel.locator('form').dispatchEvent('submit', { bubbles: true, cancelable: true });
      if (width === 375) await openExample.click();
      releaseAnswer();
      if (width === 375) await back.click();
      await feedbackHeading.waitFor();
      if (width !== 375) assert.equal(await feedbackHeading.evaluate(node => node === document.activeElement), true);
      await openExample.click();
      await back.click();
      await feedbackHeading.waitFor();
      assert.equal(starts.length, 4);
      await panel.getByText(suggestion).waitFor();
      await panel.getByText(en ? 'Clarity 4/5' : 'Kejelasan 4/5').waitFor();
      await panel.getByText(en ? 'Relevance 5/5' : 'Relevansi 5/5').waitFor();
      await panel.getByText(en ? 'Impact 3/5' : 'Dampak 3/5').waitFor();
      assert.equal(await panel.getByRole('heading', { name: questions[1].questionText }).count(), 0);
      await activate(next);

      for (let number = 2; number <= 5; number += 1) {
        await panel.getByRole('heading', { name: questions[number - 1].questionText }).waitFor();
        await panel.getByText((mode === 'hrd' ? 'HR' : en ? 'Technical' : 'Teknis') + ' · ' + (en ? 'English' : 'Bahasa Indonesia'), { exact: true }).waitFor();
        const answer = number === 5 ? longAnswer : `Draft for question ${number}`;
        if (width === 375) {
          await tabTo(page, draft);
          await page.keyboard.insertText(answer);
        } else {
          await draft.fill(answer);
        }
        await activate(submitAnswer);
        if (number === 5 && width === 1440) {
          await retry.waitFor();
          assert.equal(await draft.inputValue(), longAnswer);
          await retry.click();
        }
        if (number === 2 && width === 375) {
          await panel.getByRole('heading', { name: questions[2].questionText }).waitFor();
          assert.equal(await draft.inputValue(), '');
          await panel.locator('summary').click();
          assert.equal(await panel.getByRole('textbox', { name: 'Draf tersimpan' }).inputValue(), 'Draft for question 2');
          continue;
        }
        await feedbackHeading.waitFor();
        if (number !== 5) await activate(next);
      }
      await panel.getByRole('heading', { name: en ? 'Five questions complete' : 'Lima pertanyaan selesai' }).waitFor();
      assert.equal(await next.count(), 0);
      assert.equal(await draft.count(), 0);
      const reportHeading = panel.getByRole('heading', { name: en ? 'Interview report' : 'Ringkasan wawancara' });
      assert.equal(await reportHeading.count(), 0);
      await activate(panel.getByRole('button', { name: en ? 'View interview report' : 'Lihat ringkasan' }));
      await reportHeading.waitFor();
      assert.equal(await reportHeading.evaluate((node) => node === document.activeElement), true);
      const report = panel.locator('.interviewReport');
      assert.equal(await report.locator('details').count(), 5);
      // The 375px fixture assigns Q2 (3, 4, 2); all other Q1–Q4 scores are (4, 5, 3).
      // Q5 is (5, 5, 2). Use independent expected averages for all three dimensions.
      const expected = width === 375 ? ['4,0', '4,8', '2,6'] : en ? ['4.2', '5.0', '2.8'] : ['4,2', '5,0', '2,8'];
      const labels = en ? ['Clarity', 'Relevance', 'Impact'] : ['Kejelasan', 'Relevansi', 'Dampak'];
      for (const [index, label] of labels.entries()) {
        await report.getByText(`${label} ${expected[index]}/5`, { exact: true }).waitFor();
      }
      for (const [index, record] of committed.entries()) {
        const item = report.locator('details').nth(index);
        assert.match(await item.locator('summary').innerText(), new RegExp(` ${record.questionNumber}\\.`));
        await item.locator('summary').click();
        assert.ok((await item.locator('.interviewReviewAnswer').textContent()).includes(record.userAnswer));
      }
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.copiedInterview = text; } },
      }));
      const copy = report.getByRole('button', { name: en ? 'Copy' : 'Salin', exact: true });
      const accessibility = await page.context().newCDPSession(page);
      await accessibility.send('Accessibility.enable');
      const exportStatus = '.interviewReport .exportStatus';
      const copyStatus = await assertLiveRegion(accessibility, exportStatus, 'status', 'polite');
      await tabTo(page, copy);
      await page.keyboard.press('Enter');
      await report.getByText(en ? 'Copied.' : 'Tersalin.', { exact: true }).waitFor();
      assert.equal(await assertLiveRegion(accessibility, exportStatus, 'status', 'polite'), copyStatus);
      assert.ok(await copy.evaluate((button) => button === document.activeElement));
      const clipboard = await page.evaluate(() => window.copiedInterview);
      const downloadEvent = page.waitForEvent('download');
      await activate(report.getByRole('button', { name: en ? 'Download .txt' : 'Unduh .txt' }));
      const download = await downloadEvent;
      assert.match(download.suggestedFilename(), /\.(txt)$/);
      const bytes = await fs.readFile(await download.path());
      const fileText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      assert.equal(fileText, clipboard);
      for (const record of committed) {
        for (const value of [record.questionText, record.userAnswer, record.feedback.suggestion]) {
          assert.ok(fileText.includes(value));
        }
        assert.match(fileText, new RegExp(`${en ? 'Clarity' : 'Kejelasan'} ${record.feedback.clarityScore}/5`));
      }
      assert.ok(fileText.includes('tahapan — résumé.\nRincian'));
      assert.ok(fileText.includes('[EMAIL_REDACTED]'));
      assert.ok(!fileText.includes(rawEmail) && !fileText.includes(sessionId));
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      }));
      await copy.click();
      assert.equal(await report.locator('.copyFallback').inputValue(), fileText);
      assert.deepEqual(answers.map((body) => body.questionNumber), width === 1440 ? [1, 1, 2, 3, 4, 5, 5] : [1, 1, 2, 3, 4, 5]);
      assert.deepEqual(answers[0], answers[1]);
      assert.ok(answers.every((body) => body.sessionId === `${sessionId}_2`));
      assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '76');
      assert.deepEqual(starts, [1, 1, 1, 2].map((n) => ({
        sessionId: `${sessionId}_${n}`, language, mode,
      })));
      assert.equal(analyzeRequestIds.length, 2);
      assert.notEqual(
        analyzeRequestIds[1],
        analyzeRequestIds[0],
        'Run a new CV analysis after session expiry must generate a fresh requestId'
      );
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      if (process.env.SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `latih-front-${width}.png`) });
      }
      console.log('passed-interview-day9c', width, language, mode);
      await page.close();
    }

    const example = await browser.newPage();
    await blockUnexpectedApis(example);
    let exampleRequests = 0;
    await example.route('**/api/interview/**', (route) => {
      exampleRequests += 1;
      return route.abort();
    });
    await example.goto(baseUrl);
    await example.getByRole('button', { name: 'Buka contoh' }).click();
    await example.getByRole('button', { name: 'Lihat contoh pertanyaan' }).click();
    await example.getByRole('button', { name: 'Tampilkan pertanyaan' }).click();
    const examplePanel = example.locator('.interviewBridge');
    await examplePanel.getByRole('heading', { name: INTERVIEW_FIXTURES.hrd.id.questions[0].questionText }).waitFor();
    assert.equal(await examplePanel.locator('textarea').count(), 0);
    assert.equal(await example.locator('.feedbackCard').count(), 0);
    assert.equal(exampleRequests, 0);
    console.log('passed-offline-example');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
