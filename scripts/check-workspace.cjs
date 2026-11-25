// Browser E2E verification across 375/768/1024/1440px, ID/EN, real CV analysis flow,
// recovery/retry states, keyboard focus, copy fallback, .txt export, §11 feedback, and example interview preview.
// Pass a valid PDF path (e.g., exact 5,000,000-byte PDF from check-upload.mjs) as argv[2].
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseUrl = process.env.UPLOAD_BASE_URL || 'http://localhost:3000';
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/check-workspace.cjs <path-to-valid-pdf>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 1. Deterministic real-analysis UI + recovery + keyboard + §11 feedback + export check (ID & EN, narrow & desktop).
    for (const [width, en] of [[375, false], [1440, true]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const capturedRequestIds = [];
      let attempt = 0;
      await page.route('**/api/analyze-cv', async (route) => {
        attempt += 1;
        const bodyBuf = route.request().postDataBuffer() || Buffer.from('');
        const bodyStr = bodyBuf.toString('utf8');
        const m = bodyStr.match(/name="requestId"\r\n\r\n([^\r\n]+)/);
        if (m) capturedRequestIds.push(m[1]);

        if (attempt === 1) {
          // Simulate transient 503 to verify draft preservation, no 0/100 score, and retry with same requestId.
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: 'sess_e2e_secret_token_should_not_export',
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

      // Inline client validation before uploading anything.
      await page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      await page.locator('#pdf-error').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'pdf');

      // Upload valid PDF + blank JD -> JD field-specific error + focus on #jd.
      await page.locator('#pdf').setInputFiles(pdfPath);
      await page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      await page.locator('#jd-error').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'jd');

      // Fill JD -> submit -> 503 alert (draft retained, zero fabricated score).
      await page.locator('#jd').fill('Data intern requiring Python, Excel, and SQL.');
      await page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      await page.locator('#api-error').waitFor();
      assert.equal(await page.locator('#jd').inputValue(), 'Data intern requiring Python, Excel, and SQL.');
      assert.equal(await page.locator('[role="meter"]').count(), 0);

      // Click Retry -> must send identical requestId and render real results + move focus to #analysis-heading.
      await page.getByRole('button', { name: en ? 'Retry' : 'Coba lagi' }).click();
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
      assert.ok(fallbackText.includes('76/100'));
      assert.ok(!fallbackText.includes('sess_e2e_secret_token'));

      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: en ? 'Download .txt' : 'Unduh .txt' }).first().click();
      const download = await downloading;
      const exported = await fs.readFile(await download.path(), 'utf8');
      assert.ok(exported.includes('76/100'));
      assert.ok(!exported.includes('sess_e2e_secret_token'));

      // Exercise live POST /api/feedback (§11 optional satisfaction widget).
      await page.getByRole('button', { name: en ? 'Helpful' : 'Membantu' }).click();
      await page.locator('.feedbackThanks').waitFor();

      // Keyboard Tab accessibility sanity + zero horizontal overflow.
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
      console.log('passed-real-flow', width, en ? 'EN' : 'ID');
      await page.close();
    }

    // 2. Example preview + 5-step Interview + redactPii + export across 375/768/1024/1440px.
    for (const [width, en, mode] of [
      [375, false, 'hrd'],
      [768, false, 'user'],
      [1024, true, 'hrd'],
      [1440, true, 'user'],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(baseUrl);
      if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();
      if (process.env.SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `latih-front-${width}.png`) });
      }
      await page.getByRole('button', { name: en ? 'Open example' : 'Buka contoh' }).click();
      // Confirm FeedbackCard is NOT shown in fictional example mode (SPEC-LOW-01).
      assert.equal(await page.locator('.feedbackCard').count(), 0);
      await page.locator('select').first().selectOption(mode);
      await page.getByRole('button', { name: en ? 'Start practice' : 'Mulai latihan' }).click();
      for (let i = 0; i < 5; i += 1) {
        await page.locator('#answer').fill(`Fictional answer ${i} contact fake@example.com`);
        await page.getByRole('button', { name: en ? 'View example feedback' : 'Lihat masukan contoh' }).click();
        await page
          .getByRole('button', {
            name: i === 4 ? (en ? 'View summary' : 'Lihat ringkasan') : en ? 'Next question' : 'Pertanyaan berikutnya',
          })
          .click();
      }
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('denied')) },
        })
      );
      await page.getByRole('button', { name: en ? 'Copy' : 'Salin', exact: true }).last().click();
      const fallback = page.locator('textarea[readonly]').last();
      assert.ok((await fallback.inputValue()).includes('[EMAIL_REDACTED]'));
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: en ? 'Download .txt' : 'Unduh .txt' }).last().click();
      const download = await downloading;
      const txt = await fs.readFile(await download.path(), 'utf8');
      assert.ok(!txt.includes('fake@example.com'));
      assert.equal((txt.match(/Fictional answer /g) || []).length, 5);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      console.log('passed-example-flow', width, en ? 'EN' : 'ID', mode);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
