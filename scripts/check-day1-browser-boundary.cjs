// Day 1 Browser UI 5 MB Boundary Verification (guideline.md §§5, 10, 12; CHECKLIST.md Day 1).
// Generates real exact-byte PDFs (4,999,999 / 5,000,000 / 5,000,001 B), exercises them through the
// real browser UI (no route interception) in ID and EN, verifies multipart overhead reaches the
// server RAM parser for <= 5,000,000 B, and verifies 5,000,001 B gets a size error in browser & server.
// Reusable against a deployed URL via UPLOAD_BASE_URL=https://...
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_PDF_BYTES = 5_000_000;
const baseUrl = process.env.UPLOAD_BASE_URL || 'http://127.0.0.1:3000';

function buildExactSizePdf(size) {
  const lines = [
    'Nadia Putri - Data Analyst Intern',
    'SKILLS: Python, Excel',
    '- Built a Python script to clean duplicate rows.',
    '- Helped make weekly reports in Excel.',
    '- Wrote instructions for the reports.',
  ];
  const stream =
    'BT /F1 12 Tf 50 740 Td ' +
    lines.map((l, i) => (i === 0 ? `(${l}) Tj` : `0 -18 Td (${l}) Tj`)).join(' ') +
    ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let body = '%PDF-1.4\n';
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (const [i, obj] of objects.entries()) {
    table += String(body.length).padStart(10, '0') + ' 00000 n \n';
    body += i + 1 + ' 0 obj\n' + obj + '\nendobj\n';
  }
  table += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n';
  const end = '\n%%EOF\n';
  const offset = size - table.length - 7 - end.length;
  const bytes = body.padEnd(offset, ' ') + table + offset + end;
  assert.equal(bytes.length, size);
  return Buffer.from(bytes, 'latin1');
}

(async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latihkerja-day1-boundary-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const files = {};
    for (const size of [MAX_PDF_BYTES - 1, MAX_PDF_BYTES, MAX_PDF_BYTES + 1]) {
      const filePath = path.join(tmpDir, `boundary-${size}.pdf`);
      await fs.writeFile(filePath, buildExactSizePdf(size));
      const stat = await fs.stat(filePath);
      assert.equal(stat.size, size);
      files[size] = filePath;
    }

    const diagnostic = await fetch(new URL('/api/upload-proof', baseUrl), { method: 'POST' });
    assert.equal(diagnostic.status, 404, 'Upload diagnostic must not be publicly callable');

    // Exercise the application-level size check on the real upload endpoint.
    const overBuf = await fs.readFile(files[MAX_PDF_BYTES + 1]);
    const form = new FormData();
    form.append('file', new Blob([overBuf], { type: 'application/pdf' }), 'boundary-5000001.pdf');
    form.append('jobDescription', 'Data intern requiring Python, Excel, and SQL.');
    form.append('language', 'en');
    const res = await fetch(new URL('/api/analyze-cv', baseUrl), { method: 'POST', body: form });
    assert.equal(res.status, 413, 'Expected 413 on /api/analyze-cv for 5,000,001 B');
    assert.equal((await res.json()).error?.code, 'FILE_TOO_LARGE');
    console.log('server-oversize-pass', '/api/analyze-cv', res.status, 'FILE_TOO_LARGE');

    // 2. Real Browser UI checks in ID (4,999,999 B & 5,000,001 B) and EN (5,000,000 B & 5,000,001 B).
    for (const [lang, validSize] of [
      ['id', MAX_PDF_BYTES - 1],
      ['en', MAX_PDF_BYTES],
    ]) {
      const en = lang === 'en';
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const networkCalls = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/analyze-cv')) networkCalls.push(req.method());
      });

      await page.goto(baseUrl);
      if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();

      // A. Above boundary (5,000,001 B): must show client-side size error and fire 0 requests.
      await page.locator('#pdf').setInputFiles(files[MAX_PDF_BYTES + 1]);
      const errText = await page.locator('#pdf-error').textContent();
      assert.equal(errText?.trim(), en
        ? 'This PDF exceeds the 5 MB limit. Choose a smaller PDF file.'
        : 'Ukuran PDF melebihi batas 5 MB. Pilih berkas PDF yang lebih kecil.');
      assert.equal(networkCalls.length, 0, 'Oversize file must be rejected before network upload');
      console.log('browser-oversize-pass', lang, MAX_PDF_BYTES + 1, errText.trim());

      // B. Valid boundary (4,999,999 B or 5,000,000 B) + JD (multipart overhead > 5,000,000 B):
      // Submit through the real browser UI with NO route mocking and inspect actual server HTTP response!
      await page.locator('#pdf').setInputFiles(files[validSize]);
      assert.equal(await page.locator('#pdf-error').textContent(), '', 'Valid boundary file must pass client validation');
      const dropText = await page.locator('.drop').textContent();
      assert.ok(dropText.includes(`boundary-${validSize}.pdf`), 'Drop zone must display selected filename');

      await page.locator('#jd').fill('Data intern requiring Python, Excel, and SQL.');
      const responsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/analyze-cv') && res.request().method() === 'POST',
        { timeout: 25_000 }
      );
      await page.getByRole('button', { name: en ? 'Analyze CV Now' : 'Analisis CV Sekarang' }).click();
      const apiRes = await responsePromise;
      const status = apiRes.status();
      const payload = await apiRes.json().catch(() => null);

      assert.equal(status, 200, `Could not verify analysis for ${validSize} B (HTTP ${status}, ${payload?.error?.code ?? 'no app error code'})`);
      assert.ok(Number.isInteger(payload?.atsScore), 'Expected valid atsScore on 200');
      await page.locator('[role="meter"]').waitFor({ timeout: 5_000 });
      console.log('browser-boundary-pass', lang, validSize, 'HTTP 200', 'score=' + payload.atsScore);

      await page.close();
    }

    if (process.argv.includes('--interview-replay')) {
      const page = await browser.newPage();
      try {
        await page.goto(baseUrl);
        await page.getByRole('button', { name: 'EN', exact: true }).click();
        await page.locator('#pdf').setInputFiles(files[MAX_PDF_BYTES]);
        await page.locator('#jd').fill('Data intern requiring Python, Excel, and SQL.');
        await page.getByRole('button', { name: 'Analyze CV Now' }).click();
        const panel = page.locator('.interviewBridge');
        await panel.getByRole('button', { name: 'Set up interview', exact: true }).click();
        await panel.getByRole('button', { name: 'Start interview', exact: true }).click();

        const answer = 'Name: Nadia Kartika. During my internship, I built a Python dashboard.';
        const submit = panel.getByRole('button', { name: 'Submit answer', exact: true });
        await panel.locator('#interview-answer').fill(answer);
        let committed;
        let sent;
        await page.route('**/api/interview/answer', async (route) => {
          sent = route.request().postDataJSON();
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          committed = await response.json();
          await route.abort('connectionreset');
        }, { times: 1 });
        await submit.click();
        const retry = panel.getByRole('button', { name: 'Retry', exact: true });
        await retry.waitFor();
        assert.equal(await panel.locator('#interview-answer').inputValue(), answer);
        const replay = page.waitForResponse((res) => res.url().endsWith('/api/interview/answer') && res.status() === 200);
        await retry.click();
        assert.deepEqual(await (await replay).json(), committed);
        const other = await page.request.post(new URL('/api/interview/answer', baseUrl).href, { data: {
          ...sent, userAnswer: answer.replace('built a Python dashboard', 'reviewed payroll records'),
        } });
        assert.equal(other.status(), 409);
        assert.equal((await other.json()).error.currentQuestion.questionNumber, 2);
        console.log('browser-real-interview-replay-pass');
      } finally {
        await page.close();
      }
    }
    console.log('DAY1_BROWSER_BOUNDARY_ALL_PASSED');
  } finally {
    await browser.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
